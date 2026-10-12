import test from "node:test";
import assert from "node:assert/strict";
import { freshState } from "../src/storage.js";
import { hasFinancialData, mergeImport, mergeStates } from "../src/merge.js";

const expense = (id, amountCents) => ({
  id, date: "2026-10-11", description: id, category: "Other",
  type: "Expense", status: "Paid", amountCents, notes: "",
});

test("independent edits from two devices merge without duplicate IDs", () => {
  const base = freshState();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.transactions.push(expense("local", 1200));
  remote.transactions.push(expense("remote", 3400));
  const result = mergeStates(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(new Set(result.state.transactions.map((t) => t.id)), new Set(["local", "remote"]));
});

test("simultaneous changes to one transaction require an explicit choice", () => {
  const base = freshState();
  base.transactions.push(expense("same", 1000));
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.transactions[0].amountCents = 2000;
  remote.transactions[0].amountCents = 3000;
  assert.equal(mergeStates(base, local, remote).conflicts.length, 1);
  assert.equal(mergeStates(base, local, remote, "local").state.transactions[0].amountCents, 2000);
  assert.equal(mergeStates(base, local, remote, "remote").state.transactions[0].amountCents, 3000);
});

test("a deletion on one device and unrelated edit on another are preserved", () => {
  const base = freshState();
  base.transactions.push(expense("a", 100), expense("b", 200));
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.transactions = local.transactions.filter((t) => t.id !== "a");
  remote.transactions[1].amountCents = 300;
  const result = mergeStates(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.state.transactions.map((t) => [t.id, t.amountCents]), [["b", 300]]);
});

test("independent contributions to one savings goal both survive", () => {
  const base = freshState();
  base.goals.push({ id: "goal", name: "Reserve", targetCents: 50000, targetDate: "", movements: [] });
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.goals[0].movements.push({ id: "m1", date: "2026-10-11", amountCents: 500, notes: "" });
  remote.goals[0].movements.push({ id: "m2", date: "2026-10-12", amountCents: 800, notes: "" });
  const result = mergeStates(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(new Set(result.state.goals[0].movements.map((m) => m.id)), new Set(["m1", "m2"]));
});

test("local import is idempotent and preserves cloud collisions", () => {
  const local = freshState();
  local.transactions.push(expense("x", 100), expense("y", 200));
  const cloud = freshState();
  cloud.transactions.push(expense("x", 900));
  const once = mergeImport(local, cloud);
  const twice = mergeImport(local, once.state);
  assert.equal(once.state.transactions.find((t) => t.id === "x").amountCents, 900);
  assert.equal(once.counts.transactions, 1);
  assert.equal(twice.counts.transactions, 0);
  assert.equal(twice.state.transactions.length, 2);
  assert.equal(hasFinancialData(twice.state), true);
});
