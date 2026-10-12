import { DEFAULT_CATEGORIES, today } from "./finance.js";
const DB = "northstar-budget-v1";
const KEY = "budget";
const SNAPSHOT = "northstar-budget-write-through-v1";
const syncKey = (userId) => `northstar-sync-base-v1:${userId}`;
const stateKey = (userId) => (userId ? `${KEY}:${userId}` : KEY);
const snapshotKey = (userId) => (userId ? `${SNAPSHOT}:${userId}` : SNAPSHOT);
export const freshState = () => ({
  version: 1,
  transactions: [],
  bills: [],
  goals: [],
  allocations: {},
  payPlans: {},
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
      (t.direction && !["in", "out"].includes(t.direction))
    )
      throw Error("Backup contains an invalid transaction.");
  }
  for (const b of raw.bills) {
    if (
      !b.id ||
      !b.nextDue ||
      !Number.isSafeInteger(b.amountCents) ||
      b.amountCents < 0
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
  return raw;
}
