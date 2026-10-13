import test from "node:test";
import assert from "node:assert/strict";
import { archiveLinkedGamblingEntry } from "../src/gambling.js";
import { freshState, validateBackup } from "../src/storage.js";
import { mergeStates } from "../src/merge.js";

function legacyState() {
  const state = freshState();
  state.transactions.push(
    { id: "gambling:e1:stake", date: "2026-10-11", type: "Expense", status: "Paid", amountCents: 2000,
      category: "Gambling", description: "Ticket purchase", gamblingEntryId: "e1" },
    { id: "gambling:e1:payout", date: "2026-10-12", type: "Income", status: "Received", amountCents: 3500,
      category: "Gambling", description: "Ticket payout", gamblingEntryId: "e1" },
  );
  state.gambling.entries.push({ id: "e1", kind: "scratch", date: "2026-10-11", payoutDate: "2026-10-12",
    time: "", name: "Ticket", subcategory: "", platform: "", ticketPriceCents: 2000, ticketCount: 1,
    rounds: null, stakeCents: 2000, payoutCents: 3500, notes: "",
    stakeTransactionId: "gambling:e1:stake", payoutTransactionId: "gambling:e1:payout" });
  return state;
}

test("retired tracker records remain valid and linked ledger rows become ordinary transactions", () => {
  const state = legacyState();
  validateBackup(state);
  assert.equal(archiveLinkedGamblingEntry(state, "gambling:e1:stake"), true);
  assert.equal(state.gambling.entries.length, 0);
  assert.equal(state.gambling.archivedEntries.length, 1);
  assert.equal(state.gambling.archivedEntries[0].name, "Ticket");
  assert.equal(state.transactions.length, 2);
  assert.ok(state.transactions.every((tx) => !tx.gamblingEntryId));
  state.transactions[0].amountCents = 2500;
  validateBackup(state);
  assert.equal(archiveLinkedGamblingEntry(state, "gambling:e1:payout"), false);
});

test("archived tracker records survive cross-device merge", () => {
  const base = legacyState();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  archiveLinkedGamblingEntry(local, "gambling:e1:stake");
  local.transactions[0].amountCents = 2500;
  const { state, conflicts } = mergeStates(base, local, remote);
  assert.deepEqual(conflicts, []);
  assert.equal(state.gambling.entries.length, 0);
  assert.equal(state.gambling.archivedEntries.length, 1);
  assert.equal(state.transactions[0].amountCents, 2500);
  validateBackup(state);
});
