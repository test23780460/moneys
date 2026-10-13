import { freshState } from "./storage.js";
import { defaultPayday } from "./payday.js";
import { defaultGambling } from "./gambling.js";

// PostgreSQL jsonb can reorder object keys; compare values rather than JSON text.
export function same(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a), bKeys = Object.keys(b);
  return aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
}
const missing = Symbol("missing");

function choose(base, local, remote, label, conflicts, preference) {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  conflicts.push(label);
  return preference === "remote" ? remote : local;
}

function keyed(list) {
  return new Map(list.map((item) => [item.id, item]));
}

function mergeRows(base, local, remote, label, conflicts, preference) {
  const a = keyed(base), b = keyed(local), c = keyed(remote);
  const ids = new Set([...a.keys(), ...b.keys(), ...c.keys()]);
  const result = [];
  for (const id of ids) {
    const value = choose(
      a.has(id) ? a.get(id) : missing,
      b.has(id) ? b.get(id) : missing,
      c.has(id) ? c.get(id) : missing,
      `${label} ${id}`,
      conflicts,
      preference,
    );
    if (value !== missing) result.push(value);
  }
  return result;
}

function mergeGoals(base, local, remote, conflicts, preference) {
  const a = keyed(base), b = keyed(local), c = keyed(remote);
  const result = [];
  for (const id of new Set([...a.keys(), ...b.keys(), ...c.keys()])) {
    const before = a.get(id), here = b.get(id), there = c.get(id);
    if (!before || !here || !there) {
      const value = choose(before ?? missing, here ?? missing, there ?? missing,
        `goal ${id}`, conflicts, preference);
      if (value !== missing) result.push(value);
      continue;
    }
    const fields = mergeMap(
      Object.fromEntries(Object.entries(before).filter(([key]) => key !== "movements")),
      Object.fromEntries(Object.entries(here).filter(([key]) => key !== "movements")),
      Object.fromEntries(Object.entries(there).filter(([key]) => key !== "movements")),
      `goal ${id}`,
      conflicts,
      preference,
    );
    result.push({
      ...fields,
      movements: mergeRows(before.movements, here.movements, there.movements,
        `goal ${id} movement`, conflicts, preference),
    });
  }
  return result;
}

function mergeMap(base, local, remote, label, conflicts, preference) {
  const result = {};
  for (const key of new Set([
    ...Object.keys(base || {}),
    ...Object.keys(local || {}),
    ...Object.keys(remote || {}),
  ])) {
    const value = choose(
      Object.hasOwn(base || {}, key) ? base[key] : missing,
      Object.hasOwn(local || {}, key) ? local[key] : missing,
      Object.hasOwn(remote || {}, key) ? remote[key] : missing,
      `${label} ${key}`,
      conflicts,
      preference,
    );
    if (value !== missing) result[key] = value;
  }
  return result;
}

export function hasFinancialData(state) {
  const defaults = freshState();
  return Boolean(
    state.transactions.length ||
      state.bills.length ||
      state.goals.length ||
      Object.keys(state.allocations || {}).length ||
      Object.keys(state.payPlans || {}).length ||
      Object.keys(state.payday?.checkins || {}).length ||
      (state.gambling?.entries?.length || 0) ||
      (state.gambling?.archivedEntries?.length || 0) ||
      (state.gambling && !same(state.gambling.limit, defaults.gambling.limit)) ||
      (state.payday && !same(state.payday, defaults.payday)) ||
      !same(state.categories, defaults.categories) ||
      !same(state.settings, defaults.settings),
  );
}

// Every unit either uses its sole changed side or reports a true concurrent edit.
// A caller must explicitly resolve conflicts; the merge never drops them silently.
export function mergeStates(base, local, remote, preference = null) {
  const conflicts = [];
  const settings = mergeMap(
    base.settings,
    local.settings,
    remote.settings,
    "setting",
    conflicts,
    preference,
  );
  const allocations = {};
  for (const week of new Set([
    ...Object.keys(base.allocations || {}),
    ...Object.keys(local.allocations || {}),
    ...Object.keys(remote.allocations || {}),
  ])) {
    const row = mergeMap(
      base.allocations?.[week] || {},
      local.allocations?.[week] || {},
      remote.allocations?.[week] || {},
      `allocation ${week}`,
      conflicts,
      preference,
    );
    if (Object.keys(row).length) allocations[week] = row;
  }
  return {
    state: {
      version: 1,
      transactions: mergeRows(base.transactions, local.transactions, remote.transactions, "transaction", conflicts, preference),
      bills: mergeRows(base.bills, local.bills, remote.bills, "bill", conflicts, preference),
      goals: mergeGoals(base.goals, local.goals, remote.goals, conflicts, preference),
      allocations,
      payPlans: mergeMap(base.payPlans || {}, local.payPlans || {}, remote.payPlans || {}, "pay plan", conflicts, preference),
      payday: {
        ...defaultPayday(),
        ...mergeMap(
          Object.fromEntries(Object.entries(base.payday || {}).filter(([key]) => key !== "checkins")),
          Object.fromEntries(Object.entries(local.payday || {}).filter(([key]) => key !== "checkins")),
          Object.fromEntries(Object.entries(remote.payday || {}).filter(([key]) => key !== "checkins")),
          "payday setting", conflicts, preference,
        ),
        checkins: mergeMap(base.payday?.checkins || {}, local.payday?.checkins || {}, remote.payday?.checkins || {}, "payday check-in", conflicts, preference),
      },
      gambling: {
        entries: mergeRows(base.gambling?.entries || [], local.gambling?.entries || [], remote.gambling?.entries || [], "gambling entry", conflicts, preference),
        archivedEntries: mergeRows(base.gambling?.archivedEntries || [], local.gambling?.archivedEntries || [], remote.gambling?.archivedEntries || [], "archived gambling entry", conflicts, preference),
        limit: mergeMap(base.gambling?.limit || defaultGambling().limit, local.gambling?.limit || defaultGambling().limit, remote.gambling?.limit || defaultGambling().limit, "gambling limit", conflicts, preference),
      },
      categories: choose(base.categories, local.categories, remote.categories, "categories", conflicts, preference),
      settings,
      createdAt: choose(base.createdAt, local.createdAt, remote.createdAt, "creation date", conflicts, preference),
    },
    conflicts,
  };
}

// Import only new identities and missing plan cells. Cloud values win collisions.
// The source local document remains untouched until the cloud confirms the result.
export function mergeImport(local, cloud) {
  const merged = structuredClone(cloud);
  const counts = { transactions: 0, bills: 0, goals: 0, skipped: 0 };
  for (const kind of ["transactions", "bills", "goals"]) {
    const existing = new Set(merged[kind].map((item) => item.id));
    for (const item of local[kind]) {
      if (existing.has(item.id)) {
        counts.skipped++;
        continue;
      }
      merged[kind].push(structuredClone(item));
      existing.add(item.id);
      counts[kind]++;
    }
  }
  merged.categories = [...new Set([...cloud.categories, ...local.categories])];
  for (const [week, amount] of Object.entries(local.payPlans || {})) {
    if (!Object.hasOwn(merged.payPlans, week)) merged.payPlans[week] = amount;
  }
  for (const [week, row] of Object.entries(local.allocations || {})) {
    merged.allocations[week] ||= {};
    for (const [category, amount] of Object.entries(row)) {
      if (!Object.hasOwn(merged.allocations[week], category))
        merged.allocations[week][category] = amount;
    }
  }
  merged.payday ||= structuredClone(local.payday || defaultPayday());
  merged.gambling ||= defaultGambling();
  merged.gambling.archivedEntries ||= [];
  const archivedIds = new Set(merged.gambling.archivedEntries.map((entry) => entry.id));
  for (const entry of local.gambling?.archivedEntries || []) {
    if (archivedIds.has(entry.id) || merged.gambling.entries.some((item) => item.id === entry.id)) continue;
    merged.gambling.archivedEntries.push(structuredClone(entry));
    archivedIds.add(entry.id);
  }
  const gamblingIds = new Set(merged.gambling.entries.map((entry) => entry.id));
  for (const entry of local.gambling?.entries || []) {
    if (gamblingIds.has(entry.id) || archivedIds.has(entry.id)) { counts.skipped++; continue; }
    // An ID collision may belong to a different ledger row in the cloud.
    const links = [[entry.stakeTransactionId, "Expense", "Paid", entry.stakeCents],
      [entry.payoutTransactionId, "Income", "Received", entry.payoutCents]];
    if (links.every(([id, type, status, amount]) => amount === 0 ? id == null :
      merged.transactions.some((tx) => tx.id === id && tx.type === type && tx.status === status && tx.amountCents === amount)) &&
      links.every(([id]) => !id || !merged.gambling.entries.some((e) =>
        e.stakeTransactionId === id || e.payoutTransactionId === id))) {
      merged.gambling.entries.push(structuredClone(entry));
      gamblingIds.add(entry.id);
    } else counts.skipped++;
  }
  merged.payday.checkins ||= {};
  for (const [date, entry] of Object.entries(local.payday?.checkins || {}))
    if (!Object.hasOwn(merged.payday.checkins, date)) merged.payday.checkins[date] = structuredClone(entry);
  if (!hasFinancialData(cloud)) {
    merged.settings = structuredClone(local.settings);
    if (local.payday) merged.payday = structuredClone(local.payday);
    if (local.gambling) merged.gambling.limit = structuredClone(local.gambling.limit);
  }
  return { state: merged, counts };
}
