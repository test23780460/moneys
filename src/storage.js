import { DEFAULT_CATEGORIES, today } from "./finance.js";
import { defaultPayday, validTimeZone } from "./payday.js";
import { defaultGambling } from "./gambling.js";
const DB = "northstar-budget-v1";
const KEY = "budget";
const SNAPSHOT = "northstar-budget-write-through-v1";
const syncKey = (userId) => `northstar-sync-base-v1:${userId}`;
const stateKey = (userId) => (userId ? `${KEY}:${userId}` : KEY);
const snapshotKey = (userId) => (userId ? `${SNAPSHOT}:${userId}` : SNAPSHOT);
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export const freshState = () => ({
  version: 1,
  transactions: [],
  bills: [],
  goals: [],
  allocations: {},
  payPlans: {},
  payday: defaultPayday(),
  gambling: defaultGambling(),
  categories: [...DEFAULT_CATEGORIES],
  settings: { currency: "USD", weekStarts: 1, startingBalanceCents: 0 },
  createdAt: today(),
});
let dbPromise;
function openDb() {
  if (!("indexedDB" in window))
    return Promise.reject(Error("IndexedDB is unavailable."));
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("app");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return dbPromise;
}
export async function loadState(userId = null) {
  let latest;
  try {
    latest = JSON.parse(localStorage.getItem(snapshotKey(userId)));
    if (latest) validateBackup(latest);
  } catch {
    latest = null;
  }
  if (latest) return latest;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("app", "readonly");
    const req = tx.objectStore("app").get(stateKey(userId));
    req.onsuccess = () => resolve(req.result || freshState());
    req.onerror = () => reject(req.error);
  });
}
export function writeThrough(state, userId = null) {
  localStorage.setItem(snapshotKey(userId), JSON.stringify(state));
}
export async function saveState(state, userId = null) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("app", "readwrite");
    tx.objectStore("app").put(state, stateKey(userId));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export function loadSyncBase(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(syncKey(userId)));
    if (value && Number.isSafeInteger(value.revision)) {
      validateBackup(value.state);
      return value;
    }
  } catch {
    // A damaged sync marker must never replace financial records.
  }
  return null;
}
export function saveSyncBase(userId, revision, state) {
  localStorage.setItem(syncKey(userId), JSON.stringify({ revision, state }));
}
export async function clearUserCache(userId) {
  localStorage.removeItem(snapshotKey(userId));
  localStorage.removeItem(syncKey(userId));
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("app", "readwrite");
    tx.objectStore("app").delete(stateKey(userId));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export function validateBackup(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.transactions) ||
    !Array.isArray(raw.bills) ||
    !Array.isArray(raw.goals) ||
    !Array.isArray(raw.categories) ||
    typeof raw.allocations !== "object" ||
    (raw.payPlans && typeof raw.payPlans !== "object") ||
    !raw.settings
  )
    throw Error("This is not a valid Northstar backup.");
  for (const t of raw.transactions) {
    if (
      !t.id ||
      !t.date ||
      !["Income", "Expense", "Transfer", "Savings"].includes(t.type) ||
      !Number.isSafeInteger(t.amountCents) ||
      t.amountCents < 0 ||
      (t.paydayCycle && (!/^\d{4}-\d{2}-\d{2}$/.test(t.paydayCycle) || Number.isNaN(Date.parse(`${t.paydayCycle}T12:00:00Z`)))) ||
      (t.direction && !["in", "out"].includes(t.direction))
    )
      throw Error("Backup contains an invalid transaction.");
  }
  for (const b of raw.bills) {
    if (
      !b.id ||
      !b.nextDue ||
      !Number.isSafeInteger(b.amountCents) ||
      b.amountCents < 0 ||
      (b.sinkingPaychecks != null && (!Number.isInteger(b.sinkingPaychecks) || b.sinkingPaychecks < 1 || b.sinkingPaychecks > 52))
    )
      throw Error("Backup contains an invalid bill.");
  }
  for (const g of raw.goals) {
    if (
      !g.id ||
      !Number.isSafeInteger(g.targetCents) ||
      g.targetCents < 0 ||
      !Array.isArray(g.movements)
    )
      throw Error("Backup contains an invalid goal.");
  }
  for (const amount of Object.values(raw.payPlans || {})) {
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw Error("Backup contains an invalid pay plan.");
  }
  if (raw.payday) {
    const p = raw.payday;
    if (!Number.isInteger(p.weekday) || p.weekday < 0 || p.weekday > 6 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time) ||
      typeof p.timeZone !== "string" || !validTimeZone(p.timeZone) ||
      typeof p.autoPrompt !== "boolean" || !Array.isArray(p.rules) ||
      !p.checkins || typeof p.checkins !== "object" || Array.isArray(p.checkins))
      throw Error("Backup contains invalid payday settings.");
    for (const r of p.rules) {
      if (!raw.categories.includes(r.category) || !["fixed", "percent"].includes(r.mode) ||
        !Number.isFinite(r.value) || r.value < 0 ||
        (r.mode === "fixed" && !Number.isSafeInteger(r.value)) ||
        (r.mode === "percent" && r.value > 100) ||
        !Number.isInteger(r.priority) || r.priority < 1 || r.priority > 5)
        throw Error("Backup contains an invalid payday allocation rule.");
    }
    for (const [date, entry] of Object.entries(p.checkins)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !["completed", "skipped", "dismissed", "snoozed"].includes(entry?.status) ||
        (entry.deferUntil && Number.isNaN(Date.parse(entry.deferUntil))))
        throw Error("Backup contains invalid payday check-in history.");
    }
  }
  if (raw.gambling) {
    const g = raw.gambling;
    if (!Array.isArray(g.entries) || !g.limit ||
      (g.archivedEntries != null && (!Array.isArray(g.archivedEntries) || g.archivedEntries.length > 10000)) ||
      !["none", "week", "month"].includes(g.limit.period) ||
      !Number.isSafeInteger(g.limit.amountCents) || g.limit.amountCents < 0 ||
      (g.limit.period !== "none" && g.limit.amountCents === 0) ||
      g.entries.length > 10000)
      throw Error("Backup contains invalid gambling settings.");
    const ids = new Set(), links = new Set();
    for (const e of g.entries) {
      if (!e || typeof e.id !== "string" || !e.id || ids.has(e.id) ||
        !["scratch", "game", "other"].includes(e.kind) ||
        !validDate(e.date) ||
        (e.payoutDate && !validDate(e.payoutDate)) ||
        typeof e.name !== "string" || !e.name.trim() || e.name.length > 500 ||
        typeof e.notes !== "string" || e.notes.length > 5000 ||
        typeof e.platform !== "string" || e.platform.length > 500 ||
        !Number.isSafeInteger(e.stakeCents) || e.stakeCents < 0 ||
        !Number.isSafeInteger(e.payoutCents) || e.payoutCents < 0 ||
        (!e.stakeCents && !e.payoutCents) ||
        (e.kind === "scratch" && (!Number.isSafeInteger(e.ticketPriceCents) || e.ticketPriceCents < 0 ||
          !Number.isInteger(e.ticketCount) || e.ticketCount < 1 || e.ticketCount > 10000 ||
          e.ticketPriceCents * e.ticketCount !== e.stakeCents)) ||
        (e.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) ||
        (e.rounds != null && (!Number.isInteger(e.rounds) || e.rounds < 1 || e.rounds > 1000000)))
        throw Error("Backup contains an invalid gambling entry.");
      ids.add(e.id);
      for (const [side, type, amount] of [["stake", "Expense", e.stakeCents], ["payout", "Income", e.payoutCents]]) {
        const id = e[`${side}TransactionId`];
        if (amount === 0 && id != null) throw Error("Zero gambling amount cannot link a transaction.");
        if (amount > 0) {
          const t = raw.transactions.find((x) => x.id === id);
          if (!id || links.has(id) || !t || t.type !== type ||
            t.status !== (type === "Expense" ? "Paid" : "Received") || t.amountCents !== amount ||
            (type === "Income" && t.paydayCycle) ||
            (id === `gambling:${e.id}:${side}` && t.gamblingEntryId !== e.id))
            throw Error("Backup contains an invalid gambling ledger link.");
          links.add(id);
        }
      }
    }
    const archivedIds = new Set();
    for (const entry of g.archivedEntries || []) {
      if (!entry || typeof entry.id !== "string" || !entry.id || archivedIds.has(entry.id) ||
        typeof entry.name !== "string" || !entry.name.trim() ||
        !Number.isSafeInteger(entry.stakeCents) || entry.stakeCents < 0 ||
        !Number.isSafeInteger(entry.payoutCents) || entry.payoutCents < 0)
        throw Error("Backup contains an invalid archived gambling entry.");
      archivedIds.add(entry.id);
    }
  }
  return raw;
}
