import test from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  weekStart,
  monthStart,
  monthEnd,
  metrics,
  nextDue,
  toCsv,
  parseCsv,
} from "../src/finance.js";
import { freshState, validateBackup } from "../src/storage.js";

test("money is parsed into exact integer cents", () => {
  assert.equal(cents("1,234.56"), 123456);
  assert.equal(cents("0.09"), 9);
  assert.equal(cents("12.345"), null);
});

test("calendar month and financial week boundaries stay distinct", () => {
  assert.equal(weekStart("2026-11-01", 1), "2026-10-26");
  assert.equal(monthStart("2026-11-01"), "2026-11-01");
  assert.equal(monthEnd("2026-11-01"), "2026-11-30");
});

test("only confirmed activity affects actual totals and savings are separate", () => {
  const rows = [
    {
      date: "2026-10-03",
      type: "Income",
      status: "Received",
      amountCents: 10000,
    },
    {
      date: "2026-10-04",
      type: "Income",
      status: "Expected",
      amountCents: 90000,
    },
    { date: "2026-10-05", type: "Expense", status: "Paid", amountCents: 2250 },
    {
      date: "2026-10-06",
      type: "Expense",
      status: "Upcoming",
      amountCents: 5000,
    },
    {
      date: "2026-10-07",
      type: "Savings",
      status: "Cleared",
      amountCents: 1000,
    },
    {
      date: "2026-10-08",
      type: "Savings",
      status: "Cleared",
      amountCents: 300,
      direction: "in",
    },
    {
      date: "2026-10-09",
      type: "Transfer",
      status: "Cleared",
      amountCents: 2000,
    },
  ];
  const result = metrics(rows, { from: "2026-10-01", to: "2026-10-31" }, 500);
  assert.deepEqual(
    {
      income: result.income,
      expenses: result.expenses,
      savings: result.savings,
      remaining: result.remaining,
      balance: result.balance,
    },
    {
      income: 10000,
      expenses: 2250,
      savings: 700,
      remaining: 7050,
      balance: 7550,
    },
  );
});

test("monthly recurrence clamps month-end dates", () => {
  assert.equal(nextDue("2026-01-31", "Monthly"), "2026-02-28");
  assert.equal(nextDue("2028-01-31", "Monthly"), "2028-02-29");
});

test("CSV round-trip preserves savings direction and quoted text", () => {
  const row = {
    date: "2026-10-11",
    description: 'Withdrawal, "goal"',
    category: "Savings Transfers",
    type: "Savings",
    amountCents: 2500,
    status: "Cleared",
    notes: "test",
    direction: "in",
  };
  const parsed = parseCsv(toCsv([row]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].description, row.description);
  assert.equal(parsed[0].amountCents, 2500);
  assert.equal(parsed[0].direction, "in");
});

test("CSV import rejects impossible dates and mismatched statuses", () => {
  assert.throws(
    () =>
      parseCsv(
        "Date,Description,Category,Type,Amount,Status\n2026-02-31,Test,Other,Expense,1.00,Paid",
      ),
    /invalid date/,
  );
  assert.throws(
    () =>
      parseCsv(
        "Date,Description,Category,Type,Amount,Status\n2026-02-28,Test,Other,Income,1.00,Paid",
      ),
    /invalid status/,
  );
});

test("backup validation accepts weekly pay plans and rejects corrupt amounts", () => {
  const backup = freshState();
  backup.payPlans["2026-10-05"] = 12345;
  assert.equal(validateBackup(backup), backup);
  backup.payPlans["2026-10-05"] = 1.5;
  assert.throws(() => validateBackup(backup), /invalid pay plan/);
});
