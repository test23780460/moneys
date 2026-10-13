// Keep historical tracker records in backups and cloud sync after the UI is removed.
export const defaultGambling = () => ({
  entries: [],
  archivedEntries: [],
  limit: { period: "none", amountCents: 0 },
});

// A ledger edit can invalidate an old tracker link. Archive that record first,
// leaving every income and expense transaction in place as an ordinary row.
export function archiveLinkedGamblingEntry(state, transactionId) {
  const gambling = state.gambling;
  const index = gambling?.entries?.findIndex((entry) =>
    entry.stakeTransactionId === transactionId || entry.payoutTransactionId === transactionId) ?? -1;
  if (index < 0) return false;
  const [entry] = gambling.entries.splice(index, 1);
  gambling.archivedEntries ||= [];
  if (!gambling.archivedEntries.some((item) => item.id === entry.id))
    gambling.archivedEntries.push(structuredClone(entry));
  for (const transaction of state.transactions)
    if (transaction.gamblingEntryId === entry.id) delete transaction.gamblingEntryId;
  return true;
}
