import { actual, inRange, monthStart, weekStart } from "./finance.js";

export const defaultGambling = () => ({ entries: [], limit: { period: "none", amountCents: 0 } });
export const gamblingNet = (entry) => entry.payoutCents - entry.stakeCents;

export function gamblingTotals(entries) {
  const spentCents = entries.reduce((sum, e) => sum + e.stakeCents, 0);
  const returnedCents = entries.reduce((sum, e) => sum + e.payoutCents, 0);
  return {
    spentCents, returnedCents, netCents: returnedCents - spentCents,
    count: entries.length,
    biggestWinCents: Math.max(0, ...entries.map(gamblingNet)),
    lossesCents: entries.reduce((sum, e) => sum + Math.max(0, -gamblingNet(e)), 0),
  };
}

export function gamblingGroups(entries, kind, weekStarts = 1) {
  const groups = new Map();
  for (const entry of entries) {
    const key = kind === "week" ? weekStart(entry.date, weekStarts) : monthStart(entry.date);
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a))
    .map(([date, rows]) => ({ date, ...gamblingTotals(rows) }));
}

export function gamblingLimit(gambling, date, weekStarts = 1) {
  const { period, amountCents } = gambling.limit || {};
  if (period !== "week" && period !== "month") return null;
  const from = period === "week" ? weekStart(date, weekStarts) : monthStart(date);
  const to = period === "week" ? (() => {
    const d = new Date(`${from}T12:00:00`); d.setDate(d.getDate() + 6);
    return d.toLocaleDateString("en-CA");
  })() : (() => {
    const d = new Date(`${from}T12:00:00`); d.setMonth(d.getMonth() + 1); d.setDate(0);
    return d.toLocaleDateString("en-CA");
  })();
  const spentCents = gamblingTotals(gambling.entries.filter((e) => inRange(e.date, { from, to }))).spentCents;
  return { period, from, to, amountCents, spentCents, remainingCents: Math.max(0, amountCents - spentCents),
    percent: amountCents ? Math.round(spentCents / amountCents * 100) : 0 };
}

const txId = (entryId, side) => `gambling:${entryId}:${side}`;
export function linkedEntryForTransaction(entries, transactionId) {
  return entries.find((entry) => entry.stakeTransactionId === transactionId || entry.payoutTransactionId === transactionId);
}

function verifyLink(transactions, id, type, amountCents, entryId, entries) {
  const tx = transactions.find((item) => item.id === id);
  if (!tx || tx.type !== type || !actual(tx) || tx.amountCents !== amountCents ||
    (type === "Income" && tx.paydayCycle))
    throw Error(`Choose a confirmed ${type.toLowerCase()} transaction for the exact amount.`);
  const other = linkedEntryForTransaction(entries.filter((entry) => entry.id !== entryId), id);
  if (other) throw Error("That ledger transaction is already linked to another gambling entry.");
  return tx;
}

// One managed ledger row per side. Linked rows remain owned by the main ledger.
// Editing and deleting an entry cannot silently modify a pre-existing transaction.
export function saveGamblingEntry(state, input) {
  const gambling = state.gambling ||= defaultGambling();
  const entries = gambling.entries;
  const previous = entries.find((entry) => entry.id === input.id);
  const id = input.id || crypto.randomUUID();
  const entry = { ...input, id };
  let transactions = state.transactions.filter((tx) =>
    tx.id !== (previous?.stakeTransactionId === txId(id, "stake") ? previous.stakeTransactionId : null) &&
    tx.id !== (previous?.payoutTransactionId === txId(id, "payout") ? previous.payoutTransactionId : null));
  for (const [side, amount, type, status] of [
    ["stake", entry.stakeCents, "Expense", "Paid"],
    ["payout", entry.payoutCents, "Income", "Received"],
  ]) {
    const field = `${side}TransactionId`;
    const choice = input[`${side}Choice`] || "create";
    if (amount === 0) {
      entry[field] = null;
    } else if (choice === "create") {
      entry[field] = txId(id, side);
      if (transactions.some((tx) => tx.id === entry[field])) throw Error("Duplicate managed ledger transaction.");
      transactions.push({ id: entry[field], date: side === "payout" ? (entry.payoutDate || entry.date) : entry.date,
        description: `${side === "stake" ? "Gambling stake" : "Gambling payout"}: ${entry.name}`,
        category: "Gambling", type, amountCents: amount, status,
        notes: entry.notes || "", gamblingEntryId: id });
    } else {
      verifyLink(transactions, choice, type, amount, id, entries);
      entry[field] = choice;
    }
  }
  delete entry.stakeChoice;
  delete entry.payoutChoice;
  if (!state.categories.includes("Gambling")) state.categories.push("Gambling");
  state.transactions = transactions;
  if (previous) Object.assign(previous, entry);
  else entries.push(entry);
  return entry;
}

export function deleteGamblingEntry(state, id) {
  const entry = state.gambling?.entries.find((row) => row.id === id);
  if (!entry) return false;
  state.transactions = state.transactions.filter((tx) =>
    tx.id !== txId(id, "stake") && tx.id !== txId(id, "payout"));
  state.gambling.entries = state.gambling.entries.filter((row) => row.id !== id);
  return true;
}

export function gamblingCsv(entries) {
  const cell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return ["Date,Type,Name,Money Spent,Money Returned,Net Profit/Loss,Notes,Platform or Location,Ticket Price,Tickets,Rounds,Time,Stake Transaction ID,Payout Transaction ID",
    ...entries.map((e) => [e.date, e.kind, e.name, (e.stakeCents / 100).toFixed(2),
      (e.payoutCents / 100).toFixed(2), (gamblingNet(e) / 100).toFixed(2), e.notes,
      e.platform, e.ticketPriceCents == null ? "" : (e.ticketPriceCents / 100).toFixed(2),
      e.ticketCount, e.rounds, e.time, e.stakeTransactionId, e.payoutTransactionId].map(cell).join(","))]
    .join("\r\n");
}
