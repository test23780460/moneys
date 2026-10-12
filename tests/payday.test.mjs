import test from "node:test";
import assert from "node:assert/strict";
import { defaultPayday, latestDuePayday, missedPaydays, paydayPlan, paycheckHistory, recordPaycheck, shouldPromptPayday } from "../src/payday.js";
import { freshState, validateBackup } from "../src/storage.js";
import { mergeStates } from "../src/merge.js";

const settings = { ...defaultPayday(), weekday: 3, time: "18:00", timeZone: "America/New_York" };

test("Wednesday prompt respects configured local time and missed check-ins", () => {
  assert.equal(latestDuePayday(new Date("2026-10-14T21:59:00Z"), settings), "2026-10-07");
  assert.equal(latestDuePayday(new Date("2026-10-14T22:00:00Z"), settings), "2026-10-14");
  assert.equal(latestDuePayday(new Date("2026-10-17T17:00:00Z"), settings), "2026-10-14");
  assert.deepEqual(missedPaydays(new Date("2026-10-17T17:00:00Z"), settings, [], {}, 4, "2026-10-01"), ["2026-10-14", "2026-10-07"]);
  assert.deepEqual(missedPaydays(new Date("2026-10-17T17:00:00Z"), settings, [], { "2026-10-14": { status: "skipped" } }, 4, "2026-10-01"), ["2026-10-07"]);
});

test("local wall-clock payday stays at 6 PM across daylight saving changes", () => {
  assert.equal(latestDuePayday(new Date("2026-03-11T21:59:00Z"), settings), "2026-03-04");
  assert.equal(latestDuePayday(new Date("2026-03-11T22:00:00Z"), settings), "2026-03-11");
  assert.equal(latestDuePayday(new Date("2026-11-04T22:59:00Z"), settings), "2026-10-28");
  assert.equal(latestDuePayday(new Date("2026-11-04T23:00:00Z"), settings), "2026-11-04");
});

test("automatic reminders respect skip, dismissal, snooze, and account creation", () => {
  const now = new Date("2026-10-14T22:01:00Z");
  assert.equal(shouldPromptPayday(now, settings, [], {}, "2026-10-11"), "2026-10-14");
  assert.equal(shouldPromptPayday(now, settings, [], { "2026-10-14": { status: "skipped" } }, "2026-10-11"), null);
  assert.equal(shouldPromptPayday(now, settings, [], { "2026-10-14": { status: "completed" } }, "2026-10-11"), "2026-10-14");
  assert.equal(shouldPromptPayday(now, settings, [], { "2026-10-14": { status: "dismissed" } }, "2026-10-11"), null);
  assert.equal(shouldPromptPayday(now, settings, [], { "2026-10-14": { status: "snoozed", deferUntil: "2026-10-14T23:00:00Z" } }, "2026-10-11"), null);
  assert.equal(shouldPromptPayday(new Date("2026-10-14T21:59:00Z"), settings, [], {}, "2026-10-14"), null);
  assert.equal(shouldPromptPayday(now, { ...settings, autoPrompt: false }, [], {}, "2026-10-11"), null);
});

test("bill reserves use actual schedule, recurring dates and optional sinking funds", () => {
  const bills = [
    { id: "rent", name: "Rent", nextDue: "2026-10-16", frequency: "Monthly", amountCents: 10000 },
    { id: "weekly", name: "Weekly", nextDue: "2026-10-15", frequency: "Weekly", amountCents: 2500 },
    { id: "future", name: "Future", nextDue: "2026-10-28", frequency: "Monthly", amountCents: 20000, sinkingPaychecks: 4 },
  ];
  const rules = [
    { category: "Savings Transfers", mode: "percent", value: 20, priority: 2 },
    { category: "Groceries", mode: "fixed", value: 10000, priority: 1 },
  ];
  const plan = paydayPlan(30000, bills, rules, "2026-10-14");
  assert.equal(plan.nextPayday, "2026-10-21");
  assert.equal(plan.dueCents, 12500);
  assert.equal(plan.sinkingCents, 5000);
  assert.equal(plan.savingsCents, 2500);
  assert.equal(plan.spendingCents, 10000);
  assert.equal(plan.unallocatedCents, 0);
  assert.equal(plan.shortageCents, 0);
  assert.equal(plan.allocations[0].category, "Groceries");
  const small = paydayPlan(10000, bills, rules, "2026-10-14");
  assert.equal(small.shortageCents, 17500);
  assert.equal(small.allocations[0].suggestedCents, 0);
  assert.equal(paydayPlan(30000, [{ ...bills[2], nextDue: "2027-01-28" }], [], "2026-10-14").sinkingCents, 0);
});

test("weeks crossing month boundaries use the next payday, not calendar month end", () => {
  const plan = paydayPlan(50000, [{ id: "rent", name: "Rent", nextDue: "2026-11-01", frequency: "Monthly", amountCents: 25000 }], [], "2026-10-28");
  assert.equal(plan.nextPayday, "2026-11-04");
  assert.equal(plan.dueCents, 25000);
});

test("saving or editing the same payday is idempotent and validates for cloud storage", () => {
  const state = freshState();
  state.payday = structuredClone(settings);
  recordPaycheck(state, "2026-10-14", 54321, "first");
  recordPaycheck(state, "2026-10-14", 65432, "revised");
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].id, "payday:2026-10-14");
  assert.equal(state.transactions[0].amountCents, 65432);
  assert.equal(validateBackup(state), state);
  const history = paycheckHistory(state.transactions, "2026-10-31");
  assert.equal(history.averageCents, 65432);
  assert.equal(history.monthToDateCents, 65432);
  state.payday.rules = [{ category: "Savings Transfers", mode: "percent", value: 12.5, priority: 1 }];
  assert.equal(validateBackup(state), state);
});

test("offline paycheck and independent remote edit merge without duplicate", () => {
  const base = freshState();
  base.payday = structuredClone(settings);
  const local = structuredClone(base);
  recordPaycheck(local, "2026-10-14", 45000);
  const remote = structuredClone(base);
  remote.bills.push({ id: "bill-1", name: "Phone", nextDue: "2026-10-16", frequency: "Monthly", amountCents: 3000 });
  const merged = mergeStates(base, local, remote);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.state.transactions.length, 1);
  assert.equal(merged.state.bills.length, 1);
  assert.equal(merged.state.payday.checkins["2026-10-14"].status, "completed");
});

test("two devices entering different amounts for one payday require review", () => {
  const base = freshState();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  recordPaycheck(local, "2026-10-14", 45000);
  recordPaycheck(remote, "2026-10-14", 47000);
  const merged = mergeStates(base, local, remote);
  assert.ok(merged.conflicts.some((label) => label.includes("payday:2026-10-14")));
  assert.equal(merged.state.transactions.length, 1);
});
