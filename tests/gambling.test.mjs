import test from "node:test";
import assert from "node:assert/strict";
import { freshState, validateBackup } from "../src/storage.js";
import { mergeStates } from "../src/merge.js";
import { metrics } from "../src/finance.js";
import { deleteGamblingEntry, gamblingCsv, gamblingGroups, gamblingLimit, gamblingTotals, linkedEntryForTransaction, saveGamblingEntry } from "../src/gambling.js";

const entry = (id, kind, stakeCents, payoutCents, extra = {}) => ({
  id, kind, date: "2026-10-11", time: kind === "game" ? "19:30" : "",
  name: kind === "scratch" ? "Ticket" : kind === "game" ? "Poker" : "Raffle",
  subcategory: "", platform: "", ticketPriceCents: kind === "scratch" ? stakeCents / 2 : null,
  ticketCount: kind === "scratch" ? 2 : null, rounds: null,
  stakeCents, payoutCents, notes: "", stakeChoice: "create", payoutChoice: "create", ...extra,
});

test("scratch-offs, games, and other entries use exact cents and flow into the main ledger once", () => {
  const state = freshState();
  saveGamblingEntry(state, entry("s1", "scratch", 2000, 3500));
  saveGamblingEntry(state, entry("g1", "game", 1000, 0, { rounds: 4 }));
  saveGamblingEntry(state, entry("o1", "other", 725, 1200));
  validateBackup(state);
  const totals = gamblingTotals(state.gambling.entries);
  assert.deepEqual([totals.spentCents, totals.returnedCents, totals.netCents, totals.count, totals.biggestWinCents, totals.lossesCents],
    [3725, 4700, 975, 3, 1500, 1000]);
  const budget = metrics(state.transactions, { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual([budget.expenses, budget.income, budget.remaining], [3725, 4700, 975]);
  assert.equal(state.transactions.length, 5);
  assert.ok(state.transactions.filter((tx) => tx.type === "Income").every((tx) => tx.category === "Gambling"));
  assert.match(gamblingCsv(state.gambling.entries), /Net Profit\/Loss/);
});

test("linking existing confirmed ledger rows avoids duplicate cash flow and preserves them on delete", () => {
  const state = freshState();
  state.transactions.push({ id: "expense", date: "2026-10-11", type: "Expense", status: "Paid", amountCents: 2000,
    description: "Ticket purchase", category: "Gambling", notes: "" });
  state.transactions.push({ id: "payout", date: "2026-10-11", type: "Income", status: "Received", amountCents: 3500,
    description: "Ticket payout", category: "Gambling", notes: "" });
  saveGamblingEntry(state, entry("s1", "scratch", 2000, 3500,
    { stakeChoice: "expense", payoutChoice: "payout" }));
  assert.equal(state.transactions.length, 2);
  assert.equal(linkedEntryForTransaction(state.gambling.entries, "expense")?.id, "s1");
  assert.throws(() => saveGamblingEntry(state, entry("s2", "scratch", 2000, 3500,
    { stakeChoice: "expense", payoutChoice: "payout" })), /already linked/);
  assert.equal(state.transactions.length, 2);
  assert.equal(state.gambling.entries.length, 1);
  deleteGamblingEntry(state, "s1");
  assert.equal(state.transactions.length, 2);
  assert.equal(state.gambling.entries.length, 0);
});

test("editing a managed entry replaces its ledger rows; deleting removes only those rows", () => {
  const state = freshState();
  saveGamblingEntry(state, entry("g1", "game", 1000, 0));
  saveGamblingEntry(state, entry("g1", "game", 1250, 2200, { payoutDate: "2026-10-12" }));
  validateBackup(state);
  assert.equal(state.transactions.length, 2);
  assert.equal(state.transactions.find((tx) => tx.type === "Expense").amountCents, 1250);
  assert.equal(state.transactions.find((tx) => tx.type === "Income").amountCents, 2200);
  assert.equal(state.transactions.find((tx) => tx.type === "Income").date, "2026-10-12");
  assert.equal(gamblingTotals(state.gambling.entries).netCents, 950);
  deleteGamblingEntry(state, "g1");
  assert.equal(state.transactions.length, 0);
});

test("paychecks cannot be linked as gambling payouts", () => {
  const state = freshState();
  state.transactions.push({ id: "payday:2026-10-07", date: "2026-10-07", paydayCycle: "2026-10-07",
    type: "Income", status: "Received", amountCents: 1000, description: "Paycheck", category: "Other" });
  assert.throws(() => saveGamblingEntry(state, entry("g1", "game", 0, 1000,
    { payoutChoice: "payday:2026-10-07" })), /confirmed income transaction/);
  assert.equal(state.gambling.entries.length, 0);
});

test("weekly and monthly limits measure wagers without offsetting wins", () => {
  const state = freshState();
  saveGamblingEntry(state, entry("g1", "game", 2000, 10000));
  state.gambling.limit = { period: "week", amountCents: 2500 };
  const weekly = gamblingLimit(state.gambling, "2026-10-11", 1);
  assert.deepEqual([weekly.spentCents, weekly.remainingCents, weekly.percent], [2000, 500, 80]);
  state.gambling.limit = { period: "month", amountCents: 1000 };
  const monthly = gamblingLimit(state.gambling, "2026-10-11", 1);
  assert.deepEqual([monthly.spentCents, monthly.remainingCents, monthly.percent], [2000, 0, 200]);
  assert.equal(gamblingGroups(state.gambling.entries, "week", 1)[0].netCents, 8000);
});

test("independent offline tracker edits merge and a concurrent edit requires review", () => {
  const base = freshState(), local = structuredClone(base), remote = structuredClone(base);
  saveGamblingEntry(local, entry("a", "other", 500, 0));
  saveGamblingEntry(remote, entry("b", "game", 1000, 1200));
  const result = mergeStates(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.state.gambling.entries.length, 2);
  validateBackup(result.state);
  const left = structuredClone(result.state), right = structuredClone(result.state);
  saveGamblingEntry(left, entry("a", "other", 600, 0));
  saveGamblingEntry(right, entry("a", "other", 700, 0));
  const conflict = mergeStates(result.state, left, right);
  assert.ok(conflict.conflicts.some((label) => label.includes("gambling entry a")));
});

test("backup validation rejects broken or duplicate gambling ledger links", () => {
  const state = freshState();
  saveGamblingEntry(state, entry("a", "other", 500, 0));
  const bad = structuredClone(state);
  bad.transactions[0].amountCents = 600;
  assert.throws(() => validateBackup(bad), /gambling ledger link/);
  const broken = structuredClone(state);
  broken.gambling.entries[0].stakeTransactionId = "missing";
  assert.throws(() => validateBackup(broken), /gambling ledger link/);
});
