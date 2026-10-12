import { nextDue, sum } from "./finance.js";

const DEFAULT_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
export const defaultPayday = () => ({
  weekday: 3,
  time: "18:00",
  timeZone: DEFAULT_ZONE,
  autoPrompt: true,
  rules: [],
  checkins: {},
});

export function validTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}

export function zonedNow(now, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const dayOfWeek = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const addCalendarDays = (date, days) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export function latestDuePayday(now, settings) {
  const local = zonedNow(now, settings.timeZone);
  const daysBack = (dayOfWeek(local.date) - settings.weekday + 7) % 7;
  const date = addCalendarDays(local.date, -daysBack);
  return daysBack === 0 && local.time < settings.time ? addCalendarDays(date, -7) : date;
}

export function cycleForDate(date, weekday) {
  return addCalendarDays(date, -(dayOfWeek(date) - weekday + 7) % 7);
}

export function missedPaydays(now, settings, transactions, checkins, limit = 8, sinceDate = "0000-01-01") {
  const latest = latestDuePayday(now, settings);
  const result = [];
  for (let i = 0; i < limit; i++) {
    const date = addCalendarDays(latest, -7 * i);
    if (date < sinceDate) break;
    const status = checkins[date]?.status;
    if (status === "skipped") continue;
    if (transactions.some((t) => t.paydayCycle === date && t.type === "Income" && t.status === "Received")) continue;
    result.push(date);
  }
  return result;
}

export function shouldPromptPayday(now, settings, transactions, checkins, createdAt) {
  if (!settings.autoPrompt) return null;
  const cycle = latestDuePayday(now, settings);
  if (cycle < addCalendarDays(createdAt, -6)) return null;
  const entry = checkins[cycle];
  if (["skipped", "dismissed"].includes(entry?.status) ||
      (entry?.status === "snoozed" && Date.parse(entry.deferUntil) > now.getTime()) ||
      transactions.some((t) => t.paydayCycle === cycle && t.type === "Income" && t.status === "Received"))
    return null;
  return cycle;
}

export function dueBillPlan(bills, cycleDate) {
  const nextPayday = addCalendarDays(cycleDate, 7);
  const due = [];
  const sinking = [];
  for (const bill of bills) {
    if (!bill.nextDue || !Number.isSafeInteger(bill.amountCents)) continue;
    let date = bill.nextDue;
    if (date < cycleDate) {
      if (!bill.lastPaidDate || date > bill.lastPaidDate)
        due.push({ ...bill, due: date, overdue: true });
      date = nextDue(date, bill.frequency);
      let guard = 0;
      while (date < cycleDate && guard++ < 500) date = nextDue(date, bill.frequency);
    }
    let guard = 0;
    while (date < nextPayday && guard++ < 8) {
      if (!bill.lastPaidDate || date > bill.lastPaidDate)
        due.push({ ...bill, due: date, overdue: false });
      date = nextDue(date, bill.frequency);
    }
    const daysUntil = (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${cycleDate}T12:00:00Z`)) / 86400000;
    if (bill.sinkingPaychecks > 1 && date >= nextPayday &&
      daysUntil <= bill.sinkingPaychecks * 7 && !due.some((x) => x.id === bill.id)) {
      sinking.push({ ...bill, due: date, reserveCents: Math.ceil(bill.amountCents / bill.sinkingPaychecks) });
    }
  }
  due.sort((a, b) => a.due.localeCompare(b.due));
  return { due, sinking, dueCents: sum(due), sinkingCents: sum(sinking, (b) => b.reserveCents), nextPayday };
}

export function paydayPlan(amountCents, bills, rules, cycleDate) {
  const bill = dueBillPlan(bills, cycleDate);
  const reserveCents = bill.dueCents + bill.sinkingCents;
  let available = Math.max(0, amountCents - reserveCents);
  const afterBillsCents = amountCents - reserveCents;
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.category.localeCompare(b.category));
  const allocations = sorted.map((rule) => {
    const targetCents = rule.mode === "percent"
      ? Math.round(Math.max(0, afterBillsCents) * rule.value / 100)
      : rule.value;
    const suggestedCents = Math.min(targetCents, available);
    available -= suggestedCents;
    return { ...rule, targetCents, suggestedCents, shortCents: targetCents - suggestedCents };
  });
  const savingsCents = sum(allocations.filter((a) => a.category === "Savings Transfers"), (a) => a.suggestedCents);
  return {
    ...bill, reserveCents, afterBillsCents,
    shortageCents: Math.max(0, -afterBillsCents) + sum(allocations, (a) => a.shortCents),
    allocations, savingsCents, spendingCents: Math.max(0, afterBillsCents - savingsCents),
    unallocatedCents: available,
  };
}

export function paycheckHistory(transactions, nowDate) {
  const rows = transactions.filter((t) => t.paydayCycle && t.type === "Income" && t.status === "Received")
    .sort((a, b) => b.paydayCycle.localeCompare(a.paydayCycle));
  return {
    rows: rows.map((row, i) => ({ ...row, changeCents: i + 1 < rows.length ? row.amountCents - rows[i + 1].amountCents : null })),
    averageCents: rows.length ? Math.round(sum(rows) / rows.length) : 0,
    monthToDateCents: sum(rows.filter((row) => row.date.slice(0, 7) === nowDate.slice(0, 7) && row.date <= nowDate)),
  };
}

export function recordPaycheck(state, cycle, amountCents, notes = "") {
  const id = `payday:${cycle}`;
  const existing = state.transactions.find((t) => t.id === id || t.paydayCycle === cycle);
  const record = {
    id, paydayCycle: cycle, date: cycle, description: "Paycheck",
    category: "Other", type: "Income", amountCents,
    status: "Received", notes,
  };
  if (existing) Object.assign(existing, { ...record, id: existing.id });
  else state.transactions.push(record);
  state.payday.checkins[cycle] = { status: "completed", transactionId: existing?.id || id };
  return { record: existing || record, updated: Boolean(existing) };
}
