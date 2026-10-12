import {
  today,
  uid,
  cents,
  money,
  addDays,
  addMonths,
  monthStart,
  monthEnd,
  weekStart,
  periodRange,
  inRange,
  actual,
  sum,
  metrics,
  nextDue,
  groupSum,
  toCsv,
  parseCsv,
  dateObj,
  FREQUENCIES,
} from "./finance.js";
import {
  clearUserCache,
  freshState,
  loadState,
  saveState,
  validateBackup,
  writeThrough,
} from "./storage.js";
import { BudgetSync, cloud, cloudEnabled } from "./cloud.js";
import { hasFinancialData } from "./merge.js";
import { defaultPayday, latestDuePayday, cycleForDate, missedPaydays, paydayPlan, paycheckHistory, recordPaycheck, shouldPromptPayday, validTimeZone, zonedNow } from "./payday.js";
import { defaultGambling, deleteGamblingEntry, gamblingCsv, gamblingGroups, gamblingLimit, gamblingNet, gamblingTotals, linkedEntryForTransaction, saveGamblingEntry } from "./gambling.js";

const root = document.querySelector("#app");
let state = freshState();
let page = "dashboard",
  period = "month",
  anchor = today(),
  custom = { from: monthStart(today()), to: today() };
let search = "",
  filterType = "All",
  filterCategory = "All",
  filterStatus = "All",
  sortBy = "date",
  sortDir = -1;
let selectedWeek = weekStart(today()),
  selectedMonth = monthStart(today()),
  selectedDate = today();
let gamblingTab = "scratch", gamblingSearch = "", gamblingSort = "date", gamblingSortDir = -1;
let modal = null,
  toastTimer,
  pendingSave = Promise.resolve(),
  undoStack = [],
  mobileNav = false;
let mode = cloudEnabled ? "auth" : "guest";
let authView = "signin";
let currentUser = null;
let sync = null;
let syncStatus = cloudEnabled ? "Sign in" : "Local only";
let syncError = "";
let guestState = null;
let recovery = false;
let activationPromise = null;
const paydayConfig = () => ({ ...defaultPayday(), ...state.payday, checkins: state.payday?.checkins || {}, rules: state.payday?.rules || [] });
const paydayState = () => (state.payday ||= paydayConfig());
function currentPaydayCycle() {
  return latestDuePayday(new Date(), paydayConfig());
}
function checkPaydayPrompt() {
  if (mode !== "cloud" || modal || !["Synced", "Offline"].includes(syncStatus)) return;
  const p = paydayConfig();
  const cycle = shouldPromptPayday(new Date(), p, state.transactions, p.checkins, state.createdAt);
  if (cycle) openPayday(cycle, true);
}
const nav = [
  ["dashboard", "Dashboard", "grid"],
  ["transactions", "Transactions", "table"],
  ["weekly", "Weekly Budget", "calendar"],
  ["monthly", "Monthly Budget", "calendar"],
  ["bills", "Bills", "receipt"],
  ["goals", "Savings Goals", "target"],
  ["gambling", "Gambling Tracker", "chart"],
  ["analytics", "Analytics", "chart"],
  ["settings", "Settings", "settings"],
];
const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  table:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  receipt:
    '<path d="M4 3h16v18l-4-2-4 2-4-2-4 2V3Z"/><path d="M8 8h8M8 12h8"/>',
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M3 3v18h18M7 16l4-5 4 2 5-7"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.07.07-2.86 2.86-.07-.07A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1.2 1.6V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.07.07-2.86-2.86.07-.07A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-1.6-1.2H2.5v-4h.1A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.07-.07 2.86-2.86.07.07A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1.2-1.6V2.5h4v.1A1.7 1.7 0 0 0 15 4.2a1.7 1.7 0 0 0 1.88-.34l.07-.07 2.86 2.86-.07.07A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 1.6 1.2h.1v4H21a1.7 1.7 0 0 0-1.6 1.2Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  upload: '<path d="M12 21V9m-4 4 4-4 4 4M4 7V3h16v4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  wallet:
    '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 15h2"/>',
  spark:
    '<path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 18l.6 1.4L21 20l-1.4.6L19 22l-.6-1.4L17 20l1.4-.6L19 18Z"/>',
};
const icon = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.grid}</svg>`;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) => money(n, state.settings.currency);
const niceDate = (s) =>
  s
    ? dateObj(s).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const shortDate = (s) =>
  s
    ? dateObj(s).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "—";
const monthLabel = (s) =>
  dateObj(s).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const statusOptions = (type) =>
  type === "Income"
    ? ["Received", "Expected"]
    : type === "Expense"
      ? ["Paid", "Upcoming"]
      : ["Cleared", "Planned"];
const option = (value, label, selected) =>
  `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;
const catOptions = (selected) =>
  state.categories.map((c) => option(c, c, selected)).join("");
const typeOptions = (selected) =>
  ["Income", "Expense", "Transfer", "Savings"]
    .map((t) => option(t, t, selected))
    .join("");
const select = (name, items, selected, extra = "") =>
  `<select name="${name}" ${extra}>${items.map((x) => option(x, x, selected)).join("")}</select>`;
const button = (label, action, variant = "secondary", extra = "") =>
  `<button type="button" class="btn btn-${variant}" data-action="${action}" ${extra}>${label}</button>`;
const empty = (title, copy, action, label) =>
  `<div class="empty">${icon("spark", 28)}<h3>${title}</h3><p>${copy}</p>${action ? button(label, action, "primary") : ""}</div>`;
const card = (label, value, iconName, tone = "") =>
  `<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${tone}">${icon(iconName, 17)}</span></div><strong>${value}</strong></div>`;
const titleRow = (eyebrow, title, description, actions = "") =>
  `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
const tabPeriod = () =>
  `<div class="period-controls"><div class="segmented">${[
    ["week", "Week"],
    ["month", "Month"],
    ["year", "Year"],
    ["custom", "Custom"],
  ]
    .map(
      ([v, l]) =>
        `<button type="button" class="${period === v ? "active" : ""}" data-action="period" data-value="${v}">${l}</button>`,
    )
    .join(
      "",
    )}</div>${period === "custom" ? `<input type="date" data-custom="from" value="${custom.from}"><span>to</span><input type="date" data-custom="to" value="${custom.to}">` : `<div class="date-step">${button("‹", "prev-period")}<span>${period === "week" ? `${shortDate(periodRange(period, anchor, custom, state.settings.weekStarts).from)} – ${shortDate(periodRange(period, anchor, custom, state.settings.weekStarts).to)}` : period === "year" ? anchor.slice(0, 4) : monthLabel(anchor)}</span>${button("›", "next-period")}</div>`}</div>`;
const txValue = (t, col) =>
  col === "amountCents" ? (t.amountCents / 100).toFixed(2) : (t[col] ?? "");

function notify(message, bad = false) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = `toast ${bad ? "toast-bad" : ""}`;
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3500);
}
async function persist() {
  const snapshot = structuredClone(state);
  const userId = mode === "cloud" ? currentUser?.id : null;
  try {
    writeThrough(snapshot, userId);
  } catch (e) {
    notify(`Local backup could not be saved: ${e.message}`, true);
  }
  pendingSave = pendingSave.catch(() => {}).then(() => saveState(snapshot, userId));
  try {
    await pendingSave;
  } catch (e) {
    notify(`Could not save: ${e.message}`, true);
  }
  if (!userId) guestState = structuredClone(snapshot);
  if (userId) sync?.localChanged();
}
function remember() {
  undoStack.push(structuredClone(state));
  if (undoStack.length > 30) undoStack.shift();
}
function changed(message) {
  persist();
  render();
  if (message) notify(message);
}
function undo() {
  if (!undoStack.length) return notify("Nothing to undo.");
  state = undoStack.pop();
  changed("Change undone.");
}
function download(name, content, type) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([content], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function currentRange() {
  return periodRange(period, anchor, custom, state.settings.weekStarts);
}
function billOccurrences(range) {
  let occurrences = [];
  for (const bill of state.bills) {
    let d = bill.nextDue,
      n = 0;
    while (d <= range.to && n < 500) {
      if (d >= range.from) occurrences.push({ ...bill, due: d });
      const next = nextDue(d, bill.frequency);
      if (next <= d) break;
      d = next;
      n++;
    }
  }
  return occurrences.sort((a, b) => a.due.localeCompare(b.due));
}
function upcomingBills(range) {
  return billOccurrences(range).filter(
    (b) => !b.lastPaidDate || b.due > b.lastPaidDate,
  );
}
function goalSaved(goal) {
  return sum(goal.movements, (m) => m.amountCents);
}
function allocationsFor(week) {
  return state.allocations[week] || {};
}
function estimatedPay(excludeWeek = null) {
  const paycheckRows = state.transactions.filter((t) => t.paydayCycle && t.type === "Income" && actual(t));
  const incomes = (paycheckRows.length ? paycheckRows : state.transactions).filter(
    (t) => t.type === "Income" && actual(t) && t.date >= addDays(today(), -84) &&
      (!excludeWeek || weekStart(t.date, state.settings.weekStarts) !== excludeWeek),
  );
  const weeks = new Set(
    incomes.map((t) => weekStart(t.date, state.settings.weekStarts)),
  );
  return weeks.size ? Math.round(sum(incomes) / weeks.size) : 0;
}
function forecastWeekOut(planned, bills) {
  const projected = { ...planned };
  for (const [category, amount] of Object.entries(
    groupSum(bills, (bill) => bill.category),
  )) {
    projected[category] = Math.max(projected[category] || 0, amount);
  }
  return sum(Object.values(projected), (amount) => amount);
}
function paydayPreview(cycle, amountCents) {
  return paydayPlan(amountCents, state.bills, paydayConfig().rules, cycle);
}
function paydayPlanHtml(plan, amountCents) {
  const scale = Math.max(1, amountCents);
  const billWidth = Math.min(100, (plan.reserveCents / scale) * 100);
  const savedWidth = Math.min(100 - billWidth, (plan.savingsCents / scale) * 100);
  const spendWidth = Math.max(0, Math.min(100 - billWidth - savedWidth, (plan.spendingCents / scale) * 100));
  return `<div class="payday-breakdown" aria-label="Suggested paycheck breakdown"><span class="bills" style="width:${billWidth}%"></span><span class="savings" style="width:${savedWidth}%"></span><span class="spending" style="width:${spendWidth}%"></span></div><div class="payday-legend"><span><i class="dot amber"></i> Bills</span><span><i class="dot violet"></i> Savings</span><span><i class="dot green"></i> Available</span></div><div class="payday-facts"><div><span>Bills before next payday</span><strong>${fmt(plan.dueCents)}</strong></div><div><span>Optional sinking funds</span><strong>${fmt(plan.sinkingCents)}</strong></div><div><span>Suggested bill reserves</span><strong>${fmt(plan.reserveCents)}</strong></div><div><span>After bill reservations</span><strong class="${plan.afterBillsCents < 0 ? "negative" : ""}">${fmt(plan.afterBillsCents)}</strong></div><div><span>Planned savings</span><strong>${fmt(plan.savingsCents)}</strong></div><div><span>Spending allowance</span><strong>${fmt(plan.spendingCents)}</strong></div><div><span>Unallocated money</span><strong>${fmt(plan.unallocatedCents)}</strong></div>${plan.shortageCents ? `<div class="negative"><span>Shortage or plan adjustments needed</span><strong>${fmt(plan.shortageCents)}</strong></div>` : ""}</div>${plan.due.length ? `<p class="muted">Due before ${shortDate(plan.nextPayday)}: ${plan.due.map((bill) => `${esc(bill.name)} ${fmt(bill.amountCents)}`).join(" · ")}</p>` : '<p class="muted">No bills due before the next payday.</p>'}${plan.allocations.length ? `<div class="payday-rule-preview">${plan.allocations.map((a) => `<div><span>${esc(a.category)} · priority ${a.priority}</span><strong>${fmt(a.suggestedCents)}${a.shortCents ? ` <small class="negative">${fmt(a.shortCents)} short</small>` : ""}</strong></div>`).join("")}</div>` : ""}<p class="muted">Recommendations are plans. No bill is marked paid and no savings is transferred.</p>`;
}
function paydayPanel(cycle = currentPaydayCycle()) {
  const paycheck = state.transactions.find((t) => t.paydayCycle === cycle && t.type === "Income" && t.status === "Received");
  const plan = paycheck ? paydayPreview(cycle, paycheck.amountCents) : null;
  const missed = missedPaydays(new Date(), paydayConfig(), state.transactions, paydayConfig().checkins, 8, addDays(state.createdAt, -7));
  return `<section class="panel payday-panel"><div class="panel-head"><div><div class="eyebrow">PAYDAY ROUTINE</div><h2>${paycheck ? "Your payday plan" : "Ready for your next check-in"}</h2><p>${paycheck ? `Actual take-home pay ${fmt(paycheck.amountCents)} · ${shortDate(cycle)}` : `Payday ${shortDate(cycle)} · ${esc(paydayConfig().timeZone)}`}</p></div>${button(paycheck ? "Review check-in" : "Enter paycheck", "open-payday", "primary", `data-value="${cycle}"`)}</div>${plan ? paydayPlanHtml(plan, paycheck.amountCents) : `<p class="muted">Enter your actual pay to see bill reserves and a flexible plan. A forecast never counts as received income.</p>`}${missed.length ? `<p class="muted">${missed.length} recent payday${missed.length === 1 ? "" : "s"} available to backfill from the check-in.</p>` : ""}</section>`;
}
function render() {
  if (mode === "auth" || recovery) {
    root.innerHTML = authPage();
    return;
  }
  const active = nav.find((x) => x[0] === page) || nav[0];
  root.innerHTML = `<div class="shell"><aside class="sidebar ${mobileNav ? "open" : ""}"><div class="brand"><span class="brand-mark">N</span><span>northstar<span class="brand-dot">.</span><small>PERSONAL FINANCE</small></span></div><div class="workspace-label">WORKSPACE</div><nav aria-label="Main navigation">${nav.map(([id, label, ico]) => `<button type="button" class="nav-item ${page === id ? "active" : ""}" data-page="${id}">${icon(ico)}<span>${label}</span>${page === id ? '<span class="nav-indicator"></span>' : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="privacy-note">${icon("wallet", 18)}<span>${mode === "cloud" ? "Cloud sync with<br>local offline cache." : "Your data stays in<br>this browser."}</span></div><div class="sidebar-footer">NORTHSTAR <span>v2.2</span></div></div></aside>${mobileNav ? '<button class="mobile-scrim" data-action="toggle-nav" aria-label="Close menu"></button>' : ""}<div class="main-wrap"><header class="topbar"><div class="top-left"><button class="mobile-menu icon-button" data-action="toggle-nav" aria-label="Open menu">${icon("menu")}</button><span class="breadcrumb">Workspace</span>${icon("chevron", 14)}<strong>${active[1]}</strong></div><div class="top-actions"><span class="sync-status" title="${esc(syncError)}">${esc(syncStatus)}</span>${button(`${icon("spark", 15)}<span>Payday check-in</span>`, "open-payday", "secondary", 'aria-label="Open payday check-in"') }<button class="global-search" data-action="global-search">${icon("search", 16)}<span>Search transactions</span><kbd>Ctrl K</kbd></button><span class="top-divider"></span>${button(`${icon("plus", 16)}<span>Quick add</span>`, "quick-add", "primary")}</div></header><main class="main-content">${renderPage()}</main></div></div>${modal ? renderModal() : ""}`;
}
function authPage() {
  const heading = recovery
    ? ["Choose a new password", "Your reset link is ready."]
    : authView === "register"
      ? ["Create your account", "Your budget will sync across your devices."]
      : authView === "reset"
        ? ["Reset your password", "We'll send a recovery link to your email."]
        : ["Welcome back", "Sign in to your private financial workspace."];
  const form = recovery
    ? `<form id="recovery-form" class="form-stack"><label>New password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><button class="btn btn-primary" type="submit">Update password</button></form>`
    : authView === "reset"
      ? `<form id="reset-form" class="form-stack"><label>Email<input name="email" type="email" required autocomplete="email"></label><button class="btn btn-primary" type="submit">Send reset link</button></form>`
      : `<form id="${authView === "register" ? "register-form" : "signin-form"}" class="form-stack"><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" minlength="8" required autocomplete="${authView === "register" ? "new-password" : "current-password"}"></label><button class="btn btn-primary" type="submit">${authView === "register" ? "Create account" : "Sign in"}</button></form>`;
  return `<div class="auth-shell"><div class="auth-brand"><span class="brand-mark">N</span><span>northstar<span class="brand-dot">.</span></span></div><section class="panel auth-panel"><div class="eyebrow">PERSONAL FINANCE</div><h1>${heading[0]}</h1><p>${heading[1]}</p>${form}<div class="auth-links">${authView !== "signin" && !recovery ? button("Sign in", "show-signin") : ""}${authView !== "register" && !recovery ? button("Create account", "show-register") : ""}${authView !== "reset" && !recovery ? button("Forgot password?", "show-reset") : ""}</div>${!recovery ? `<div class="divider"></div><p class="muted">${hasFinancialData(guestState || freshState()) ? "Existing records on this browser remain available. Sign in to review an import." : "You can also keep records only in this browser."}</p>${button("Continue with local data", "guest-mode")}` : ""}</section></div>`;
}
function setSyncStatus(value, error = "") {
  syncStatus = value;
  syncError = error;
  const indicator = document.querySelector(".sync-status");
  if (indicator) {
    indicator.textContent = value;
    indicator.title = error;
    indicator.dataset.state = value.toLowerCase().replaceAll(" ", "-");
  }
  const paydayIndicator = document.querySelector(".payday-sync-state");
  if (paydayIndicator) paydayIndicator.textContent = mode !== "cloud" ? "Saved on this browser only" : value === "Synced" ? "Saved to cloud" : value === "Offline" ? "Pending sync · offline" : value === "Saving" ? "Saving to cloud…" : value;
  if (value === "Synced" || value === "Offline") setTimeout(checkPaydayPrompt, 0);
}
function renderPage() {
  switch (page) {
    case "transactions":
      return transactionsPage();
    case "weekly":
      return weeklyPage();
    case "monthly":
      return monthlyPage();
    case "bills":
      return billsPage();
    case "goals":
      return goalsPage();
    case "analytics":
      return analyticsPage();
    case "gambling":
      return gamblingPage();
    case "settings":
      return settingsPage();
    default:
      return dashboardPage();
  }
}

function dashboardPage() {
  const range = currentRange(),
    m = metrics(state.transactions, range, state.settings.startingBalanceCents),
    upcoming = upcomingBills(range),
    billTotal = sum(upcoming, (b) => b.amountCents),
    available = m.remaining - billTotal;
  const prev =
    period === "week"
      ? { from: addDays(range.from, -7), to: addDays(range.to, -7) }
      : period === "year"
        ? { from: addMonths(range.from, -12), to: addMonths(range.to, -12) }
        : {
            from: monthStart(addDays(range.from, -1)),
            to: addDays(range.from, -1),
          };
  const pm = metrics(state.transactions, prev),
    diff = m.expenses - pm.expenses;
  const expenses = m.rows.filter((t) => t.type === "Expense"),
    byCategory = Object.entries(groupSum(expenses, (t) => t.category)).sort(
      (a, b) => b[1] - a[1],
    );
  const weeklyGroups = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(
      range.from,
      Math.floor(
        (((dateObj(range.to) - dateObj(range.from)) / 86400000) * i) / 6,
      ),
    );
    return {
      label: shortDate(d),
      income: sum(m.rows.filter((t) => t.type === "Income" && t.date <= d)),
      expense: sum(expenses.filter((t) => t.date <= d)),
    };
  });
  return `${titleRow("OVERVIEW", "Good to see you.", "Your money, in focus. Every figure comes from your entries.", button(`${icon("plus", 16)} Add transaction`, "new-transaction", "primary"))}${tabPeriod()}<div class="stats-grid">${card("Total income", fmt(m.income), "arrow", "green")}${card("Total expenses", fmt(m.expenses), "wallet", "rose")}${card("Money remaining", fmt(m.remaining), "wallet", "blue")}${card("Savings moved", fmt(m.savings), "target", "violet")}${card("Upcoming bills", fmt(billTotal), "receipt", "amber")}${card("Available to spend", fmt(available), "spark", "green")}</div><div class="dashboard-grid"><section class="panel span-2"><div class="panel-head"><div><h2>Cash flow</h2><p>Income and expenses through the selected period</p></div><span class="legend"><i class="dot green"></i> Income <i class="dot slate"></i> Expenses</span></div>${lineChart(weeklyGroups)}</section><section class="panel"><div class="panel-head"><div><h2>Spending by category</h2><p>Where your money went</p></div></div>${categoryBars(byCategory, m.expenses)}</section><section class="panel"><div class="panel-head"><div><h2>Financial pulse</h2><p>Useful context at a glance</p></div></div><div class="insights"><div><span>Spending vs. previous period</span><strong class="${diff > 0 ? "negative" : "positive"}">${pm.expenses ? `${diff > 0 ? "+" : ""}${Math.round((diff / pm.expenses) * 100)}%` : m.expenses ? "New activity" : "—"}</strong></div><div><span>Largest expense category</span><strong>${esc(byCategory[0]?.[0] || "—")}</strong></div><div><span>Current cash balance</span><strong>${fmt(m.balance)}</strong></div><div><span>Recorded transactions</span><strong>${m.rows.length}</strong></div></div></section><section class="panel span-2"><div class="panel-head"><div><h2>Recent activity</h2><p>Your latest confirmed entries</p></div><button class="text-button" data-page="transactions">View all ${icon("arrow", 15)}</button></div>${recentRows(m.rows)}</section><section class="panel"><div class="panel-head"><div><h2>Coming due</h2><p>Bills in this period</p></div><button class="text-button" data-page="bills">Manage ${icon("arrow", 15)}</button></div>${
    upcoming.length
      ? upcoming
          .slice(0, 5)
          .map(
            (b) =>
              `<div class="mini-row"><span class="mini-icon">${icon("receipt", 16)}</span><div><strong>${esc(b.name)}</strong><small>${shortDate(b.due)}</small></div><strong>${fmt(b.amountCents)}</strong></div>`,
          )
          .join("")
      : empty(
          "All clear",
          "No bills due in this period.",
          "new-bill",
          "Add bill",
        )
  }</section>${dashboardExtras(range)}</div>`;
}
function dashboardExtras(range) {
  const weekEnd = weekStart(range.to, state.settings.weekStarts);
  const weekly = Array.from({ length: 7 }, (_, i) => {
    const start = addDays(weekEnd, (i - 6) * 7);
    return {
      label: shortDate(start),
      value: sum(
        state.transactions.filter(
          (t) =>
            t.type === "Expense" &&
            actual(t) &&
            t.date >= start &&
            t.date <= addDays(start, 6),
        ),
      ),
    };
  });
  const month = monthStart(range.to);
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const start = addMonths(month, i - 5);
    return {
      label: dateObj(start).toLocaleDateString(undefined, { month: "short" }),
      value: sum(
        state.transactions.filter(
          (t) =>
            t.type === "Income" &&
            actual(t) &&
            t.date >= start &&
            t.date <= monthEnd(start),
        ),
      ),
    };
  });
  return `<section class="panel"><div class="panel-head"><div><h2>Weekly spending</h2><p>Last seven financial weeks</p></div></div>${barTrend(weekly, "rose")}</section><section class="panel"><div class="panel-head"><div><h2>Monthly income</h2><p>Last six calendar months</p></div></div>${barTrend(monthly, "green")}</section><section class="panel"><div class="panel-head"><div><h2>Savings progress</h2><p>Your active goals</p></div></div>${
    state.goals.length
      ? state.goals
          .slice(0, 4)
          .map((goal) => {
            const saved = goalSaved(goal);
            const percent = goal.targetCents
              ? Math.max(0, Math.min(100, (saved / goal.targetCents) * 100))
              : 0;
            return `<div class="goal-summary"><div><strong>${esc(goal.name)}</strong><span>${fmt(saved)} / ${fmt(goal.targetCents)}</span></div><div class="goal-track"><div style="width:${percent}%"></div></div></div>`;
          })
          .join("")
      : empty(
          "No savings goals",
          "Create a goal to see progress here.",
          "new-goal",
          "Create goal",
        )
  }</section>`;
}
function barTrend(rows, tone) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  if (!max)
    return empty(
      "No trend yet",
      "Confirmed transactions will draw this chart.",
    );
  return `<div class="spark-bars">${rows.map((row) => `<div class="spark-column"><div class="spark-bar ${tone}" style="height:${row.value ? Math.max(3, (row.value / max) * 100) : 0}%" title="${esc(row.label)}: ${fmt(row.value)}"></div><span>${esc(row.label)}</span></div>`).join("")}</div>`;
}
function lineChart(data) {
  const max = Math.max(100, ...data.flatMap((x) => [x.income, x.expense]));
  const p = (key) =>
    data
      .map((x, i) => `${36 + i * 86},${172 - (x[key] / max) * 138}`)
      .join(" ");
  return `<div class="chart-wrap"><svg viewBox="0 0 600 210" role="img" aria-label="Cumulative income and expenses chart"><g class="chart-grid"><path d="M36 34H588M36 80H588M36 126H588M36 172H588"/></g><polyline points="${p("income")}" fill="none" stroke="#75d5ad" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${p("expense")}" fill="none" stroke="#8291a7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${data.map((x, i) => `<circle cx="${36 + i * 86}" cy="${172 - (x.income / max) * 138}" r="5" fill="#75d5ad"><title>${x.label}: income ${fmt(x.income)}</title></circle><circle cx="${36 + i * 86}" cy="${172 - (x.expense / max) * 138}" r="5" fill="#8291a7"><title>${x.label}: expenses ${fmt(x.expense)}</title></circle>`).join("")}</svg><div class="chart-labels">${data.map((x) => `<span>${x.label}</span>`).join("")}</div></div>`;
}
function categoryBars(rows, total) {
  return rows.length
    ? `<div class="category-list">${rows
        .slice(0, 6)
        .map(
          ([name, n], i) =>
            `<div class="category-row"><div><span class="category-dot dot-${i % 6}"></span><span>${esc(name)}</span><strong>${fmt(n)}</strong></div><div class="bar-track"><div style="width:${Math.round((n / total) * 100)}%"></div></div></div>`,
        )
        .join("")}</div>`
    : empty(
        "No spending yet",
        "Expense categories appear here after you add a paid expense.",
      );
}
function recentRows(rows) {
  const recent = [...rows]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  return recent.length
    ? `<div class="recent-list">${recent
        .map((t) => {
          const incoming =
            t.type === "Income" ||
            (t.type === "Savings" && t.direction === "in");
          return `<div class="recent-row"><span class="transaction-badge ${t.type.toLowerCase()}">${icon(incoming ? "arrow" : "wallet", 16)}</span><div><strong>${esc(t.description)}</strong><small>${esc(t.category)} · ${shortDate(t.date)}</small></div><strong class="${incoming ? "positive" : ""}">${incoming ? "+" : "−"}${fmt(t.amountCents)}</strong></div>`;
        })
        .join("")}</div>`
    : empty(
        "Your canvas is ready",
        "Add your first paycheck or expense to bring this dashboard to life.",
        "new-transaction",
        "Add first entry",
      );
}

const columns = [
  ["date", "Date"],
  ["description", "Description"],
  ["category", "Category"],
  ["type", "Type"],
  ["amountCents", "Amount"],
  ["status", "Status"],
  ["notes", "Notes"],
];
function filteredTransactions() {
  let rows = state.transactions.filter((t) => {
    const q = search.toLowerCase();
    return (
      (!q ||
        [t.description, t.category, t.notes, t.type].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(q),
        )) &&
      (filterType === "All" || t.type === filterType) &&
      (filterCategory === "All" || t.category === filterCategory) &&
      (filterStatus === "All" || t.status === filterStatus)
    );
  });
  rows.sort((a, b) => {
    const av =
        sortBy === "amountCents"
          ? a.amountCents
          : String(a[sortBy] || "").toLowerCase(),
      bv =
        sortBy === "amountCents"
          ? b.amountCents
          : String(b[sortBy] || "").toLowerCase();
    return av < bv ? -sortDir : av > bv ? sortDir : 0;
  });
  return rows;
}
function transactionsPage() {
  const rows = filteredTransactions(),
    income = sum(rows.filter((t) => t.type === "Income" && actual(t))),
    expense = sum(rows.filter((t) => t.type === "Expense" && actual(t)));
  return `${titleRow("YOUR LEDGER", "Transactions", "A flexible workspace for every paycheck, purchase, and transfer.", `${button(`${icon("upload", 16)} Import CSV`, "import-csv")}${button(`${icon("download", 16)} Export CSV`, "export-csv")}${button(`${icon("plus", 16)} Add row`, "new-row", "primary")}`)}<div class="toolbar"><label class="search-field">${icon("search", 17)}<input id="transaction-search" type="search" placeholder="Search transactions…" value="${esc(search)}" aria-label="Search transactions"></label><select id="filter-type" aria-label="Filter type">${["All", "Income", "Expense", "Transfer", "Savings"].map((v) => option(v, v === "All" ? "All types" : v, filterType)).join("")}</select><select id="filter-category" aria-label="Filter category">${option("All", "All categories", filterCategory)}${catOptions(filterCategory)}</select><select id="filter-status" aria-label="Filter status">${["All", "Received", "Expected", "Paid", "Upcoming", "Cleared", "Planned"].map((v) => option(v, v === "All" ? "All statuses" : v, filterStatus)).join("")}</select>${button(`${icon("undo", 15)} Undo`, "undo", "", 'title="Undo last edit"')}</div><div class="table-panel"><div class="table-scroll"><table class="ledger"><thead><tr>${columns.map(([key, label]) => `<th><button data-action="sort" data-value="${key}">${label}${sortBy === key ? ` <span>${sortDir === -1 ? "↓" : "↑"}</span>` : ""}</button></th>`).join("")}<th class="actions-cell">Actions</th></tr></thead><tbody>${rows.map((t) => transactionRow(t)).join("")}</tbody><tfoot><tr><td colspan="4">${rows.length} ${rows.length === 1 ? "row" : "rows"} · Confirmed totals</td><td class="num">${fmt(income - expense)}</td><td colspan="3"><span class="positive">+${fmt(income)}</span> <span class="muted">/</span> <span class="negative">−${fmt(expense)}</span></td></tr></tfoot></table>${!rows.length ? empty(state.transactions.length ? "No matches" : "A clean slate", state.transactions.length ? "Try changing your filters." : "Add a row to start tracking your money.", "new-row", "Add row") : ""}</div></div><p class="table-help">Click any cell to edit. Tab and Shift+Tab move between cells. Paste a rectangular selection from a spreadsheet into a cell. Changes save automatically.</p>`;
}
function transactionRow(t) {
  return `<tr data-id="${t.id}" class="row-${t.type.toLowerCase()}">${columns
    .map(
      ([key]) =>
        `<td class="${key === "amountCents" ? "num" : ""}">${
          key === "category"
            ? `<select class="cell-select" data-cell="${key}" aria-label="Category for ${esc(t.description)}">${catOptions(t.category)}</select>`
            : key === "type"
              ? `<select class="cell-select" data-cell="${key}" aria-label="Type for ${esc(t.description)}">${typeOptions(t.type)}</select>`
              : key === "status"
                ? `<select class="cell-select status-${esc(t.status.toLowerCase())}" data-cell="${key}" aria-label="Status for ${esc(t.description)}">${statusOptions(
                    t.type,
                  )
                    .map((v) => option(v, v, t.status))
                    .join("")}</select>`
                : `<input class="cell-input ${key === "amountCents" ? "amount-input" : ""}" data-cell="${key}" type="${key === "date" ? "date" : "text"}" value="${esc(txValue(t, key))}" aria-label="${key} for ${esc(t.description)}" ${key === "amountCents" ? 'inputmode="decimal"' : ""}>`
        }</td>`,
    )
    .join(
      "",
    )}<td class="actions-cell"><button class="row-action" data-action="duplicate-row" data-id="${t.id}" title="Duplicate row" aria-label="Duplicate row">${icon("plus", 15)}</button><button class="row-action" data-action="delete-row" data-id="${t.id}" title="Delete row" aria-label="Delete row">${icon("x", 15)}</button></td></tr>`;
}

function weeklyPage() {
  const start = selectedWeek,
    end = addDays(start, 6),
    range = { from: start, to: end },
    m = metrics(state.transactions, range),
    bills = upcomingBills(range),
    planned = allocationsFor(start),
    plannedTotal = sum(Object.values(planned), (x) => x),
    expected = state.payPlans?.[start] ?? estimatedPay(start),
    forecastIncome = m.income || expected,
    forecastOut = forecastWeekOut(planned, bills),
    previousPlan = allocationsFor(addDays(start, -7));
  const actions = `${button(`${icon("plus", 16)} Add allocation`, "new-allocation", "primary")}${button("Set expected pay", "set-expected-pay")}${Object.keys(previousPlan).length ? button("Use last week's plan", "copy-plan") : ""}`;
  return `${titleRow("WEEKLY PLAN", "Make this week count.", "Plan your paycheck before it disappears into the details.", actions)}<div class="period-controls"><div class="date-step">${button("‹", "prev-week")}<span>${shortDate(start)} – ${niceDate(end)}</span>${button("›", "next-week")}</div><span class="muted">Week starts ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][state.settings.weekStarts]}</span></div><div class="stats-grid four">${card(state.payPlans?.[start] != null ? "Expected pay · your plan" : expected ? "Estimated pay · history" : "No pay forecast", fmt(expected), "arrow", "green")}${card("Actual income", fmt(m.income), "wallet", "blue")}${card("Planned outflow", fmt(forecastOut), "receipt", "amber")}${card("Actual remaining", fmt(m.remaining), "target", m.remaining < 0 ? "rose" : "green")}</div>${paydayPanel(cycleForDate(addDays(start, 6), paydayConfig().weekday))}<div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Category allocations</h2><p>Planning does not change your cash balance</p></div></div>${
    Object.keys(planned).length
      ? `<div class="allocation-list">${Object.entries(planned)
          .map(([cat, amount]) => {
            const spent = sum(
              m.rows.filter((t) => t.type === "Expense" && t.category === cat),
            );
            return `<div class="allocation-row"><div><strong>${esc(cat)}</strong><small>${fmt(spent)} spent of ${fmt(amount)}</small></div><div class="allocation-progress"><div style="width:${Math.min(100, amount ? (spent / amount) * 100 : 0)}%"></div></div><button class="row-action" data-action="delete-allocation" data-value="${esc(cat)}" aria-label="Remove ${esc(cat)} allocation">${icon("x", 15)}</button></div>`;
          })
          .join("")}</div>`
      : empty(
          "No allocations yet",
          "Give each category a plan for this week.",
          "new-allocation",
          "Add allocation",
        )
  }<div class="panel-total"><span>Unallocated from income plan</span><strong>${fmt(forecastIncome - forecastOut)}</strong></div></section><section class="panel"><div class="panel-head"><div><h2>This week</h2><p>Actual entries and obligations</p></div></div><div class="insights"><div><span>Forecast remaining</span><strong>${fmt(forecastIncome - forecastOut)}</strong></div><div><span>Actual expenses</span><strong>${fmt(m.expenses)}</strong></div><div><span>Savings transfers</span><strong>${fmt(m.savings)}</strong></div><div><span>Over / under plan</span><strong class="${plannedTotal - m.expenses >= 0 ? "positive" : "negative"}">${fmt(plannedTotal - m.expenses)}</strong></div></div><h3 class="subheading">Bills due</h3>${bills.length ? bills.map((b) => `<div class="mini-row"><span class="mini-icon">${icon("receipt", 16)}</span><div><strong>${esc(b.name)}</strong><small>${shortDate(b.due)}</small></div><strong>${fmt(b.amountCents)}</strong></div>`).join("") : '<p class="muted compact">No bills due this week.</p>'}</section></div>${incomeHistory()}${paydayHistorySection()}`;
}
function incomeHistory() {
  const paychecks = state.transactions
    .filter((t) => t.type === "Income" && actual(t))
    .sort((a, b) => b.date.localeCompare(a.date));
  const weeks = Object.entries(
    groupSum(paychecks, (t) => weekStart(t.date, state.settings.weekStarts)),
  )
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 8);
  return `<section class="panel income-history"><div class="panel-head"><div><h2>Income history</h2><p>Every received paycheck and other income entry</p></div><button class="text-button" data-page="transactions">Open ledger ${icon("arrow", 15)}</button></div>${
    paychecks.length
      ? `<div class="income-history-grid"><div><h3 class="subheading">Recent entries</h3>${paychecks
          .slice(0, 8)
          .map(
            (t) =>
              `<div class="mini-row"><span class="mini-icon">${icon("arrow", 16)}</span><div><strong>${esc(t.description)}</strong><small>${shortDate(t.date)} · ${esc(t.category)}</small></div><strong class="positive">+${fmt(t.amountCents)}</strong><button class="row-action" data-action="edit-transaction" data-id="${t.id}" aria-label="Edit ${esc(t.description)}">${icon("settings", 15)}</button></div>`,
          )
          .join(
            "",
          )}</div><div><h3 class="subheading">Weekly totals</h3>${weeks.map(([week, amount]) => `<div class="mini-row"><div><strong>${shortDate(week)} – ${shortDate(addDays(week, 6))}</strong></div><strong>${fmt(amount)}</strong></div>`).join("")}</div></div>`
      : empty(
          "No income history yet",
          "Add a received paycheck to start your history.",
          "new-transaction",
          "Add income",
        )
  }</section>`;
}

function paydayHistorySection() {
  const history = paycheckHistory(state.transactions, zonedNow(new Date(), paydayConfig().timeZone).date);
  const missed = missedPaydays(new Date(), paydayConfig(), state.transactions, paydayConfig().checkins, 16, addDays(state.createdAt, -7));
  const backfill = missed.find((date) => date !== currentPaydayCycle()) || addDays(currentPaydayCycle(), -7);
  return `<section class="panel income-history"><div class="panel-head"><div><h2>Paycheck history</h2><p>Confirmed take-home pay, separate from income forecasts</p></div>${button("Backfill a paycheck", "open-payday", "secondary", `data-value="${backfill}"`)}</div>${history.rows.length ? `<div class="stats-grid three">${card("Average paycheck", fmt(history.averageCents), "arrow", "green")}${card("Received this month", fmt(history.monthToDateCents), "wallet", "blue")}${card("Recorded paychecks", String(history.rows.length), "calendar", "violet")}</div><div class="paycheck-history">${history.rows.slice(0, 12).map((row) => `<div class="mini-row"><div><strong>${shortDate(row.date)}</strong><small>${esc(row.notes || "Paycheck")}</small></div><strong>${fmt(row.amountCents)}</strong><span class="${row.changeCents == null ? "muted" : row.changeCents < 0 ? "negative" : "positive"}">${row.changeCents == null ? "—" : `${row.changeCents >= 0 ? "+" : ""}${fmt(row.changeCents)}`}</span>${button("Edit", "open-payday", "secondary", `data-value="${row.paydayCycle}"`)}</div>`).join("")}</div>` : '<p class="muted">No completed payday check-ins yet.</p>'}</section>`;
}

function monthlyPage() {
  const start = selectedMonth,
    end = monthEnd(start),
    range = { from: start, to: end },
    m = metrics(state.transactions, range),
    prev = metrics(state.transactions, {
      from: monthStart(addDays(start, -1)),
      to: addDays(start, -1),
    }),
    due = upcomingBills(range),
    expected =
      m.income +
      estimatedPay() *
        Math.max(0, Math.ceil((dateObj(end) - dateObj(today())) / 604800000));
  const firstDay = dateObj(start).getDay(),
    days = dateObj(end).getDate();
  let cells = Array.from(
    { length: firstDay },
    () => '<div class="cal-empty"></div>',
  );
  for (let d = 1; d <= days; d++) {
    const date = `${start.slice(0, 8)}${String(d).padStart(2, "0")}`,
      items = state.transactions.filter((t) => t.date === date),
      bs = due.filter((b) => b.due === date);
    cells.push(
      `<button class="cal-day ${date === selectedDate ? "selected" : ""} ${date === today() ? "today" : ""}" data-action="select-date" data-value="${date}"><span>${d}</span>${items
        .slice(0, 2)
        .map(
          (t) =>
            `<small class="cal-event ${t.type.toLowerCase()}">${esc(t.description)}</small>`,
        )
        .join("")}${bs
        .slice(0, 1)
        .map((b) => `<small class="cal-event bill">${esc(b.name)}</small>`)
        .join(
          "",
        )}${items.length + bs.length > 3 ? `<small>+${items.length + bs.length - 3} more</small>` : ""}</button>`,
    );
  }
  const dayItems = state.transactions.filter((t) => t.date === selectedDate),
    dayBills = due.filter((b) => b.due === selectedDate);
  return `${titleRow("MONTHLY VIEW", "The bigger picture.", "Your calendar month, with every transaction on its actual date.", button(`${icon("plus", 16)} Add entry`, "new-transaction", "primary"))}<div class="period-controls"><div class="date-step">${button("‹", "prev-month")}<span>${monthLabel(start)}</span>${button("›", "next-month")}</div></div><div class="stats-grid four">${card("Income", fmt(m.income), "arrow", "green")}${card("Expenses", fmt(m.expenses), "wallet", "rose")}${card("Projected bills", fmt(sum(due, (b) => b.amountCents)), "receipt", "amber")}${card("Expected month end", fmt(expected - m.expenses - sum(due, (b) => b.amountCents)), "target", "blue")}</div><div class="two-col calendar-layout"><section class="panel calendar-panel"><div class="calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<span>${x}</span>`).join("")}</div><div class="calendar-grid">${cells.join("")}</div></section><section class="panel day-panel"><div class="panel-head"><div><h2>${niceDate(selectedDate)}</h2><p>${dayItems.length} transaction${dayItems.length === 1 ? "" : "s"}</p></div><button class="row-action" data-action="add-on-date" title="Add transaction on this date">${icon("plus", 18)}</button></div>${dayItems.length ? recentRows(dayItems) : '<p class="muted compact">No transactions on this day.</p>'}${dayBills.length ? `<h3 class="subheading">Bills due</h3>${dayBills.map((b) => `<div class="mini-row"><strong>${esc(b.name)}</strong><strong>${fmt(b.amountCents)}</strong></div>`).join("")}` : ""}<div class="divider"></div><div class="insights"><div><span>Previous month expenses</span><strong>${fmt(prev.expenses)}</strong></div><div><span>Change</span><strong class="${m.expenses - prev.expenses > 0 ? "negative" : "positive"}">${fmt(m.expenses - prev.expenses)}</strong></div></div></section></div>`;
}

function billsPage() {
  const rows = [...state.bills].sort((a, b) =>
    a.nextDue.localeCompare(b.nextDue),
  );
  return `${titleRow("RECURRING PAYMENTS", "Stay ahead of bills.", "Upcoming payments are forecasts until you record them as paid.", button(`${icon("plus", 16)} Add bill`, "new-bill", "primary"))}<div class="stats-grid three">${card("Active bills", String(rows.length), "receipt", "blue")}${card("Due in 30 days", fmt(sum(upcomingBills({ from: today(), to: addDays(today(), 30) }), (b) => b.amountCents)), "calendar", "amber")}${card("Overdue", String(rows.filter((b) => b.nextDue < today()).length), "wallet", "rose")}</div><section class="panel"><div class="panel-head"><div><h2>Your recurring bills</h2><p>Marking one paid creates a single expense transaction and advances its due date.</p></div></div>${rows.length ? `<div class="bill-list">${rows.map((b) => `<div class="bill-row"><span class="bill-icon">${icon("receipt", 19)}</span><div class="bill-name"><strong>${esc(b.name)}</strong><small>${esc(b.category)} · ${esc(b.frequency)} ${b.notes ? `· ${esc(b.notes)}` : ""}</small></div><div class="bill-due"><small>Next due</small><strong class="${b.nextDue < today() ? "negative" : ""}">${shortDate(b.nextDue)}</strong></div><strong class="bill-amount">${fmt(b.amountCents)}</strong><div class="bill-actions">${button("Record paid", "pay-bill", "secondary", `data-id="${b.id}"`)}<button class="row-action" data-action="edit-bill" data-id="${b.id}" aria-label="Edit ${esc(b.name)}">${icon("settings", 16)}</button><button class="row-action" data-action="delete-bill" data-id="${b.id}" aria-label="Delete ${esc(b.name)}">${icon("x", 16)}</button></div></div>`).join("")}</div>` : empty("No bills yet", "Add recurring obligations to see them in your weekly and monthly plans.", "new-bill", "Add bill")}</section>`;
}

function goalsPage() {
  return `${titleRow("SAVINGS", "Build toward what matters.", "Track contributions and withdrawals without counting them as spending.", button(`${icon("plus", 16)} New goal`, "new-goal", "primary"))}${
    state.goals.length
      ? `<div class="goal-grid">${state.goals
          .map((g) => {
            const saved = goalSaved(g),
              pct = g.targetCents
                ? Math.min(100, Math.max(0, (saved / g.targetCents) * 100))
                : 0;
            const recent = g.movements.filter(
                (m) => m.amountCents > 0 && m.date >= addDays(today(), -90),
              ),
              weekly = recent.length
                ? sum(recent, (m) => m.amountCents) / 13
                : 0,
              estimate =
                weekly > 0 && saved < g.targetCents
                  ? addDays(
                      today(),
                      Math.ceil(((g.targetCents - saved) / weekly) * 7),
                    )
                  : null;
            return `<section class="panel goal-card"><div class="goal-head"><span class="goal-icon">${icon("target", 20)}</span><div><button class="row-action" data-action="edit-goal" data-id="${g.id}" aria-label="Edit ${esc(g.name)}">${icon("settings", 16)}</button><button class="row-action" data-action="delete-goal" data-id="${g.id}" aria-label="Delete ${esc(g.name)}">${icon("x", 16)}</button></div></div><h2>${esc(g.name)}</h2><div class="goal-numbers"><strong>${fmt(saved)}</strong><span>of ${fmt(g.targetCents)}</span></div><div class="goal-track"><div style="width:${pct}%"></div></div><div class="goal-meta"><span>${Math.round(pct)}% complete</span><span>${fmt(Math.max(0, g.targetCents - saved))} left</span></div><p class="goal-estimate">${g.targetDate ? `Target: ${niceDate(g.targetDate)}` : estimate ? `Estimated completion: ${niceDate(estimate)}` : "Add contributions to see an estimate"}</p><div class="goal-actions">${button("Contribute", "goal-contribute", "secondary", `data-id="${g.id}"`)}${button("Withdraw", "goal-withdraw", "secondary", `data-id="${g.id}"`)}</div></section>`;
          })
          .join("")}</div>`
      : empty(
          "Make room for a goal",
          "Create a savings goal, then record contributions as you go.",
          "new-goal",
          "Create a goal",
        )
  }`;
}

function analyticsPage() {
  const range = currentRange(),
    m = metrics(state.transactions, range),
    expense = m.rows.filter((t) => t.type === "Expense"),
    income = m.rows.filter((t) => t.type === "Income"),
    byCategory = Object.entries(groupSum(expense, (t) => t.category)).sort(
      (a, b) => b[1] - a[1],
    );
  const days = Math.max(
      1,
      Math.round((dateObj(range.to) - dateObj(range.from)) / 86400000) + 1,
    ),
    weeks = days / 7,
    months = days / 30.4375;
  const series = [];
  let cursor = monthStart(range.from),
    guard = 0;
  while (cursor <= range.to && guard++ < 60) {
    const mr = { from: cursor, to: monthEnd(cursor) },
      mm = metrics(state.transactions, mr);
    series.push({
      label: dateObj(cursor).toLocaleDateString(undefined, {
        month: "short",
        year: "2-digit",
      }),
      income: mm.income,
      expense: mm.expenses,
    });
    cursor = addMonths(cursor, 1);
  }
  return `${titleRow("ANALYTICS", "Know your patterns.", "Only confirmed transactions appear in these reports.")}${tabPeriod()}<div class="stats-grid four">${card("Average weekly income", fmt(Math.round(m.income / weeks)), "arrow", "green")}${card("Average weekly spending", fmt(Math.round(m.expenses / weeks)), "wallet", "rose")}${card("Average monthly spending", fmt(Math.round(m.expenses / months)), "calendar", "blue")}${card("Savings rate", m.income ? `${Math.round((m.savings / m.income) * 100)}%` : "—", "target", "violet")}</div><div class="two-col"><section class="panel"><div class="panel-head"><div><h2>Monthly trends</h2><p>Income versus spending</p></div></div>${
    series.length
      ? `<div class="trend-chart">${series
          .map((x) => {
            const max = Math.max(
              100,
              ...series.flatMap((v) => [v.income, v.expense]),
            );
            return `<div class="trend-month"><div class="trend-bars"><div class="trend-income" style="height:${x.income ? Math.max(2, (x.income / max) * 100) : 0}%" title="${esc(x.label)} income: ${fmt(x.income)}"></div><div class="trend-expense" style="height:${x.expense ? Math.max(2, (x.expense / max) * 100) : 0}%" title="${esc(x.label)} expenses: ${fmt(x.expense)}"></div></div><span>${esc(x.label)}</span></div>`;
          })
          .join(
            "",
          )}</div><div class="legend trend-legend"><i class="dot green"></i> Income <i class="dot slate"></i> Expenses</div>`
      : empty("No trends yet", "Add transactions to see monthly patterns.")
  }</section><section class="panel"><div class="panel-head"><div><h2>Top spending categories</h2><p>Based on paid expenses</p></div></div>${categoryBars(byCategory, m.expenses)}</section></div><section class="panel analytics-bottom"><div class="panel-head"><div><h2>Budget versus actual</h2><p>Weekly allocations during the selected period</p></div></div>${
    Object.entries(state.allocations).filter(([week]) => inRange(week, range))
      .length
      ? `<div class="comparison-list">${Object.entries(state.allocations)
          .filter(([week]) => inRange(week, range))
          .map(([week, alloc]) => {
            const planned = sum(Object.values(alloc), (x) => x),
              actualSpent = sum(
                state.transactions.filter(
                  (t) =>
                    t.type === "Expense" &&
                    actual(t) &&
                    t.date >= week &&
                    t.date <= addDays(week, 6),
                ),
              );
            return `<div class="comparison-row"><strong>${shortDate(week)}</strong><span>Planned ${fmt(planned)}</span><span>Actual ${fmt(actualSpent)}</span><strong class="${planned - actualSpent >= 0 ? "positive" : "negative"}">${fmt(planned - actualSpent)} ${planned - actualSpent >= 0 ? "under" : "over"}</strong></div>`;
          })
          .join("")}</div>`
      : empty(
          "No budgets in this period",
          "Add weekly category allocations to compare your plan with actual spending.",
          "new-allocation",
          "Plan a week",
        )
  }</section>`;
}

function gamblingConfig() {
  return state.gambling || defaultGambling();
}
function gamblingLabel(kind) {
  return { scratch: "Scratch-offs", game: "Games", other: "Other gambling" }[kind] || "Other gambling";
}
function gamblingEntryLabel(kind) {
  return { scratch: "scratch-off", game: "game", other: "other gambling" }[kind] || "activity";
}
function netHtml(amount) {
  return `<strong class="${amount < 0 ? "negative" : amount > 0 ? "positive" : "muted"}">${amount > 0 ? "+" : amount < 0 ? "−" : ""}${fmt(Math.abs(amount))}</strong>`;
}
function visibleGamblingEntries() {
  const rows = gamblingConfig().entries.filter((e) => inRange(e.date, currentRange()) && e.kind === gamblingTab &&
    `${e.name} ${e.subcategory || ""} ${e.platform} ${e.notes}`.toLowerCase().includes(gamblingSearch.toLowerCase()));
  rows.sort((a, b) => {
    const av = gamblingSort === "net" ? gamblingNet(a) : gamblingSort === "stake" ? a.stakeCents : gamblingSort === "payout" ? a.payoutCents : String(a[gamblingSort] || "");
    const bv = gamblingSort === "net" ? gamblingNet(b) : gamblingSort === "stake" ? b.stakeCents : gamblingSort === "payout" ? b.payoutCents : String(b[gamblingSort] || "");
    return (typeof av === "number" ? av - bv : av.localeCompare(bv)) * gamblingSortDir;
  });
  return rows;
}
function gamblingPage() {
  const periodRows = gamblingConfig().entries.filter((e) => inRange(e.date, currentRange()));
  const rows = visibleGamblingEntries();
  const totals = gamblingTotals(periodRows), tabTotals = gamblingTotals(periodRows.filter((e) => e.kind === gamblingTab));
  const limit = gamblingLimit(gamblingConfig(), today(), state.settings.weekStarts);
  const weeks = gamblingGroups(periodRows, "week", state.settings.weekStarts).slice(0, 6);
  const months = gamblingGroups(periodRows, "month").slice(0, 6);
  const gameGroups = gamblingGroupsByName(periodRows.filter((e) => e.kind === gamblingTab));
  return `${titleRow("SPENDING CONTROL", "Gambling Tracker", "Track actual wagers and received gross payouts. No deposits, expected prizes, or transfers count as results.", button(`${icon("plus", 16)} Add ${gamblingEntryLabel(gamblingTab)} entry`, "new-gambling", "primary"))}${tabPeriod()}<div class="stats-grid gambling-stats">${card("Money spent", fmt(totals.spentCents), "wallet", "rose")}${card("Money returned", fmt(totals.returnedCents), "arrow", "green")}${card("Net profit / loss", netHtml(totals.netCents), "chart", totals.netCents < 0 ? "rose" : "green")}${card("Activities", String(totals.count), "table", "blue")}${card("Biggest win", fmt(totals.biggestWinCents), "arrow", "green")}${card("Total losses", fmt(totals.lossesCents), "wallet", "rose")}</div><div class="gambling-info"><strong>Payout means the gross amount actually returned, including any original stake.</strong> Net = payouts − wagers. A deposit to a gambling account is a transfer, not a wager.</div><div class="two-col gambling-top"><section class="panel"><div class="panel-head"><div><h2>Spending limit</h2><p>Expense control; payouts never raise this allowance</p></div></div><form id="gambling-limit-form" class="form-stack"><div class="form-row"><label>Limit period<select name="period">${option("none", "Off", gamblingConfig().limit.period)}${option("week", "Weekly", gamblingConfig().limit.period)}${option("month", "Monthly", gamblingConfig().limit.period)}</select></label><label>Planned maximum<input name="amount" inputmode="decimal" value="${(gamblingConfig().limit.amountCents / 100).toFixed(2)}" required></label></div><button type="submit" class="btn btn-secondary">Save limit</button></form>${limit ? `<div class="gambling-limit"><div class="gambling-limit-heading"><span>${shortDate(limit.from)} – ${shortDate(limit.to)}</span><strong>${fmt(limit.spentCents)} / ${fmt(limit.amountCents)}</strong></div><div class="bar-track"><div style="width:${Math.min(100, limit.percent)}%;background:${limit.percent >= 100 ? "var(--rose)" : limit.percent >= 80 ? "var(--amber)" : "var(--green)"}"></div></div><p class="${limit.percent >= 100 ? "negative" : limit.percent >= 80 ? "limit-warning" : "muted"}">${limit.percent >= 100 ? "Limit reached or exceeded." : limit.percent >= 80 ? "Approaching your spending limit." : `${fmt(limit.remainingCents)} remaining in your plan.`}</p></div>` : '<p class="muted compact">Set a weekly or monthly maximum to monitor wager spending.</p>'}</section><section class="panel"><div class="panel-head"><div><h2>Results over time</h2><p>Within the selected date range</p></div></div><div class="gambling-trends"><div><h3>Weekly</h3>${gamblingTrendRows(weeks)}</div><div><h3>Monthly</h3>${gamblingTrendRows(months)}</div></div></section></div><div class="gambling-tabs" role="tablist" aria-label="Gambling activity type">${["scratch", "game", "other"].map((kind) => `<button type="button" role="tab" aria-selected="${kind === gamblingTab}" class="${kind === gamblingTab ? "active" : ""}" data-action="gambling-tab" data-value="${kind}">${gamblingLabel(kind)}</button>`).join("")}</div><section class="panel gambling-section"><div class="panel-head"><div><h2>${gamblingLabel(gamblingTab)}</h2><p>${tabTotals.count} ${tabTotals.count === 1 ? "record" : "records"} · ${fmt(tabTotals.spentCents)} spent · ${fmt(tabTotals.returnedCents)} returned · net ${fmt(tabTotals.netCents)}</p></div>${button("Add entry", "new-gambling", "primary")}</div>${gameGroups.length ? `<div class="gambling-aggregates">${gameGroups.slice(0, 6).map((g) => `<div><span>${esc(g.name)} <small>(${g.count})</small></span>${netHtml(g.netCents)}</div>`).join("")}</div>` : ""}<div class="toolbar"><label class="search-field">${icon("search", 17)}<input id="gambling-search" type="search" placeholder="Search ${gamblingLabel(gamblingTab).toLowerCase()}…" value="${esc(gamblingSearch)}" aria-label="Search gambling history"></label>${button(`${icon("download", 16)} Export CSV`, "export-gambling")}</div><div class="table-panel"><div class="table-scroll"><table class="ledger gambling-ledger"><thead><tr>${[["date","Date"],["kind","Type"],["name","Name"],["stake","Money spent"],["payout","Money returned"],["net","Net profit / loss"],["notes","Notes"]].map(([key,label]) => `<th><button type="button" data-action="gambling-sort" data-value="${key}">${label}${gamblingSort === key ? gamblingSortDir === -1 ? " ↓" : " ↑" : ""}</button></th>`).join("")}<th>Actions</th></tr></thead><tbody>${rows.map((e) => `<tr><td>${shortDate(e.date)}${e.time ? `<small>${esc(e.time)}</small>` : ""}</td><td>${gamblingLabel(e.kind)}</td><td><strong>${esc(e.name)}</strong>${e.subcategory ? `<small>${esc(e.subcategory)}</small>` : ""}${e.kind === "scratch" ? `<small>${e.ticketCount} × ${fmt(e.ticketPriceCents)}</small>` : ""}${e.rounds ? `<small>${e.rounds} rounds</small>` : ""}${e.platform ? `<small>${esc(e.platform)}</small>` : ""}</td><td class="negative">${fmt(e.stakeCents)}</td><td class="positive">${fmt(e.payoutCents)}</td><td>${netHtml(gamblingNet(e))}</td><td title="${esc(e.notes)}">${esc(e.notes || "—")}</td><td class="gambling-actions">${button("Edit", "edit-gambling", "secondary", `data-id="${esc(e.id)}"`)}${button("Delete", "delete-gambling", "danger", `data-id="${esc(e.id)}"`)}</td></tr>`).join("")}</tbody></table>${rows.length ? "" : empty("No matching records", "Add an entry or change the selected date range and search.", "new-gambling", "Add entry")}</div></div><p class="table-help">Edit entries here to update linked ledger amounts. Existing ledger transactions you link stay intact if you delete a tracker entry.</p></section>`;
}
function gamblingGroupsByName(entries) {
  const grouped = new Map();
  for (const e of entries) {
    const key = e.name.trim().toLowerCase();
    const group = grouped.get(key) || { name: e.name, rows: [] };
    group.rows.push(e); grouped.set(key, group);
  }
  return [...grouped.values()].map((group) => ({ name: group.name, ...gamblingTotals(group.rows) }))
    .sort((a, b) => b.spentCents - a.spentCents);
}
function gamblingTrendRows(groups) {
  if (!groups.length) return '<p class="muted compact">No records in this date range.</p>';
  const scale = Math.max(1, ...groups.map((g) => Math.abs(g.netCents)));
  return groups.map((g) => `<div class="gambling-trend-row"><span>${shortDate(g.date)}</span><div class="gambling-trend-bar" aria-label="Net result ${fmt(g.netCents)}"><i class="${g.netCents < 0 ? "loss" : "gain"}" style="width:${Math.max(g.netCents ? 5 : 0, Math.round(Math.abs(g.netCents) / scale * 100))}%"></i></div><span>${fmt(g.spentCents)} spent</span>${netHtml(g.netCents)}</div>`).join("");
}

function settingsPage() {
  const cloudAccount = mode === "cloud"
    ? `<section class="panel"><div class="panel-head"><div><h2>Your account</h2><p>${esc(currentUser?.email || "")}</p></div></div><form id="account-form" class="form-stack"><label>Display name<input name="displayName" maxlength="80" value="${esc(currentUser?.user_metadata?.display_name || "")}"></label><label>Email<input name="email" type="email" value="${esc(currentUser?.email || "")}" required></label><button class="btn btn-primary" type="submit">Save account</button></form><div class="button-group">${button("Change password", "change-password")}${button("Sign out", "signout")}</div><div class="divider"></div>${button("Permanently delete account", "delete-account", "danger")}</section><section class="panel"><div class="panel-head"><div><h2>Cloud synchronization</h2><p>Your signed-in budget is stored in Supabase PostgreSQL.</p></div></div><p class="muted">Status: <strong>${esc(syncStatus)}</strong>${syncError ? ` · ${esc(syncError)}` : ""}</p><p class="muted">Last confirmed: ${sync?.lastSynced ? esc(new Date(sync.lastSynced).toLocaleString()) : "Not yet"}</p><p class="muted">Offline edits stay on this device and retry automatically. A cloud conflict needs your choice before saving.</p>${sync?.conflict ? button("Review conflict", "review-conflict", "primary") : button("Retry sync", "retry-sync")}${guestState && hasFinancialData(guestState) ? `<div class="divider"></div>${button("Review local data import", "review-migration")}` : ""}</section>`
    : `<section class="panel"><div class="panel-head"><div><h2>Cloud account</h2><p>${cloudEnabled ? "Sign in to sync between devices." : "Cloud service is not configured yet."}</p></div></div><p class="muted">Local records stay on this browser. A signed-in account uses a separate cache and private cloud document.</p>${cloudEnabled ? button("Sign in or register", "show-auth", "primary") : ""}</section>`;
  return `${titleRow("PREFERENCES", "Make it yours.", mode === "cloud" ? "Your account and budget settings." : "Your preferences and records are stored in this browser.")}<div class="two-col settings-grid">${cloudAccount}${paydaySettingsPanel()}<section class="panel"><div class="panel-head"><div><h2>Budget preferences</h2><p>These affect display and planning</p></div></div><form id="settings-form" class="form-stack"><label>Currency<select name="currency">${["USD", "EUR", "GBP", "CAD", "AUD", "JPY"].map((x) => option(x, x, state.settings.currency)).join("")}</select></label><label>Financial week starts<select name="weekStarts">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((x, i) => option(String(i), x, String(state.settings.weekStarts))).join("")}</select></label><label>Starting cash balance<input name="startingBalance" inputmode="decimal" value="${(state.settings.startingBalanceCents / 100).toFixed(2)}"></label><button type="submit" class="btn btn-primary">Save preferences</button></form></section><section class="panel"><div class="panel-head"><div><h2>Categories</h2><p>Available in the transaction ledger</p></div></div><div class="category-chips">${state.categories.map((c) => `<span class="category-chip">${esc(c)}<button data-action="rename-category" data-value="${esc(c)}" aria-label="Rename ${esc(c)}">${icon("settings", 13)}</button><button data-action="delete-category" data-value="${esc(c)}" aria-label="Delete ${esc(c)}">${icon("x", 13)}</button></span>`).join("")}</div>${button(`${icon("plus", 15)} Add category`, "new-category")}</section><section class="panel"><div class="panel-head"><div><h2>Your data</h2><p>Keep an independent backup outside the app</p></div></div><p class="muted">${mode === "cloud" ? "Cloud sync is not a disaster-recovery backup. Download JSON regularly. This browser also keeps an offline cache that may be readable to someone using this profile." : "Data is saved locally with IndexedDB. It does not sync across devices, and clearing browser storage can erase it."}</p><div class="button-group">${button(`${icon("download", 16)} Download JSON backup`, "backup", "primary")}${button(`${icon("upload", 16)} Restore backup`, "restore")}</div><div class="divider"></div>${button(mode === "cloud" ? "Clear this account's budget" : "Delete all local data", "clear-data", "danger")}</section><section class="panel"><div class="panel-head"><div><h2>Keyboard shortcuts</h2><p>Move faster through your finances</p></div></div><div class="shortcut-list"><div><span>Quick add</span><kbd>Ctrl J</kbd></div><div><span>Search ledger</span><kbd>Ctrl K</kbd></div><div><span>Undo</span><kbd>Ctrl Z</kbd></div><div><span>Navigate cells</span><kbd>Tab</kbd></div></div></section></div>`;
}

function paydaySettingsPanel() {
  const p = paydayConfig();
  return `<section class="panel payday-settings"><div class="panel-head"><div><h2>Weekly payday check-in</h2><p>In-app reminders follow your chosen local time.</p></div>${button("Open check-in", "open-payday")}</div><form id="payday-settings-form" class="form-stack"><div class="form-row"><label>Payday<select name="weekday">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, i) => option(String(i), day, String(p.weekday))).join("")}</select></label><label>Local time<input name="time" type="time" value="${esc(p.time)}" required></label></div><label>Time zone<input name="timeZone" value="${esc(p.timeZone)}" required list="payday-time-zones"><datalist id="payday-time-zones"><option value="America/New_York"><option value="America/Chicago"><option value="America/Denver"><option value="America/Los_Angeles"><option value="UTC"></datalist></label><label class="checkbox-row"><input name="autoPrompt" type="checkbox" ${p.autoPrompt ? "checked" : ""}> Show automatic check-ins</label><button class="btn btn-primary" type="submit">Save payday schedule</button></form><div class="divider"></div><h3 class="subheading">Paycheck allocation rules</h3><p class="muted">Rules create recommendations after bill reserves. Existing custom weekly allocations stay intact.</p>${p.rules.length ? `<div class="payday-rule-list">${p.rules.map((r) => `<div><strong>${esc(r.category)}</strong><span>${r.mode === "fixed" ? fmt(r.value) : `${r.value}%`} · priority ${r.priority}</span><button class="row-action" data-action="remove-payday-rule" data-value="${esc(r.category)}" aria-label="Remove ${esc(r.category)} rule">${icon("x", 15)}</button></div>`).join("")}</div>` : '<p class="muted">No automatic allocation rules yet.</p>'}<form id="payday-rule-form" class="form-stack"><div class="form-row"><label>Category<select name="category">${catOptions("Groceries")}</select></label><label>Allocation<select name="mode">${option("fixed", "Fixed amount", "fixed")}${option("percent", "Percent after bills", "fixed")}</select></label></div><div class="form-row"><label>Amount or percent<input name="value" inputmode="decimal" placeholder="0.00 or 15" required></label><label>Priority<select name="priority">${[1, 2, 3, 4, 5].map((n) => option(String(n), String(n), "3")).join("")}</select></label></div><button class="btn btn-secondary" type="submit">Save allocation rule</button></form></section>`;
}

function renderModal() {
  const close = `<button class="icon-button modal-close" data-action="close-modal" aria-label="Close dialog">${icon("x")}</button>`;
  return `<div class="modal-backdrop" data-action="close-modal"><div class="modal ${modal.kind.startsWith("payday") ? "payday-modal" : modal.kind === "gambling" ? "gambling-modal" : ""}" role="dialog" aria-modal="true" aria-label="${esc(modal.title)}"><div class="modal-header"><div><div class="eyebrow">NORTHSTAR · ${modal.kind.startsWith("payday") ? "PAYDAY" : modal.kind === "gambling" ? "GAMBLING TRACKER" : "WORKSPACE"}</div><h2>${esc(modal.title)}</h2></div>${close}</div>${modalContent()}</div></div>`;
}
function modalContent() {
  const d = modal.data || {};
  switch (modal.kind) {
    case "gambling":
      return gamblingFormHtml(modal.data);
    case "payday": {
      const cycle = modal.data.cycle;
      const existing = state.transactions.find((t) => t.paydayCycle === cycle && t.type === "Income" && t.status === "Received");
      const missed = missedPaydays(new Date(), paydayConfig(), state.transactions, paydayConfig().checkins, 16, addDays(state.createdAt, -7));
      return `<p class="payday-intro">Let's update your budget for the week. Enter the amount you actually received.</p><form id="payday-form" class="form-stack"><label>Payday date<input name="date" type="date" value="${esc(existing?.date || cycle)}" required></label><label>Actual take-home pay<input class="payday-amount" name="amount" inputmode="decimal" placeholder="0.00" value="${existing ? (existing.amountCents / 100).toFixed(2) : ""}" required autofocus></label><label>Optional notes<input name="notes" maxlength="5000" value="${esc(existing?.notes || "")}" placeholder="Hours worked, overtime, or anything useful"></label><div class="payday-live-preview">${existing ? paydayPlanHtml(paydayPreview(cycle, existing.amountCents), existing.amountCents) : '<strong>Instant plan preview</strong><p>Bill reserves and category guidance will update after you enter your pay.</p>'}</div>${missed.length ? `<p class="muted">Missed paydays available to backfill: ${missed.slice(0, 5).map(shortDate).join(", ")}. Choose one in the date field.</p>` : ""}<p class="muted payday-sync-state">${syncStatus === "Synced" ? "Ready to save" : syncStatus === "Offline" ? "Offline · will sync when connected" : esc(syncStatus)}</p><div class="modal-actions">${existing ? button("Cancel", "close-modal") : `${button("Remind me later", "payday-snooze")}${button("Skip this week", "payday-skip")}`}<button type="submit" class="btn btn-primary">${existing ? "Update paycheck" : "Save & Update Budget"}</button></div></form>`;
    }
    case "payday-summary": {
      const { cycle, amountCents } = modal.data;
      const plan = paydayPreview(cycle, amountCents);
      const history = paycheckHistory(state.transactions, cycle).rows;
      const change = history.find((row) => row.paydayCycle === cycle)?.changeCents;
      return `<p class="payday-intro">Your weekly budget is ready. You received <strong>${fmt(amountCents)}</strong> on ${shortDate(cycle)}.${change == null ? "" : ` That's ${change >= 0 ? fmt(change) + " more" : fmt(-change) + " less"} than your previous paycheck.`}</p>${paydayPlanHtml(plan, amountCents)}<p class="muted payday-sync-state">${mode !== "cloud" ? "Saved on this browser only" : syncStatus === "Synced" ? "Saved to cloud" : syncStatus === "Offline" ? "Pending sync · offline" : "Saving to cloud…"}</p><div class="modal-actions">${button("Done", "close-modal")}${button("View My Weekly Budget", "view-payday-week", "primary")}</div>`;
    }
    case "transaction":
      return `<form id="transaction-form" class="form-stack"><div class="form-row"><label>Date<input type="date" name="date" value="${esc(d.date || today())}" required></label><label>Type<select name="type" id="modal-tx-type">${typeOptions(d.type || "Expense")}</select></label></div><label>Description<input name="description" value="${esc(d.description || "")}" placeholder="What was it for?" required autofocus></label><div class="form-row"><label>Amount<input name="amount" inputmode="decimal" value="${d.amountCents != null ? (d.amountCents / 100).toFixed(2) : ""}" placeholder="0.00" required></label><label>Category<select name="category">${catOptions(d.category || "Other")}</select></label></div><div class="form-row"><label>Status<select name="status" id="modal-tx-status">${statusOptions(
        d.type || "Expense",
      )
        .map((x) =>
          option(x, x, d.status || statusOptions(d.type || "Expense")[0]),
        )
        .join(
          "",
        )}</select></label><label>Notes<input name="notes" value="${esc(d.notes || "")}" placeholder="Optional"></label></div><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">${d.id ? "Save changes" : "Add transaction"}</button></div></form>`;
    case "bill":
      return `<form id="bill-form" class="form-stack"><label>Bill name<input name="name" value="${esc(d.name || "")}" required placeholder="e.g. Internet"></label><div class="form-row"><label>Amount<input name="amount" inputmode="decimal" value="${d.amountCents != null ? (d.amountCents / 100).toFixed(2) : ""}" required placeholder="0.00"></label><label>Category<select name="category">${catOptions(d.category || "Utilities")}</select></label></div><div class="form-row"><label>Frequency<select name="frequency">${FREQUENCIES.map((x) => option(x, x, d.frequency || "Monthly")).join("")}</select></label><label>Next due date<input type="date" name="nextDue" value="${esc(d.nextDue || today())}" required></label></div><label>Optional sinking fund: spread over paychecks<input name="sinkingPaychecks" type="number" min="1" max="52" value="${esc(d.sinkingPaychecks || 1)}"><small>1 means reserve the full bill when due. Larger numbers suggest smaller reserves ahead of time.</small></label><label>Notes<input name="notes" value="${esc(d.notes || "")}" placeholder="Optional"></label><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">Save bill</button></div></form>`;
    case "pay":
      return `<form id="pay-form" class="form-stack"><p class="muted">Record the actual payment. This creates one expense transaction and moves the bill to its next due date.</p><div class="form-row"><label>Payment date<input type="date" name="date" value="${today()}" required></label><label>Actual amount<input name="amount" inputmode="decimal" value="${(d.amountCents / 100).toFixed(2)}" required></label></div><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">Record payment</button></div></form>`;
    case "goal":
      return `<form id="goal-form" class="form-stack"><label>Goal name<input name="name" value="${esc(d.name || "")}" required placeholder="What are you saving for?"></label><div class="form-row"><label>Target amount<input name="target" inputmode="decimal" value="${d.targetCents != null ? (d.targetCents / 100).toFixed(2) : ""}" required placeholder="0.00"></label><label>Target date (optional)<input type="date" name="targetDate" value="${esc(d.targetDate || "")}"></label></div><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">Save goal</button></div></form>`;
    case "movement":
      return `<form id="movement-form" class="form-stack"><p class="muted">${modal.withdraw ? "Withdraw from" : "Contribute to"} ${esc(d.name)}. This will also create a cash movement in your ledger.</p><div class="form-row"><label>Date<input type="date" name="date" value="${today()}" required></label><label>Amount<input name="amount" inputmode="decimal" placeholder="0.00" required></label></div><label>Notes<input name="notes" placeholder="Optional"></label><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">Record ${modal.withdraw ? "withdrawal" : "contribution"}</button></div></form>`;
    case "allocation":
      return `<form id="allocation-form" class="form-stack"><label>Week beginning<input type="date" name="week" value="${selectedWeek}" required></label><div class="form-row"><label>Category<select name="category">${catOptions("Groceries")}</select></label><label>Planned amount<input name="amount" inputmode="decimal" placeholder="0.00" required></label></div><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">Save allocation</button></div></form>`;
    case "expected-pay":
      return `<form id="expected-pay-form" class="form-stack"><p class="muted">Set a pay forecast for the week of ${niceDate(selectedWeek)}. This is a plan, not received income.</p><label>Expected amount<input name="amount" inputmode="decimal" value="${((state.payPlans?.[selectedWeek] ?? estimatedPay(selectedWeek)) / 100).toFixed(2)}" required></label><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">Save expected pay</button></div></form>`;
    case "category":
      return `<form id="category-form" class="form-stack"><label>Category name<input name="name" value="${esc(d.name || "")}" required maxlength="40"></label><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">Save category</button></div></form>`;
    case "confirm":
      return `<p class="muted">${esc(modal.message)}</p><div class="modal-actions">${button("Cancel", "close-modal")}${button(esc(modal.confirmLabel || "Delete"), "confirm", "danger")}</div>`;
    case "migration":
      return `<p class="muted">We found ${modal.data.transactions.length} transactions, ${modal.data.bills.length} bills, and ${modal.data.goals.length} goals saved locally in this browser. Import adds records with new IDs to your account, keeps existing cloud records, and preserves the original local copy. Download a JSON backup first if you want an independent copy.</p><div class="import-preview">${modal.data.transactions.slice(0, 5).map((t) => `<div><span>${esc(t.date)}</span><strong>${esc(t.description)}</strong><span>${esc(t.type)}</span><strong>${fmt(t.amountCents)}</strong></div>`).join("")}</div><div class="modal-actions">${button("Later", "close-modal")}${button("Download local backup", "backup-guest")}${button("Import to account", "import-guest", "primary")}</div>`;
    case "sync-conflict":
      return `<p class="muted">This browser and another device changed the same ${modal.conflicts.length === 1 ? "item" : "items"}. Other independent edits can be merged. Choose which version to keep for the overlapping edits.</p><p class="muted">${esc(modal.conflicts.slice(0, 8).join(", "))}${modal.conflicts.length > 8 ? ` and ${modal.conflicts.length - 8} more` : ""}</p><div class="modal-actions">${button("Keep cloud edits", "resolve-remote")}${button("Keep this device's edits", "resolve-local", "primary")}</div>`;
    case "password":
      return `<form id="password-form" class="form-stack"><label>Current password<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>New password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">Update password</button></div></form>`;
    case "import":
      return `<p class="muted">${modal.rows.length} valid transaction${modal.rows.length === 1 ? "" : "s"} ready to import. Existing records will remain.</p><div class="import-preview">${modal.rows
        .slice(0, 8)
        .map(
          (t) =>
            `<div><span>${shortDate(t.date)}</span><strong>${esc(t.description)}</strong><span>${esc(t.type)}</span><strong>${fmt(t.amountCents)}</strong></div>`,
        )
        .join(
          "",
        )}${modal.rows.length > 8 ? `<p>…and ${modal.rows.length - 8} more</p>` : ""}</div><div class="modal-actions">${button("Cancel", "close-modal")}${button(`Import ${modal.rows.length} rows`, "confirm-import", "primary")}</div>`;
    default:
      return "";
  }
}

function gamblingLinkOptions(type, currentId, entryId) {
  const managedId = `gambling:${entryId}:${type === "Expense" ? "stake" : "payout"}`;
  const selected = currentId === managedId ? "create" : currentId || "create";
  const rows = state.transactions.filter((tx) => tx.type === type && actual(tx) &&
    !(type === "Income" && tx.paydayCycle) &&
    (!linkedEntryForTransaction(gamblingConfig().entries.filter((e) => e.id !== entryId), tx.id)) &&
    (!tx.gamblingEntryId || tx.gamblingEntryId === entryId));
  return `${option("create", "Create a new ledger transaction", selected)}${rows.filter((tx) => tx.id !== managedId).map((tx) => option(tx.id, `${tx.date} · ${tx.description} · ${fmt(tx.amountCents)}`, selected)).join("")}`;
}
function gamblingFormHtml(entry = {}) {
  const kind = entry.kind || gamblingTab;
  const scratch = kind === "scratch", game = kind === "game";
  return `<p class="muted">Record actual money spent and gross payouts received. Linking an existing confirmed ledger row prevents double-counting.</p><form id="gambling-form" class="form-stack"><div class="form-row"><label>Date<input name="date" type="date" value="${esc(entry.date || today())}" required></label>${game ? `<label>Time<input name="time" type="time" value="${esc(entry.time || "")}" required></label>` : `<label>${scratch ? "Ticket or game name" : "Activity type"}<input name="name" maxlength="500" value="${esc(entry.name || "")}" required autofocus></label>`}</div>${game ? `<label>Game name<input name="name" maxlength="500" value="${esc(entry.name || "")}" required autofocus></label>` : ""}<div class="form-row">${scratch ? `<label>Ticket price<input name="ticketPrice" inputmode="decimal" value="${entry.ticketPriceCents != null ? (entry.ticketPriceCents / 100).toFixed(2) : ""}" required></label><label>Number of tickets<input name="ticketCount" type="number" min="1" max="10000" step="1" value="${entry.ticketCount || 1}" required></label>` : `<label>Amount wagered / entry fee<input name="stake" inputmode="decimal" value="${entry.stakeCents != null ? (entry.stakeCents / 100).toFixed(2) : ""}" required></label><label>${game ? "Number of rounds (optional)" : "Platform or location (optional)"}<input name="${game ? "rounds" : "platform"}" ${game ? 'type="number" min="1" max="1000000" step="1"' : 'maxlength="500"'} value="${esc(game ? entry.rounds || "" : entry.platform || "")}"></label>`}</div>${scratch ? `<div class="gambling-calculated">Total purchase cost <strong id="scratch-total">${fmt(entry.stakeCents || 0)}</strong></div>` : ""}<div class="form-row"><label>Gross payout actually received<input name="payout" inputmode="decimal" value="${entry.payoutCents != null ? (entry.payoutCents / 100).toFixed(2) : "0.00"}" required></label><label>Subcategory (optional)<input name="subcategory" maxlength="80" value="${esc(entry.subcategory || "")}" placeholder="Lottery, poker, sportsbook…"></label></div>${game ? `<label>Platform or location (optional)<input name="platform" maxlength="500" value="${esc(entry.platform || "")}"></label>` : ""}<label>Payout received date<input name="payoutDate" type="date" value="${esc(entry.payoutDate || entry.date || today())}" required></label><label>Notes<textarea name="notes" maxlength="5000" rows="2" placeholder="Optional">${esc(entry.notes || "")}</textarea></label><div class="gambling-calculated">Net profit / loss <span id="gambling-net-preview">${netHtml(gamblingNet({ stakeCents: entry.stakeCents || 0, payoutCents: entry.payoutCents || 0 }))}</span></div><div class="gambling-link-panel"><h3>Connect to the main budget</h3><p>For amounts already in your spreadsheet, choose the matching transaction. The amount must match exactly.</p><label>Stake or ticket purchase<select name="stakeChoice">${gamblingLinkOptions("Expense", entry.stakeTransactionId, entry.id)}</select></label><label>Received payout<select name="payoutChoice">${gamblingLinkOptions("Income", entry.payoutTransactionId, entry.id)}</select></label></div><div class="modal-actions">${button("Cancel", "close-modal")}<button type="submit" class="btn btn-primary">${entry.id ? "Save changes" : "Record activity"}</button></div></form>`;
}

function openModal(kind, title, data = {}) {
  modal = { kind, title, data };
  render();
  setTimeout(
    () =>
      document.querySelector(".modal input[autofocus], .modal input")?.focus(),
    0,
  );
}
function openPayday(cycle = currentPaydayCycle(), automatic = false) {
  modal = { kind: "payday", title: "Happy Payday! 💸", data: { cycle }, automatic };
  render();
  setTimeout(() => document.querySelector(".payday-amount")?.focus(), 0);
}
function closeModal() {
  if (modal?.kind === "payday" && modal.automatic) {
    remember();
    paydayState().checkins[modal.data.cycle] = { status: "dismissed" };
    void persist();
  }
  modal = null;
  render();
}
function confirmAction(title, message, yes, confirmLabel = "Delete") {
  modal = { kind: "confirm", title, message, yes, confirmLabel };
  render();
}
function addTransaction(data) {
  remember();
  state.transactions.push({ id: uid(), ...data });
  changed("Transaction saved.");
}
function editTransaction(id, data) {
  const i = state.transactions.findIndex((t) => t.id === id);
  if (i < 0) return;
  if (linkedEntryForTransaction(gamblingConfig().entries, id))
    throw Error("Edit this linked transaction from Gambling Tracker to keep its totals accurate.");
  remember();
  state.transactions[i] = { ...state.transactions[i], ...data };
  syncGoalMovement(state.transactions[i]);
  changed("Transaction updated.");
}
function syncGoalMovement(t) {
  if (!t.goalId || !t.movementId) return;
  const movement = state.goals
    .find((g) => g.id === t.goalId)
    ?.movements.find((m) => m.id === t.movementId);
  if (movement) {
    movement.date = t.date;
    movement.amountCents =
      t.direction === "in" ? -t.amountCents : t.amountCents;
    movement.notes = t.notes;
  }
}
function removeGoalMovement(t) {
  if (!t.goalId || !t.movementId) return;
  const goal = state.goals.find((g) => g.id === t.goalId);
  if (goal)
    goal.movements = goal.movements.filter((m) => m.id !== t.movementId);
}
function validAmount(v, allowZero = false) {
  const n = cents(v);
  if (n === null || !Number.isSafeInteger(n) || n < 0 || (!allowZero && n === 0))
    throw Error("Enter an amount greater than zero with at most two decimals.");
  return n;
}
function formData(form) {
  return Object.fromEntries(new FormData(form));
}
async function applyCloudState(next) {
  state = validateBackup(structuredClone(next));
  state.payPlans ??= {};
  if (modal?.kind === "payday" && modal.automatic &&
      state.transactions.some((t) => t.paydayCycle === modal.data.cycle && t.type === "Income" && t.status === "Received"))
    modal = null;
  writeThrough(state, currentUser.id);
  await saveState(state, currentUser.id);
  render();
}
async function activateUser(user) {
  if (!user || (mode === "cloud" && currentUser?.id === user.id)) return;
  if (activationPromise) return activationPromise;
  activationPromise = activateUserOnce(user).finally(() => { activationPromise = null; });
  return activationPromise;
}
async function activateUserOnce(user) {
  sync?.stop();
  currentUser = user;
  mode = "cloud";
  recovery = false;
  state = await loadState(user.id);
  state.payPlans ??= {};
  setSyncStatus("Saving");
  render();
  sync = new BudgetSync(user.id, {
    getState: () => state,
    applyState: applyCloudState,
    setStatus: setSyncStatus,
    onConflict: (conflicts) => {
      modal = { kind: "sync-conflict", title: "Review sync conflict", conflicts };
      render();
    },
  });
  await sync.start();
  if (recovery) return;
  if (guestState && hasFinancialData(guestState) &&
      !localStorage.getItem(`northstar-imported-v1:${user.id}`) && !sync.conflict) {
    modal = { kind: "migration", title: "Import existing local data", data: guestState };
    render();
  }
}
async function signOut() {
  sync?.stop();
  sync = null;
  const { error } = await cloud.auth.signOut({ scope: "local" });
  if (error) throw error;
  currentUser = null;
  state = freshState();
  mode = "auth";
  authView = "signin";
  modal = null;
  render();
}
async function importGuest() {
  if (!sync || !guestState) return;
  setSyncStatus("Saving");
  const counts = await sync.importLegacy(guestState);
  localStorage.setItem(`northstar-imported-v1:${currentUser.id}`, "verified");
  modal = null;
  render();
  notify(`Imported ${counts.transactions} transactions, ${counts.bills} bills, ${counts.goals} goals. ${counts.skipped} existing IDs skipped.`);
}
async function deleteAccount() {
  if (!currentUser) return;
  const userId = currentUser.id;
  const { data, error } = await cloud.functions.invoke("delete-account", { body: {} });
  if (error || !data?.deleted) throw error || Error("Account deletion was not confirmed.");
  sync?.stop();
  sync = null;
  await clearUserCache(userId);
  localStorage.removeItem(`northstar-imported-v1:${userId}`);
  await cloud.auth.signOut();
  currentUser = null;
  state = freshState();
  mode = "auth";
  modal = null;
  render();
  notify("Account deleted. The separate local guest copy, if any, remains in this browser.");
}
async function handleAccountSubmit(form) {
  const d = formData(form);
  try {
    let result;
    switch (form.id) {
      case "signin-form":
        result = await cloud.auth.signInWithPassword({ email: d.email.trim(), password: d.password });
        if (result.error) throw result.error;
        await activateUser(result.data.user);
        return;
      case "register-form":
        result = await cloud.auth.signUp({
          email: d.email.trim(), password: d.password,
          options: { emailRedirectTo: `${location.origin}${location.pathname}` },
        });
        if (result.error) throw result.error;
        if (result.data.session) await activateUser(result.data.user);
        else notify("Check your email to confirm your account, then sign in.");
        return;
      case "reset-form":
        result = await cloud.auth.resetPasswordForEmail(d.email.trim(), {
          redirectTo: `${location.origin}${location.pathname}`,
        });
        if (result.error) throw result.error;
        notify("If that email has an account, a reset link has been sent.");
        return;
      case "recovery-form":
        result = await cloud.auth.updateUser({ password: d.password });
        if (result.error) throw result.error;
        recovery = false;
        await activateUser(result.data.user);
        notify("Password updated.");
        return;
      case "password-form":
        result = await cloud.auth.signInWithPassword({
          email: currentUser.email, password: d.currentPassword,
        });
        if (result.error) throw result.error;
        result = await cloud.auth.updateUser({ password: d.password });
        if (result.error) throw result.error;
        modal = null;
        render();
        notify("Password updated.");
        return;
      case "account-form": {
        const name = d.displayName.trim();
        const profile = await cloud.from("profiles").update({ display_name: name }).eq("id", currentUser.id);
        if (profile.error) throw profile.error;
        const changes = { data: { display_name: name } };
        if (d.email.trim() !== currentUser.email) changes.email = d.email.trim();
        result = await cloud.auth.updateUser(changes);
        if (result.error) throw result.error;
        currentUser = result.data.user;
        render();
        notify(changes.email ? "Check your email to confirm the address change." : "Account updated.");
        return;
      }
    }
  } catch (error) {
    notify(error.message || "Account action failed.", true);
  }
}
function handleSubmit(e) {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  e.preventDefault();
  if (["signin-form", "register-form", "reset-form", "recovery-form", "password-form", "account-form"].includes(form.id)) {
    void handleAccountSubmit(form);
    return;
  }
  const d = formData(form);
  try {
    switch (form.id) {
      case "gambling-limit-form": {
        const amountCents = validAmount(d.amount, true);
        if (!["none", "week", "month"].includes(d.period)) throw Error("Choose a valid limit period.");
        if (d.period !== "none" && amountCents === 0) throw Error("Enter a spending limit greater than zero.");
        remember();
        (state.gambling ||= defaultGambling()).limit = { period: d.period, amountCents };
        changed("Gambling spending limit saved.");
        break;
      }
      case "gambling-form": {
        const kind = modal?.data?.kind || gamblingTab;
        const name = d.name.trim();
        if (!name) throw Error("Enter an activity name.");
        const [year, month, day] = d.date.split("-").map(Number), parsed = dateObj(d.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || parsed.getFullYear() !== year || parsed.getMonth() + 1 !== month || parsed.getDate() !== day)
          throw Error("Enter a valid activity date.");
        const [payYear, payMonth, payDay] = d.payoutDate.split("-").map(Number), payParsed = dateObj(d.payoutDate);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.payoutDate) || payParsed.getFullYear() !== payYear || payParsed.getMonth() + 1 !== payMonth || payParsed.getDate() !== payDay)
          throw Error("Enter a valid payout received date.");
        const ticketPriceCents = kind === "scratch" ? validAmount(d.ticketPrice, true) : null;
        const ticketCount = kind === "scratch" ? Number(d.ticketCount) : null;
        if (kind === "scratch" && (!Number.isInteger(ticketCount) || ticketCount < 1 || ticketCount > 10000))
          throw Error("Enter between 1 and 10,000 tickets.");
        const stakeCents = kind === "scratch" ? ticketPriceCents * ticketCount : validAmount(d.stake, true);
        const payoutCents = validAmount(d.payout, true);
        if (!Number.isSafeInteger(stakeCents) || (!stakeCents && !payoutCents))
          throw Error("Enter money spent or a payout received.");
        const rounds = d.rounds ? Number(d.rounds) : null;
        if (rounds != null && (!Number.isInteger(rounds) || rounds < 1 || rounds > 1000000))
          throw Error("Rounds must be a whole number from 1 to 1,000,000.");
        if (kind === "game" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))
          throw Error("Enter a valid game time.");
        const entry = { id: modal.data.id, kind, date: d.date, payoutDate: d.payoutDate, time: kind === "game" ? d.time : "",
          name, subcategory: d.subcategory.trim(), platform: (d.platform || "").trim(),
          ticketPriceCents, ticketCount, rounds, stakeCents, payoutCents, notes: d.notes.trim(),
          stakeChoice: d.stakeChoice, payoutChoice: d.payoutChoice };
        remember();
        saveGamblingEntry(state, entry);
        modal = null;
        changed("Gambling activity saved and budget updated.");
        break;
      }
      case "payday-form": {
        const p = paydayConfig();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || cycleForDate(d.date, p.weekday) !== d.date)
          throw Error("Choose a date that matches your configured payday.");
        const cycle = d.date;
        const amountCents = validAmount(d.amount);
        remember();
        paydayState();
        const { updated } = recordPaycheck(state, cycle, amountCents, d.notes.trim());
        if (modal.automatic && modal.data.cycle !== cycle)
          paydayState().checkins[modal.data.cycle] = { status: "dismissed" };
        selectedWeek = weekStart(cycle, state.settings.weekStarts);
        modal = { kind: "payday-summary", title: "Your weekly budget is ready!", data: { cycle, amountCents } };
        if (mode === "cloud") setSyncStatus(navigator.onLine ? "Saving" : "Offline");
        changed(updated ? "Paycheck updated." : mode === "cloud" ? "Paycheck recorded. Sync is pending until confirmed." : "Paycheck recorded on this browser.");
        break;
      }
      case "transaction-form": {
        const amountCents = validAmount(d.amount),
          data = {
            date: d.date,
            description: d.description.trim(),
            category: d.category,
            type: d.type,
            amountCents,
            status: d.status,
            notes: d.notes.trim(),
          };
        if (!data.description) throw Error("Description is required.");
        if (modal.data.id) editTransaction(modal.data.id, data);
        else addTransaction(data);
        modal = null;
        break;
      }
      case "bill-form": {
        const amountCents = validAmount(d.amount),
          sinkingPaychecks = Number(d.sinkingPaychecks),
          data = {
            name: d.name.trim(),
            amountCents,
            category: d.category,
            frequency: d.frequency,
            nextDue: d.nextDue,
            notes: d.notes.trim(),
            sinkingPaychecks,
          };
        if (!Number.isInteger(sinkingPaychecks) || sinkingPaychecks < 1 || sinkingPaychecks > 52)
          throw Error("Sinking fund paychecks must be between 1 and 52.");
        if (!data.name) throw Error("Bill name is required.");
        remember();
        const i = state.bills.findIndex((b) => b.id === modal.data.id);
        if (i >= 0) state.bills[i] = { ...state.bills[i], ...data };
        else state.bills.push({ id: uid(), ...data });
        modal = null;
        changed("Bill saved.");
        break;
      }
      case "pay-form": {
        const bill = state.bills.find((b) => b.id === modal.data.id);
        if (!bill) throw Error("Bill no longer exists.");
        const amountCents = validAmount(d.amount);
        remember();
        state.transactions.push({
          id: uid(),
          date: d.date,
          description: bill.name,
          category: bill.category,
          type: "Expense",
          amountCents,
          status: "Paid",
          notes: `Recurring bill · ${bill.frequency}`,
          billId: bill.id,
        });
        bill.lastPaidDate = bill.nextDue;
        bill.nextDue = nextDue(bill.nextDue, bill.frequency);
        while (bill.nextDue <= d.date)
          bill.nextDue = nextDue(bill.nextDue, bill.frequency);
        modal = null;
        changed("Payment recorded once in your ledger.");
        break;
      }
      case "goal-form": {
        const targetCents = validAmount(d.target),
          data = { name: d.name.trim(), targetCents, targetDate: d.targetDate };
        if (!data.name) throw Error("Goal name is required.");
        remember();
        const i = state.goals.findIndex((g) => g.id === modal.data.id);
        if (i >= 0) state.goals[i] = { ...state.goals[i], ...data };
        else state.goals.push({ id: uid(), ...data, movements: [] });
        modal = null;
        changed("Goal saved.");
        break;
      }
      case "movement-form": {
        const goal = state.goals.find((g) => g.id === modal.data.id);
        if (!goal) throw Error("Goal no longer exists.");
        const amountCents = validAmount(d.amount),
          signed = modal.withdraw ? -amountCents : amountCents;
        if (modal.withdraw && goalSaved(goal) < amountCents)
          throw Error("Withdrawal exceeds saved amount.");
        remember();
        const movement = {
          id: uid(),
          date: d.date,
          amountCents: signed,
          notes: d.notes.trim(),
        };
        goal.movements.push(movement);
        state.transactions.push({
          id: uid(),
          date: d.date,
          description: `${modal.withdraw ? "Withdrawal from" : "Contribution to"} ${goal.name}`,
          category: "Savings Transfers",
          type: "Savings",
          amountCents,
          status: "Cleared",
          notes: d.notes.trim(),
          goalId: goal.id,
          movementId: movement.id,
          direction: modal.withdraw ? "in" : "out",
        });
        modal = null;
        changed("Savings movement recorded.");
        break;
      }
      case "allocation-form": {
        const amountCents = validAmount(d.amount, true),
          week = weekStart(d.week, state.settings.weekStarts);
        remember();
        state.allocations[week] ??= {};
        state.allocations[week][d.category] = amountCents;
        selectedWeek = week;
        modal = null;
        page = "weekly";
        changed("Allocation saved.");
        break;
      }
      case "expected-pay-form": {
        const amountCents = validAmount(d.amount, true);
        remember();
        state.payPlans ??= {};
        state.payPlans[selectedWeek] = amountCents;
        modal = null;
        changed("Expected pay saved as a plan.");
        break;
      }
      case "category-form": {
        const name = d.name.trim();
        if (!name) throw Error("Category name is required.");
        if (
          state.categories.some(
            (c) =>
              c.toLowerCase() === name.toLowerCase() && c !== modal.data.name,
          )
        )
          throw Error("That category already exists.");
        remember();
        if (modal.data.name) {
          const old = modal.data.name;
          state.categories = state.categories.map((c) =>
            c === old ? name : c,
          );
          state.transactions.forEach((t) => {
            if (t.category === old) t.category = name;
          });
          state.bills.forEach((b) => {
            if (b.category === old) b.category = name;
          });
          paydayConfig().rules.forEach((rule) => {
            if (rule.category === old) rule.category = name;
          });
          Object.values(state.allocations).forEach((a) => {
            if (old in a) {
              a[name] = a[old];
              delete a[old];
            }
          });
        } else state.categories.push(name);
        modal = null;
        changed("Category saved.");
        break;
      }
      case "settings-form": {
        const balance = cents(d.startingBalance);
        if (balance === null)
          throw Error("Starting balance must be a valid amount.");
        remember();
        state.settings = {
          currency: d.currency,
          weekStarts: Number(d.weekStarts),
          startingBalanceCents: balance,
        };
        selectedWeek = weekStart(today(), state.settings.weekStarts);
        changed("Preferences saved.");
        break;
      }
      case "payday-settings-form": {
        const weekday = Number(d.weekday);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time) || !validTimeZone(d.timeZone.trim()))
          throw Error("Enter a valid payday, local time, and IANA time zone.");
        remember();
        Object.assign(paydayState(), { weekday, time: d.time, timeZone: d.timeZone.trim(), autoPrompt: d.autoPrompt === "on" });
        changed("Payday schedule saved.");
        break;
      }
      case "payday-rule-form": {
        const p = paydayState();
        const priority = Number(d.priority);
        const value = d.mode === "fixed" ? validAmount(d.value, true) : Number(d.value);
        if (d.mode === "percent" && (!/^\d+(\.\d{1,2})?$/.test(d.value) || value < 0 || value > 100))
          throw Error("Percentage must be between 0 and 100 with at most two decimals.");
        if (!state.categories.includes(d.category) || !["fixed", "percent"].includes(d.mode) ||
          !Number.isInteger(priority) || priority < 1 || priority > 5)
          throw Error("Choose a valid category, allocation type, and priority.");
        remember();
        p.rules = p.rules.filter((rule) => rule.category !== d.category);
        p.rules.push({ category: d.category, mode: d.mode, value: d.mode === "percent" ? Math.round(value * 100) / 100 : value, priority });
        changed("Payday allocation rule saved.");
        break;
      }
    }
    render();
  } catch (err) {
    notify(err.message, true);
  }
}

function handleCellChange(el) {
  const row = el.closest("tr[data-id]"),
    t = state.transactions.find((x) => x.id === row?.dataset.id),
    key = el.dataset.cell;
  if (!t || !key) return;
  if (linkedEntryForTransaction(gamblingConfig().entries, t.id)) {
    notify("Edit this linked transaction from Gambling Tracker.", true);
    el.value = txValue(t, key);
    return;
  }
  let value = el.value;
  if (key === "amountCents") {
    const n = cents(value);
    if (n === null || n < 0) {
      notify(
        "Amount must be a positive number with at most two decimals.",
        true,
      );
      el.value = txValue(t, key);
      return;
    }
    value = n;
  }
  if (key === "description" && !value.trim()) {
    notify("Description cannot be empty.", true);
    el.value = t.description;
    return;
  }
  if (key === "date" && !value) {
    notify("Date is required.", true);
    el.value = t.date;
    return;
  }
  if (key === "type" && value !== t.type) {
    remember();
    if (t.goalId) {
      removeGoalMovement(t);
      delete t.goalId;
      delete t.movementId;
      delete t.direction;
    }
    t.type = value;
    t.status = statusOptions(value)[0];
    changed("Type updated.");
    return;
  }
  if (t[key] === value) return;
  remember();
  t[key] = value;
  syncGoalMovement(t);
  persist();
  refreshLedgerFooter();
  notify("Saved.");
}
function refreshLedgerFooter() {
  const rows = filteredTransactions();
  const income = sum(rows.filter((t) => t.type === "Income" && actual(t)));
  const expenses = sum(rows.filter((t) => t.type === "Expense" && actual(t)));
  const total = document.querySelector(".ledger tfoot td.num");
  const detail = document.querySelector(".ledger tfoot td:last-child");
  if (total) total.textContent = fmt(income - expenses);
  if (detail)
    detail.innerHTML = `<span class="positive">+${fmt(income)}</span> <span class="muted">/</span> <span class="negative">−${fmt(expenses)}</span>`;
}
function pasteGrid(e) {
  const target = e.target;
  if (!target.matches(".cell-input,.cell-select")) return;
  const raw = e.clipboardData?.getData("text/plain");
  if (!raw || !raw.includes("\t")) return;
  e.preventDefault();
  const row = target.closest("tr[data-id]"),
    startIndex = filteredTransactions().findIndex(
      (t) => t.id === row?.dataset.id,
    ),
    colIndex = columns.findIndex(([k]) => k === target.dataset.cell),
    grid = raw
      .replace(/\r/g, "")
      .trimEnd()
      .split("\n")
      .map((line) => line.split("\t")),
    list = filteredTransactions();
  if (startIndex < 0 || colIndex < 0) return;
  const updates = [];
  for (let i = 0; i < grid.length; i++) {
    const t = list[startIndex + i];
    if (!t) break;
    if (linkedEntryForTransaction(gamblingConfig().entries, t.id))
      return notify("Paste rejected: edit linked gambling transactions in Gambling Tracker.", true);
    const patch = {};
    for (let j = 0; j < grid[i].length; j++) {
      const key = columns[colIndex + j]?.[0];
      if (!key) break;
      const v = grid[i][j].trim();
      if (key === "amountCents") {
        const n = cents(v);
        if (n === null || n < 0)
          return notify(
            `Paste rejected: invalid amount in row ${i + 1}.`,
            true,
          );
        patch[key] = n;
      } else if (key === "type") {
        if (!["Income", "Expense", "Transfer", "Savings"].includes(v))
          return notify(`Paste rejected: invalid type in row ${i + 1}.`, true);
        patch[key] = v;
      } else if (key === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
          return notify(`Paste rejected: invalid date in row ${i + 1}.`, true);
        patch[key] = v;
      } else if (key === "description" && !v)
        return notify("Paste rejected: blank description.", true);
      else patch[key] = v;
    }
    updates.push([t, patch]);
  }
  remember();
  for (const [t, patch] of updates) {
    Object.assign(t, patch);
    if (patch.type && !patch.status) t.status = statusOptions(t.type)[0];
  }
  changed(`${updates.length} row${updates.length === 1 ? "" : "s"} updated.`);
}

function handleClick(e) {
  const pageButton = e.target.closest("[data-page]");
  if (pageButton) {
    page = pageButton.dataset.page;
    mobileNav = false;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  if (el.classList.contains("modal-backdrop") && e.target !== el) return;
  const a = el.dataset.action,
    id = el.dataset.id,
    v = el.dataset.value;
  switch (a) {
    case "gambling-tab":
      gamblingTab = v;
      gamblingSearch = "";
      render();
      break;
    case "new-gambling":
      openModal("gambling", `Record ${gamblingEntryLabel(gamblingTab)}`, { kind: gamblingTab });
      break;
    case "edit-gambling": {
      const entry = gamblingConfig().entries.find((row) => row.id === id);
      if (entry) openModal("gambling", `Edit ${gamblingEntryLabel(entry.kind)}`, entry);
      break;
    }
    case "delete-gambling":
      confirmAction("Delete gambling activity", "The tracker entry and any ledger transactions created by it will be removed. Pre-existing linked transactions will remain.", () => {
        remember();
        deleteGamblingEntry(state, id);
        changed("Gambling activity deleted.");
      });
      break;
    case "export-gambling":
      download(`northstar-gambling-${gamblingTab}-${today()}.csv`, gamblingCsv(visibleGamblingEntries()), "text/csv");
      break;
    case "gambling-sort":
      if (gamblingSort === v) gamblingSortDir *= -1;
      else { gamblingSort = v; gamblingSortDir = v === "date" ? -1 : 1; }
      render();
      break;
    case "show-signin":
    case "show-register":
    case "show-reset":
      authView = a.slice(5);
      render();
      break;
    case "show-auth":
      mode = "auth";
      authView = "signin";
      render();
      break;
    case "guest-mode":
      mode = "guest";
      state = structuredClone(guestState || freshState());
      render();
      break;
    case "signout":
      void signOut().catch((error) => notify(error.message, true));
      break;
    case "change-password":
      modal = { kind: "password", title: "Change password" };
      render();
      break;
    case "delete-account":
      confirmAction(
        "Permanently delete account",
        "This deletes your cloud account and its budget. Download a backup first. The separate local guest copy, if any, remains on this browser.",
        () => void deleteAccount().catch((error) => notify(error.message, true)),
        "Delete account",
      );
      break;
    case "retry-sync":
      void sync?.queue();
      break;
    case "review-conflict":
      if (sync?.conflict) {
        modal = { kind: "sync-conflict", title: "Review sync conflict", conflicts: ["overlapping edits"] };
        render();
      }
      break;
    case "resolve-local":
    case "resolve-remote":
      modal = null;
      render();
      void sync?.resolve(a === "resolve-local" ? "local" : "remote").catch((error) => notify(error.message, true));
      break;
    case "review-migration":
      if (guestState && hasFinancialData(guestState)) {
        modal = { kind: "migration", title: "Import existing local data", data: guestState };
        render();
      }
      break;
    case "backup-guest":
      if (guestState) download(`northstar-local-backup-${today()}.json`, JSON.stringify(guestState, null, 2), "application/json");
      break;
    case "import-guest":
      void importGuest().catch((error) => notify(error.message, true));
      break;
    case "toggle-nav":
      mobileNav = !mobileNav;
      render();
      break;
    case "close-modal":
      closeModal();
      break;
    case "open-payday":
      openPayday(v || currentPaydayCycle());
      break;
    case "payday-snooze":
      if (modal?.kind === "payday") {
        remember();
        paydayState().checkins[modal.data.cycle] = { status: "snoozed", deferUntil: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() };
        modal = null;
        changed("We'll remind you in about four hours.");
      }
      break;
    case "payday-skip":
      if (modal?.kind === "payday") {
        remember();
        paydayState().checkins[modal.data.cycle] = { status: "skipped" };
        modal = null;
        changed("This payday was skipped. You can reopen it manually.");
      }
      break;
    case "view-payday-week":
      page = "weekly";
      modal = null;
      render();
      break;
    case "remove-payday-rule":
      remember();
      paydayState().rules = paydayState().rules.filter((rule) => rule.category !== v);
      changed("Payday rule removed.");
      break;
    case "quick-add":
    case "new-transaction":
      openModal("transaction", "Add transaction");
      break;
    case "add-on-date":
      openModal("transaction", "Add transaction", { date: selectedDate });
      break;
    case "new-row":
      addTransaction({
        date: today(),
        description: "New entry",
        category: "Other",
        type: "Expense",
        amountCents: 0,
        status: "Upcoming",
        notes: "",
      });
      break;
    case "duplicate-row": {
      const t = state.transactions.find((x) => x.id === id);
      if (t) {
        if (linkedEntryForTransaction(gamblingConfig().entries, id)) {
          notify("Add a new Gambling Tracker entry for another activity.", true);
          break;
        }
        remember();
        const copy = {
          ...structuredClone(t),
          id: uid(),
          description: `${t.description} copy`,
        };
        delete copy.goalId;
        delete copy.movementId;
        delete copy.billId;
        delete copy.gamblingEntryId;
        state.transactions.push(copy);
        changed("Row duplicated.");
      }
      break;
    }
    case "delete-row":
      if (linkedEntryForTransaction(gamblingConfig().entries, id)) {
        notify("Delete this linked entry from Gambling Tracker first.", true);
        break;
      }
      confirmAction(
        "Delete transaction",
        "This entry will be removed from your ledger.",
        () => {
          remember();
          const t = state.transactions.find((t) => t.id === id);
          if (t) removeGoalMovement(t);
          state.transactions = state.transactions.filter((t) => t.id !== id);
          changed("Transaction deleted.");
        },
      );
      break;
    case "sort":
      if (sortBy === v) sortDir *= -1;
      else {
        sortBy = v;
        sortDir = v === "date" ? -1 : 1;
      }
      render();
      break;
    case "undo":
      undo();
      break;
    case "period":
      period = v;
      render();
      break;
    case "prev-period":
      anchor =
        period === "week"
          ? addDays(anchor, -7)
          : period === "year"
            ? addMonths(anchor, -12)
            : addMonths(anchor, -1);
      render();
      break;
    case "next-period":
      anchor =
        period === "week"
          ? addDays(anchor, 7)
          : period === "year"
            ? addMonths(anchor, 12)
            : addMonths(anchor, 1);
      render();
      break;
    case "prev-week":
      selectedWeek = addDays(selectedWeek, -7);
      render();
      break;
    case "next-week":
      selectedWeek = addDays(selectedWeek, 7);
      render();
      break;
    case "prev-month":
      selectedMonth = addMonths(selectedMonth, -1);
      selectedDate = selectedMonth;
      render();
      break;
    case "next-month":
      selectedMonth = addMonths(selectedMonth, 1);
      selectedDate = selectedMonth;
      render();
      break;
    case "select-date":
      selectedDate = v;
      render();
      break;
    case "new-bill":
      openModal("bill", "Add recurring bill");
      break;
    case "edit-bill":
      openModal(
        "bill",
        "Edit recurring bill",
        state.bills.find((b) => b.id === id),
      );
      break;
    case "delete-bill":
      confirmAction(
        "Delete bill",
        "The recurring schedule will be removed. Past recorded payments remain in your ledger.",
        () => {
          remember();
          state.bills = state.bills.filter((b) => b.id !== id);
          changed("Bill deleted.");
        },
      );
      break;
    case "pay-bill":
      openModal(
        "pay",
        "Record bill payment",
        state.bills.find((b) => b.id === id),
      );
      break;
    case "new-goal":
      openModal("goal", "Create savings goal");
      break;
    case "edit-goal":
      openModal(
        "goal",
        "Edit savings goal",
        state.goals.find((g) => g.id === id),
      );
      break;
    case "delete-goal":
      confirmAction(
        "Delete goal",
        "The goal will be removed. Its cash movements remain in your ledger.",
        () => {
          remember();
          state.goals = state.goals.filter((g) => g.id !== id);
          changed("Goal deleted.");
        },
      );
      break;
    case "goal-contribute":
    case "goal-withdraw":
      modal = {
        kind: "movement",
        title: a === "goal-withdraw" ? "Withdraw savings" : "Add contribution",
        data: state.goals.find((g) => g.id === id),
        withdraw: a === "goal-withdraw",
      };
      render();
      break;
    case "new-allocation":
      openModal("allocation", "Plan a category");
      break;
    case "set-expected-pay":
      openModal("expected-pay", "Expected weekly pay");
      break;
    case "copy-plan": {
      const previous = allocationsFor(addDays(selectedWeek, -7));
      if (!Object.keys(previous).length)
        return notify("No plan from last week.", true);
      const copy = () => {
        remember();
        state.allocations[selectedWeek] = { ...previous };
        changed("Last week's allocations copied.");
      };
      if (Object.keys(allocationsFor(selectedWeek)).length)
        confirmAction(
          "Replace this week's plan?",
          "Copying last week's allocations will replace the current category plan for this week.",
          copy,
          "Replace plan",
        );
      else copy();
      break;
    }
    case "edit-transaction":
      if (linkedEntryForTransaction(gamblingConfig().entries, id)) {
        notify("Edit this linked transaction from Gambling Tracker.", true);
        break;
      }
      openModal(
        "transaction",
        "Edit transaction",
        state.transactions.find((t) => t.id === id),
      );
      break;
    case "delete-allocation":
      confirmAction(
        "Remove allocation",
        `Remove the ${v} plan for this week?`,
        () => {
          remember();
          delete state.allocations[selectedWeek][v];
          changed("Allocation removed.");
        },
      );
      break;
    case "new-category":
      openModal("category", "Add category");
      break;
    case "rename-category":
      openModal("category", "Rename category", { name: v });
      break;
    case "delete-category": {
      const used =
        state.transactions.some((t) => t.category === v) ||
        state.bills.some((b) => b.category === v) ||
        Object.values(state.allocations).some((a) => v in a) ||
        paydayConfig().rules.some((rule) => rule.category === v);
      if (used)
        return notify("This category is in use. Rename it instead.", true);
      confirmAction(
        "Delete category",
        `Remove ${v} from your categories?`,
        () => {
          remember();
          state.categories = state.categories.filter((c) => c !== v);
          changed("Category deleted.");
        },
      );
      break;
    }
    case "export-csv":
      download(
        `northstar-transactions-${today()}.csv`,
        toCsv(state.transactions),
        "text/csv",
      );
      break;
    case "import-csv":
      document.querySelector("#file-import").click();
      break;
    case "backup":
      download(
        `northstar-backup-${today()}.json`,
        JSON.stringify(state, null, 2),
        "application/json",
      );
      break;
    case "restore":
      document.querySelector("#file-restore").click();
      break;
    case "clear-data":
      confirmAction(
        mode === "cloud" ? "Clear account budget" : "Delete all local data",
        mode === "cloud" ? "This clears this account's transactions, bills, goals, plans, and preferences, then syncs the empty budget to the cloud. Download a backup first." : "This permanently clears transactions, bills, goals, allocations, and preferences in this browser. Download a backup first if you may need them.",
        () => {
          remember();
          state = freshState();
          changed("Local data cleared.");
        },
        "Delete everything",
      );
      break;
    case "confirm": {
      const fn = modal?.yes;
      modal = null;
      fn?.();
      break;
    }
    case "confirm-import":
      remember();
      state.transactions.push(...modal.rows);
      modal = null;
      changed("CSV transactions imported.");
      break;
    case "global-search":
      page = "transactions";
      render();
      setTimeout(
        () => document.querySelector("#transaction-search")?.focus(),
        0,
      );
      break;
  }
}

document.addEventListener("click", handleClick);
document.addEventListener("submit", handleSubmit);
document.addEventListener("paste", pasteGrid);
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.matches("[data-cell]")) handleCellChange(el);
  if (el.id === "filter-type") {
    filterType = el.value;
    render();
  }
  if (el.id === "filter-category") {
    filterCategory = el.value;
    render();
  }
  if (el.id === "filter-status") {
    filterStatus = el.value;
    render();
  }
  if (el.dataset.custom) {
    custom[el.dataset.custom] = el.value;
    render();
  }
  if (el.id === "modal-tx-type") {
    const status = document.querySelector("#modal-tx-status");
    if (status)
      status.innerHTML = statusOptions(el.value)
        .map((x, i) => option(x, x, i === 0 ? x : ""))
        .join("");
  }
});
document.addEventListener("focusout", (e) => {
  if (e.target.matches(".cell-input")) handleCellChange(e.target);
});
document.addEventListener("input", (e) => {
  if (e.target.closest("#gambling-form")) {
    const form = e.target.closest("form"), scratch = modal?.data?.kind === "scratch";
    const price = cents(form.elements.ticketPrice?.value || "0") || 0;
    const count = Number(form.elements.ticketCount?.value || 0);
    const stake = scratch ? price * count : cents(form.elements.stake?.value || "0");
    const payout = cents(form.elements.payout?.value || "0");
    const total = form.querySelector("#scratch-total");
    if (total) total.textContent = Number.isSafeInteger(stake) ? fmt(stake) : "—";
    const preview = form.querySelector("#gambling-net-preview");
    if (preview) preview.innerHTML = stake !== null && payout !== null && Number.isSafeInteger(stake)
      ? netHtml(payout - stake) : "Enter valid amounts";
  }
  if (e.target.id === "gambling-search") {
    gamblingSearch = e.target.value;
    const caret = e.target.selectionStart;
    render();
    const input = document.querySelector("#gambling-search");
    input?.focus(); input?.setSelectionRange(caret, caret);
  }
  if (e.target.closest("#payday-form") && ["amount", "date"].includes(e.target.name)) {
    const form = e.target.closest("form");
    const amountCents = cents(form.elements.amount.value);
    const preview = form.querySelector(".payday-live-preview");
    if (preview) preview.innerHTML = amountCents !== null && amountCents > 0 &&
      cycleForDate(form.elements.date.value, paydayConfig().weekday) === form.elements.date.value
      ? paydayPlanHtml(paydayPreview(form.elements.date.value, amountCents), amountCents)
      : '<strong>Instant plan preview</strong><p>Enter a valid payday date and paycheck amount.</p>';
  }
  if (e.target.id === "transaction-search") {
    search = e.target.value;
    const caret = e.target.selectionStart;
    render();
    const input = document.querySelector("#transaction-search");
    input?.focus();
    input?.setSelectionRange(caret, caret);
  }
});
document.addEventListener("keydown", (e) => {
  const editable = e.target.matches("input,select,textarea,[contenteditable]");
  if (e.key === "Escape" && modal) {
    closeModal();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    page = "transactions";
    render();
    document.querySelector("#transaction-search")?.focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
    e.preventDefault();
    openModal("transaction", "Add transaction");
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !editable) {
    e.preventDefault();
    undo();
  }
  if (
    e.target.matches("[data-cell]") &&
    ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Enter"].includes(e.key)
  ) {
    if (
      e.key.startsWith("Arrow") &&
      e.target.matches("input") &&
      e.target.type === "text" &&
      !e.ctrlKey
    )
      return;
    e.preventDefault();
    const cells = [...document.querySelectorAll(".ledger tbody [data-cell]")],
      i = cells.indexOf(e.target),
      col = columns.length,
      next =
        e.key === "ArrowRight"
          ? i + 1
          : e.key === "ArrowLeft"
            ? i - 1
            : e.key === "ArrowUp"
              ? i - col
              : e.key === "ArrowDown"
                ? i + col
                : i + 1;
    cells[next]?.focus();
    cells[next]?.select?.();
  }
});
document.querySelector("#file-import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const rows = parseCsv(await file.text());
    if (!rows.length) throw Error("CSV has no transaction rows.");
    modal = { kind: "import", title: "Preview CSV import", rows };
    render();
  } catch (err) {
    notify(err.message, true);
  }
});
document
  .querySelector("#file-restore")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const restored = validateBackup(JSON.parse(await file.text()));
      confirmAction(
        "Restore backup",
        mode === "cloud"
          ? "This replaces this account's budget on this device and syncs it to the cloud. Download a backup first if you need the current records."
          : "This replaces all current local data in this browser. Download a backup first if you need the current records.",
        () => {
          remember();
          state = restored;
          state.payPlans ??= {};
          changed("Backup restored.");
        },
        "Replace data",
      );
    } catch (err) {
      notify(err.message, true);
    }
  });
try {
  guestState = await loadState();
  guestState.payPlans ??= {};
  state = structuredClone(guestState);
} catch {
  guestState = freshState();
  state = structuredClone(guestState);
  notify("Local storage is unavailable. Changes may not persist in this browser.", true);
}
selectedWeek = weekStart(today(), state.settings.weekStarts);
if (cloudEnabled) {
  cloud.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") {
        sync?.stop();
        sync = null;
        recovery = true;
        currentUser = session?.user || null;
        mode = "auth";
        render();
      } else if (event === "SIGNED_IN" && session?.user && !recovery) {
        void activateUser(session.user).catch((error) => notify(error.message, true));
      } else if (event === "SIGNED_OUT" && mode === "cloud") {
        sync?.stop();
        sync = null;
        currentUser = null;
        state = freshState();
        mode = "auth";
        render();
      }
    }, 0);
  });
  const { data, error } = await cloud.auth.getSession();
  if (error) notify(error.message, true);
  if (data.session?.user && !recovery) await activateUser(data.session.user);
  else render();
} else {
  mode = "guest";
  render();
}
setInterval(checkPaydayPrompt, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkPaydayPrompt(); });
