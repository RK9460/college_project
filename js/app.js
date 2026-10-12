/* ==============================================================================
   GROUP EXPENSE SPLITTER — COLLEGE TRIP EDITION
   Pure Vanilla JavaScript with IndexedDB transactional storage & Greedy Settler.
   Consolidated single-file architecture under 1000 lines with zero external dependencies.

   TABLE OF CONTENTS:
   1. State Management (Paise precision)
   2. Storage Engine (IndexedDB + LocalStorage fallback)
   3. Helpers & Currency Formatting
   4. Split & Greedy Settlement Engine (<= N-1 payments)
   5. UI Rendering System (Cards, Lists, Tables, Inline SVG Chart)
   6. Event Handlers & User Actions (Forms, WhatsApp, CSV/TXT export)
   7. Automated Quality Self-Test Suite (23 Unit Tests)
   8. Application Initialization
   ============================================================================== */

// ------------------------------------------------------------------------------
// 1. STATE MANAGEMENT (Single Source of Truth)
// ------------------------------------------------------------------------------
const state = {
  members: [],          // [{ id, name, upiId }]
  expenses: [],         // [{ id, payerId, amount, description, category, date, splitType, beneficiaryId, splitParticipantIds }]
  paidSettlements: {},  // { settlementKey: boolean }
  tripBudget: 1500000,  // Integer paise (Default ₹15,000 = 1,500,000 paise)
  chartMode: 'category',// 'category' | 'member'
  filters: { search: '', category: '', payerId: '' }
};

// ------------------------------------------------------------------------------
// 2. STORAGE ENGINE: INDEXEDDB TRANSACTIONAL ENGINE + LOCALSTORAGE FALLBACK
// ------------------------------------------------------------------------------
const DB_NAME = "TripSplitterDB", DB_VERSION = 1;
let idbInstance = null;

function initIndexedDB() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("members")) db.createObjectStore("members", { keyPath: "id" }).createIndex("name", "name", { unique: false });
      if (!db.objectStoreNames.contains("expenses")) {
        const s = db.createObjectStore("expenses", { keyPath: "id" });
        s.createIndex("payerId", "payerId", { unique: false });
        s.createIndex("category", "category", { unique: false });
      }
      if (!db.objectStoreNames.contains("config")) db.createObjectStore("config", { keyPath: "key" });
    };
    req.onsuccess = (e) => { idbInstance = e.target.result; resolve(idbInstance); };
    req.onerror = () => resolve(null);
  });
}

function idbGetAll(name) {
  return new Promise((res) => {
    if (!idbInstance) return res([]);
    try {
      const r = idbInstance.transaction([name], "readonly").objectStore(name).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([]);
    } catch (e) { res([]); }
  });
}

function idbPut(name, item) {
  return new Promise((res) => {
    if (!idbInstance) return res(false);
    try {
      const r = idbInstance.transaction([name], "readwrite").objectStore(name).put(item);
      r.onsuccess = () => res(true);
      r.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}

function idbClearStore(name) {
  return new Promise((res) => {
    if (!idbInstance) return res(false);
    try {
      const r = idbInstance.transaction([name], "readwrite").objectStore(name).clear();
      r.onsuccess = () => res(true);
      r.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}

async function saveStateToStorage() {
  try {
    localStorage.setItem("group_expense_splitter_backup", JSON.stringify({
      members: state.members, expenses: state.expenses, paidSettlements: state.paidSettlements, tripBudget: state.tripBudget
    }));
  } catch (e) {}
  if (idbInstance) {
    try {
      await idbClearStore("members");
      for (const m of state.members) await idbPut("members", m);
      await idbClearStore("expenses");
      for (const exp of state.expenses) await idbPut("expenses", exp);
      await idbPut("config", { key: "tripBudget", value: state.tripBudget });
      await idbPut("config", { key: "paidSettlements", value: state.paidSettlements });
    } catch (err) { console.warn("IDB save error:", err); }
  }
}

async function loadStateFromStorage() {
  if (idbInstance) {
    try {
      const [members, expenses, configs] = await Promise.all([idbGetAll("members"), idbGetAll("expenses"), idbGetAll("config")]);
      if (members.length || expenses.length || configs.length) {
        state.members = members; state.expenses = expenses;
        configs.forEach(c => {
          if (c.key === "tripBudget" && typeof c.value === "number") state.tripBudget = c.value;
          if (c.key === "paidSettlements" && typeof c.value === "object") state.paidSettlements = c.value;
        });
        return;
      }
    } catch (err) { console.warn("IDB load fallback:", err); }
  }
  try {
    const raw = localStorage.getItem("group_expense_splitter_backup") || localStorage.getItem("group_expense_splitter_v2");
    if (!raw) return;
    const p = JSON.parse(raw);
    if (Array.isArray(p.members)) state.members = p.members;
    if (Array.isArray(p.expenses)) state.expenses = p.expenses;
    if (p.paidSettlements && typeof p.paidSettlements === 'object') state.paidSettlements = p.paidSettlements;
    if (typeof p.tripBudget === 'number' && p.tripBudget > 0) state.tripBudget = p.tripBudget;
  } catch (e) {}
}

// ------------------------------------------------------------------------------
// 3. MONEY, FORMATTING & UTILITY HELPERS
// ------------------------------------------------------------------------------
function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 7);
}

function rupeesToPaise(rupeeVal) {
  const num = parseFloat(rupeeVal);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function formatRupees(paise, includeSign = false) {
  const isNegative = paise < 0;
  const formatted = (Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (isNegative) return "-₹" + formatted;
  if (includeSign && paise > 0) return "+₹" + formatted;
  return "₹" + formatted;
}

function getTodayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCategoryEmoji(category) {
  const emojis = { Food: "🍔", Travel: "🚕", Hotel: "🏨", Shopping: "🛍️" };
  return emojis[category] || "📦";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function escapeHTML(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ------------------------------------------------------------------------------
// 4. MATHEMATICAL ENGINE: 3 SPLIT MODES & GREEDY SETTLEMENTS (<= N-1)
// ------------------------------------------------------------------------------
function calculateTotalExpense(expensesList) {
  return Array.isArray(expensesList) ? expensesList.reduce((sum, item) => sum + (item.amount || 0), 0) : 0;
}

function distributeEqually(totalPaise, targetIds, accumulatorMap) {
  if (targetIds.length === 0) return;
  const count = targetIds.length, baseShare = Math.floor(totalPaise / count), remainder = totalPaise % count;
  targetIds.forEach((id, idx) => { accumulatorMap[id] += idx < remainder ? baseShare + 1 : baseShare; });
}

function calculateMemberShares(membersList, expensesList) {
  if (!membersList || membersList.length === 0) return [];
  const memberIds = membersList.map(m => m.id), paidMap = {}, shareMap = {};
  membersList.forEach(m => { paidMap[m.id] = 0; shareMap[m.id] = 0; });

  expensesList.forEach(exp => {
    if (paidMap[exp.payerId] !== undefined) paidMap[exp.payerId] += exp.amount;
    if (exp.splitType === 'single') {
      const benId = exp.beneficiaryId;
      if (shareMap[benId] !== undefined) shareMap[benId] += exp.amount;
      else distributeEqually(exp.amount, memberIds, shareMap);
    } else if (exp.splitType === 'custom' && Array.isArray(exp.splitParticipantIds) && exp.splitParticipantIds.length > 0) {
      const valid = exp.splitParticipantIds.filter(id => shareMap[id] !== undefined);
      distributeEqually(exp.amount, valid.length > 0 ? valid : memberIds, shareMap);
    } else {
      distributeEqually(exp.amount, memberIds, shareMap);
    }
  });

  return membersList.map(m => ({
    memberId: m.id, name: m.name, upiId: m.upiId || "",
    paid: paidMap[m.id] || 0, share: shareMap[m.id] || 0,
    balance: (paidMap[m.id] || 0) - (shareMap[m.id] || 0)
  }));
}

function calculateSettlements(memberBalances) {
  if (!memberBalances || memberBalances.length <= 1) return [];
  const creditors = memberBalances.filter(m => m.balance > 0).map(m => ({ id: m.memberId, name: m.name, upiId: m.upiId, amount: m.balance })).sort((a, b) => b.amount - a.amount);
  const debtors = memberBalances.filter(m => m.balance < 0).map(m => ({ id: m.memberId, name: m.name, upiId: m.upiId, amount: Math.abs(m.balance) })).sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let cIdx = 0, dIdx = 0;
  while (cIdx < creditors.length && dIdx < debtors.length) {
    const creditor = creditors[cIdx], debtor = debtors[dIdx];
    const transfer = Math.min(debtor.amount, creditor.amount);
    if (transfer > 0) {
      settlements.push({
        fromId: debtor.id, fromName: debtor.name, toId: creditor.id, toName: creditor.name,
        toUpi: creditor.upiId || "", amount: transfer, key: `${debtor.id}->${creditor.id}:${transfer}`
      });
      debtor.amount -= transfer;
      creditor.amount -= transfer;
    }
    if (debtor.amount === 0) dIdx++;
    if (creditor.amount === 0) cIdx++;
  }
  return settlements;
}

// ------------------------------------------------------------------------------
// 5. UI RENDERING SYSTEM
// ------------------------------------------------------------------------------
function renderApp() {
  const total = calculateTotalExpense(state.expenses);
  const shares = calculateMemberShares(state.members, state.expenses);
  const settlements = calculateSettlements(shares);
  renderBudgetTracker(total);
  renderSummaryCards(total, shares, settlements);
  renderMembersList();
  renderExpenseFormOptions();
  renderFilterOptions();
  renderExpenseList();
  renderBalancesTable(shares);
  renderSettlementsList(settlements);
  renderChart(total, shares);
}

function renderBudgetTracker(totalExpense) {
  const budgetInput = document.getElementById("input-trip-budget");
  const progressBar = document.getElementById("budget-progress-bar");
  const spentText = document.getElementById("budget-spent-text");
  const remainingText = document.getElementById("budget-remaining-text");

  budgetInput.value = (state.tripBudget / 100).toString();
  const pct = state.tripBudget > 0 ? (totalExpense / state.tripBudget) * 100 : 0;
  progressBar.style.width = `${Math.min(100, Math.round(pct))}%`;

  if (pct >= 100) {
    progressBar.style.backgroundColor = "var(--danger)";
    remainingText.style.color = "var(--danger)";
    remainingText.textContent = `⚠️ Over Budget by ${formatRupees(totalExpense - state.tripBudget)}!`;
  } else if (pct >= 80) {
    progressBar.style.backgroundColor = "var(--accent)";
    remainingText.style.color = "var(--accent)";
    remainingText.textContent = `Remaining: ${formatRupees(state.tripBudget - totalExpense)} (${Math.round(100 - pct)}% left)`;
  } else {
    progressBar.style.backgroundColor = "var(--primary)";
    remainingText.style.color = "var(--primary)";
    remainingText.textContent = `Remaining: ${formatRupees(state.tripBudget - totalExpense)}`;
  }
  spentText.textContent = `Spent: ${formatRupees(totalExpense)} / ${formatRupees(state.tripBudget)} (${Math.round(pct)}%)`;
}

function renderSummaryCards(totalExpense, memberBalances, settlements) {
  document.getElementById("metric-total-expense").textContent = formatRupees(totalExpense);
  document.getElementById("metric-member-count").textContent = state.members.length.toString();
  document.getElementById("badge-member-count").textContent = state.members.length.toString();
  document.getElementById("badge-expense-count").textContent = state.expenses.length.toString();
  document.getElementById("metric-equal-share").textContent = state.members.length === 0 ? "₹0.00" : formatRupees(Math.round(totalExpense / state.members.length));
  const pendingCount = settlements.filter(s => !state.paidSettlements[s.key]).length;
  document.getElementById("metric-pending-settlements").textContent = pendingCount.toString();
}

function renderMembersList() {
  const listEl = document.getElementById("member-list");
  listEl.innerHTML = "";
  if (state.members.length === 0) {
    listEl.innerHTML = '<li class="empty-state"><div class="empty-state-icon">🎒</div><div class="empty-state-title">No friends added yet</div><div class="empty-state-text">Add your first friend above to get started with splitting!</div></li>';
    return;
  }
  state.members.forEach(member => {
    const li = document.createElement("li");
    li.className = "member-item";
    li.id = `member-item-${member.id}`;
    li.innerHTML = `<div class="member-name-text"><div class="member-avatar">${escapeHTML(member.name.charAt(0).toUpperCase())}</div><span>${escapeHTML(member.name)}</span>${member.upiId ? `<span class="member-upi-badge">UPI: ${escapeHTML(member.upiId)}</span>` : ''}</div><div class="member-actions"><button type="button" class="btn btn-sm btn-secondary" onclick="enableInlineMemberEdit('${member.id}')">Edit</button><button type="button" class="btn btn-sm btn-danger" onclick="handleRequestDeleteMember('${member.id}')">Delete</button></div>`;
    listEl.appendChild(li);
  });
}

function enableInlineMemberEdit(memberId) {
  const member = state.members.find(m => m.id === memberId);
  const itemLi = document.getElementById(`member-item-${memberId}`);
  if (!member || !itemLi) return;
  itemLi.innerHTML = `<form class="inline-edit-form" onsubmit="event.preventDefault(); saveInlineMemberEdit('${memberId}', this.elements['name'].value, this.elements['upi'].value)"><div class="inline-edit-row"><input type="text" name="name" class="input-field" value="${escapeHTML(member.name)}" maxlength="30" style="min-height:36px;padding:0.3rem 0.6rem;font-size:0.9rem;" required /><input type="text" name="upi" class="input-field" placeholder="UPI ID (optional)" value="${escapeHTML(member.upiId || '')}" maxlength="40" style="min-height:36px;padding:0.3rem 0.6rem;font-size:0.9rem;" /></div><div class="inline-edit-row"><button type="submit" class="btn btn-sm btn-primary">Save</button><button type="button" class="btn btn-sm btn-secondary" onclick="renderMembersList()">Cancel</button></div></form>`;
  itemLi.querySelector('input[name="name"]').focus();
}

async function saveInlineMemberEdit(memberId, newNameRaw, newUpiRaw) {
  const trimmed = newNameRaw.trim();
  if (!trimmed) return showToast("Member name cannot be empty.");
  if (state.members.some(m => m.id !== memberId && m.name.toLowerCase() === trimmed.toLowerCase())) return showToast(`A friend named "${trimmed}" already exists.`);
  const member = state.members.find(m => m.id === memberId);
  if (member) {
    member.name = trimmed;
    member.upiId = newUpiRaw ? newUpiRaw.trim() : "";
    await saveStateToStorage();
    renderApp();
    showToast(`Updated ${trimmed}!`);
  }
}

function renderExpenseFormOptions() {
  const selectPayer = document.getElementById("select-expense-payer"), selectBen = document.getElementById("select-single-beneficiary");
  const customContainer = document.getElementById("custom-members-checkboxes"), form = document.getElementById("form-expense"), hint = document.getElementById("expense-form-hint");
  const currPayer = selectPayer.value, currBen = selectBen.value;
  selectPayer.innerHTML = '<option value="">Select friend...</option>';
  selectBen.innerHTML = '<option value="">Select friend who incurred this spend...</option>';
  customContainer.innerHTML = "";

  state.members.forEach(m => {
    selectPayer.add(new Option(m.name, m.id, false, m.id === currPayer));
    selectBen.add(new Option(m.name, m.id, false, m.id === currBen));
    const label = document.createElement("label");
    label.className = "custom-check-item";
    label.innerHTML = `<input type="checkbox" value="${m.id}" checked /> ${escapeHTML(m.name)}`;
    customContainer.appendChild(label);
  });
  const hasMembers = state.members.length > 0;
  form.querySelectorAll("input:not([type=hidden]), select, button[type=submit]").forEach(el => el.disabled = !hasMembers);
  hint.style.display = hasMembers ? "none" : "flex";
}

function renderFilterOptions() {
  const selectPayer = document.getElementById("filter-payer"), curr = state.filters.payerId;
  selectPayer.innerHTML = '<option value="">All Payers</option>';
  state.members.forEach(m => selectPayer.add(new Option(m.name, m.id, false, m.id === curr)));
}

function renderExpenseList() {
  const listEl = document.getElementById("expense-list"), statusText = document.getElementById("filter-status-text"), resetBtn = document.getElementById("btn-reset-filters");
  listEl.innerHTML = "";
  if (state.expenses.length === 0) {
    statusText.textContent = "No expenses recorded";
    resetBtn.style.display = "none";
    listEl.innerHTML = '<li class="empty-state"><div class="empty-state-icon">🧾</div><div class="empty-state-title">No expenses recorded yet</div><div class="empty-state-text">Use the form above to add hotel bookings, meals, gas, or tickets.</div></li>';
    return;
  }

  const sLower = state.filters.search.toLowerCase().trim();
  const filtered = state.expenses.filter(exp => {
    const payer = state.members.find(m => m.id === exp.payerId), pName = payer ? payer.name.toLowerCase() : "";
    const descMatch = (exp.description || "").toLowerCase().includes(sLower) || exp.category.toLowerCase().includes(sLower) || pName.includes(sLower);
    return descMatch && (!state.filters.category || exp.category === state.filters.category) && (!state.filters.payerId || exp.payerId === state.filters.payerId);
  });

  const isFiltered = Boolean(state.filters.search || state.filters.category || state.filters.payerId);
  resetBtn.style.display = isFiltered ? "inline-block" : "none";
  statusText.textContent = isFiltered ? `Showing ${filtered.length} of ${state.expenses.length} expenses` : `Showing all ${state.expenses.length} expenses`;

  if (filtered.length === 0) {
    listEl.innerHTML = '<li class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-title">No matching expenses found</div><div class="empty-state-text">Try adjusting your search query or reset the filters.</div></li>';
    return;
  }

  [...filtered].reverse().forEach(exp => {
    const payer = state.members.find(m => m.id === exp.payerId);
    let splitTag = '<span class="expense-split-tag">👥 Split equally</span>';
    if (exp.splitType === 'single') {
      const ben = state.members.find(m => m.id === exp.beneficiaryId);
      splitTag = `<span class="expense-split-tag tag-single">🎯 Paid for ${escapeHTML(ben ? ben.name : 'someone')}</span>`;
    } else if (exp.splitType === 'custom' && Array.isArray(exp.splitParticipantIds)) {
      splitTag = `<span class="expense-split-tag">☑️ Split (${exp.splitParticipantIds.length} friends)</span>`;
    }

    const li = document.createElement("li");
    li.className = "expense-item";
    li.innerHTML = `<div class="expense-meta"><div class="category-badge">${getCategoryEmoji(exp.category)}</div><div class="expense-info"><span class="expense-desc">${escapeHTML(exp.description ? exp.description : exp.category)}</span><span class="expense-sub">Paid by <strong class="expense-payer-name">${escapeHTML(payer ? payer.name : 'Unknown')}</strong> • ${exp.date || "Today"} • ${splitTag}</span></div></div><div class="expense-amount-wrap"><span class="expense-amount">${formatRupees(exp.amount)}</span><div class="member-actions"><button type="button" class="btn btn-sm btn-secondary" onclick="loadExpenseIntoForm('${exp.id}')">Edit</button><button type="button" class="btn btn-sm btn-danger" onclick="deleteExpense('${exp.id}')">Delete</button></div></div>`;
    listEl.appendChild(li);
  });
}

function renderBalancesTable(memberBalances) {
  const tbody = document.getElementById("balance-table-body");
  tbody.innerHTML = "";
  if (memberBalances.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No members added yet.</td></tr>';
    return;
  }
  memberBalances.forEach(item => {
    let bClass = "badge-settled", bText = "all settled (₹0.00)";
    if (item.balance > 0) { bClass = "badge-gets"; bText = `gets ${formatRupees(item.balance)}`; }
    else if (item.balance < 0) { bClass = "badge-owes"; bText = `owes ${formatRupees(Math.abs(item.balance))}`; }
    const tr = document.createElement("tr");
    tr.innerHTML = `<td style="font-weight:700;">${escapeHTML(item.name)}</td><td>${formatRupees(item.paid)}</td><td>${formatRupees(item.share)}</td><td><span class="badge-status ${bClass}">${bText}</span></td>`;
    tbody.appendChild(tr);
  });
}

function renderSettlementsList(settlements) {
  const listEl = document.getElementById("settlement-list");
  listEl.innerHTML = "";
  if (state.members.length === 0) {
    listEl.innerHTML = '<li class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">No members yet</div><div class="empty-state-text">Add your friends to calculate settlements.</div></li>';
    return;
  }
  if (state.expenses.length === 0) {
    listEl.innerHTML = '<li class="empty-state"><div class="empty-state-icon">💸</div><div class="empty-state-title">No expenses yet</div><div class="empty-state-text">Log expenses to see settlements.</div></li>';
    return;
  }
  if (settlements.length === 0) {
    listEl.innerHTML = '<li class="empty-state" style="background:var(--success-subtle);border-color:var(--success-border);"><div class="empty-state-icon">🎉</div><div class="empty-state-title" style="color:var(--success);">Everyone is settled up 🎉</div><div class="empty-state-text" style="color:#14532d;">No pending payments needed!</div></li>';
    return;
  }
  settlements.forEach(s => {
    const isPaid = Boolean(state.paidSettlements[s.key]);
    const li = document.createElement("li");
    li.className = "settlement-item" + (isPaid ? " is-paid" : "");
    li.innerHTML = `<div class="settlement-main"><span class="settlement-arrow-icon">${isPaid ? "✅" : "➡️"}</span><div class="settlement-text"><strong>${escapeHTML(s.fromName)}</strong> pays <strong>${escapeHTML(s.toName)}</strong> <span class="amount-highlight">${formatRupees(s.amount)}</span></div></div><div class="settlement-actions"><button type="button" class="btn btn-sm ${isPaid ? 'btn-secondary' : 'btn-primary'}" onclick="toggleSettlementPaid('${s.key}')">${isPaid ? "Undo / Unpaid" : "Mark as Paid"}</button></div>`;
    listEl.appendChild(li);
  });
}

async function toggleSettlementPaid(settlementKey) {
  if (state.paidSettlements[settlementKey]) delete state.paidSettlements[settlementKey];
  else state.paidSettlements[settlementKey] = true;
  await saveStateToStorage();
  renderApp();
}

function renderChart(totalExpense, memberBalances) {
  const container = document.getElementById("chart-container");
  container.innerHTML = "";
  if (totalExpense === 0 || state.expenses.length === 0) {
    container.innerHTML = '<div class="empty-state" style="border:none;background:transparent;"><div class="empty-state-icon">📊</div><div class="empty-state-title">No data yet</div><div class="empty-state-text">Add trip expenses to see interactive spending breakdowns.</div></div>';
    return;
  }

  let chartItems = [];
  const colors = ["#0f766e", "#ea580c", "#3b82f6", "#8b5cf6", "#ec4899", "#10b981", "#f59e0b"];
  if (state.chartMode === "category") {
    const catMap = { Food: 0, Travel: 0, Hotel: 0, Shopping: 0, Other: 0 };
    state.expenses.forEach(exp => { catMap[exp.category] !== undefined ? catMap[exp.category] += exp.amount : catMap.Other += exp.amount; });
    const palette = { Food: "#f97316", Travel: "#0284c7", Hotel: "#0f766e", Shopping: "#db2777", Other: "#64748b" };
    chartItems = Object.keys(catMap).filter(c => catMap[c] > 0).map(c => ({
      label: `${getCategoryEmoji(c)} ${c}`, amount: catMap[c], color: palette[c] || "#64748b"
    })).sort((a, b) => b.amount - a.amount);
  } else {
    chartItems = memberBalances.filter(m => m.paid > 0).map((m, idx) => ({
      label: m.name, amount: m.paid, color: colors[idx % colors.length]
    })).sort((a, b) => b.amount - a.amount);
    if (chartItems.length === 0) {
      container.innerHTML = '<div class="empty-state" style="border:none;background:transparent;"><div class="empty-state-icon">👥</div><div class="empty-state-title">No member contributions yet</div><div class="empty-state-text">Record expenses to see who paid what.</div></div>';
      return;
    }
  }

  const rowHeight = 44, svgHeight = chartItems.length * rowHeight + 20, maxBarWidth = 220, barStartX = 140;
  let svgHTML = `<svg class="chart-svg" viewBox="0 0 500 ${svgHeight}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Spending Chart">`;
  chartItems.forEach((item, idx) => {
    const y = idx * rowHeight + 10, pct = ((item.amount / totalExpense) * 100).toFixed(1);
    const barW = Math.max(6, Math.round((item.amount / totalExpense) * maxBarWidth));
    svgHTML += `<text x="10" y="${y + 22}" fill="#0f172a" font-size="13" font-weight="600" font-family="system-ui, sans-serif">${escapeHTML(item.label)}</text><rect x="${barStartX}" y="${y + 8}" width="${maxBarWidth}" height="18" rx="9" fill="#f1f5f9" /><rect x="${barStartX}" y="${y + 8}" width="${barW}" height="18" rx="9" fill="${item.color}"><title>${escapeHTML(item.label)}: ${formatRupees(item.amount)} (${pct}%)</title></rect><text x="${barStartX + maxBarWidth + 12}" y="${y + 22}" fill="#334155" font-size="12" font-weight="700" font-family="system-ui, sans-serif">${formatRupees(item.amount)} <tspan fill="#64748b" font-weight="500">(${pct}%)</tspan></text>`;
  });
  svgHTML += '</svg>';
  container.innerHTML = svgHTML;
}

// ------------------------------------------------------------------------------
// 6. EVENT HANDLERS & USER ACTIONS
// ------------------------------------------------------------------------------
async function handleAddMember(e) {
  e.preventDefault();
  const inputName = document.getElementById("input-member-name"), inputUpi = document.getElementById("input-member-upi");
  const errEl = document.getElementById("member-name-error"), name = inputName.value.trim(), upiId = inputUpi.value.trim();

  errEl.textContent = ""; inputName.classList.remove("input-error");
  if (!name) { errEl.textContent = "Please enter a name."; inputName.classList.add("input-error"); return inputName.focus(); }
  if (name.length > 30) { errEl.textContent = "Name cannot exceed 30 characters."; inputName.classList.add("input-error"); return inputName.focus(); }
  if (state.members.some(m => m.name.toLowerCase() === name.toLowerCase())) { errEl.textContent = `"${name}" is already in the group.`; inputName.classList.add("input-error"); return inputName.focus(); }

  state.members.push({ id: generateId(), name, upiId });
  inputName.value = ""; inputUpi.value = "";
  await saveStateToStorage();
  renderApp();
  showToast(`Added ${name} to the trip!`);
}

function handleRequestDeleteMember(memberId) {
  const member = state.members.find(m => m.id === memberId);
  if (!member) return;
  const memberExpenses = state.expenses.filter(e => e.payerId === memberId);

  if (memberExpenses.length > 0) {
    const totalPaid = memberExpenses.reduce((s, e) => s + e.amount, 0);
    showConfirmModal({
      icon: "⚠️", title: `Delete ${member.name}?`,
      desc: `${member.name} has paid for ${memberExpenses.length} expense(s) totaling ${formatRupees(totalPaid)}. Deleting will ALSO remove these expenses. Confirm?`,
      confirmLabel: "Delete Friend & Expenses",
      onConfirm: async () => {
        state.members = state.members.filter(m => m.id !== memberId);
        state.expenses = state.expenses.filter(e => e.payerId !== memberId);
        await saveStateToStorage();
        renderApp();
        showToast(`Deleted ${member.name}`);
      }
    });
  } else {
    showConfirmModal({
      icon: "🗑️", title: `Delete ${member.name}?`, desc: `Are you sure you want to remove ${member.name} from the trip?`, confirmLabel: "Delete",
      onConfirm: async () => {
        state.members = state.members.filter(m => m.id !== memberId);
        await saveStateToStorage();
        renderApp();
        showToast(`Removed ${member.name}`);
      }
    });
  }
}

async function handleExpenseSubmit(e) {
  e.preventDefault();
  const payerSelect = document.getElementById("select-expense-payer"), amountInput = document.getElementById("input-expense-amount");
  const catSelect = document.getElementById("select-expense-category"), dateInput = document.getElementById("input-expense-date");
  const descInput = document.getElementById("input-expense-description"), editIdInput = document.getElementById("edit-expense-id");
  const beneficiarySelect = document.getElementById("select-single-beneficiary");
  const splitTypeRadio = document.querySelector('input[name="expense-split-type"]:checked');
  const splitType = splitTypeRadio ? splitTypeRadio.value : 'all';

  const payerErr = document.getElementById("expense-payer-error"), amountErr = document.getElementById("expense-amount-error");
  const benErr = document.getElementById("expense-beneficiary-error"), customErr = document.getElementById("expense-custom-error");

  payerErr.textContent = ""; amountErr.textContent = ""; benErr.textContent = ""; customErr.textContent = "";
  payerSelect.classList.remove("input-error"); amountInput.classList.remove("input-error"); beneficiarySelect.classList.remove("input-error");

  let isValid = true;
  if (!payerSelect.value) { payerErr.textContent = "Please select who paid for this expense."; payerSelect.classList.add("input-error"); isValid = false; }
  const rawAmount = amountInput.value.trim(), numAmount = parseFloat(rawAmount);
  if (!rawAmount || isNaN(numAmount) || numAmount <= 0) {
    amountErr.textContent = "Please enter an amount greater than 0."; amountInput.classList.add("input-error"); isValid = false;
  } else if (numAmount > 1000000) {
    amountErr.textContent = "Amount cannot exceed ₹10,00,000."; amountInput.classList.add("input-error"); isValid = false;
  } else if (rawAmount.includes(".") && rawAmount.split(".")[1].length > 2) {
    amountErr.textContent = "Amount can have at most 2 decimal places."; amountInput.classList.add("input-error"); isValid = false;
  }

  let beneficiaryId = "", splitParticipantIds = [];
  if (splitType === 'single') {
    beneficiaryId = beneficiarySelect.value;
    if (!beneficiaryId) { benErr.textContent = "Please select who this expense was for."; beneficiarySelect.classList.add("input-error"); isValid = false; }
  } else if (splitType === 'custom') {
    splitParticipantIds = Array.from(document.querySelectorAll('#custom-members-checkboxes input[type="checkbox"]:checked')).map(cb => cb.value);
    if (splitParticipantIds.length === 0) { customErr.textContent = "Please select at least 1 friend sharing this expense."; isValid = false; }
  }
  if (!isValid) return;

  const paiseAmount = rupeesToPaise(numAmount), editingId = editIdInput.value;
  if (editingId) {
    const existing = state.expenses.find(x => x.id === editingId);
    if (existing) {
      Object.assign(existing, {
        payerId: payerSelect.value, amount: paiseAmount, category: catSelect.value,
        date: dateInput.value || getTodayDateString(), description: descInput.value.trim(),
        splitType, beneficiaryId, splitParticipantIds
      });
    }
    resetExpenseForm();
    showToast("Expense updated!");
  } else {
    state.expenses.push({
      id: generateId(), payerId: payerSelect.value, amount: paiseAmount, category: catSelect.value,
      date: dateInput.value || getTodayDateString(), description: descInput.value.trim(),
      splitType, beneficiaryId, splitParticipantIds
    });
    resetExpenseForm();
    showToast("Expense recorded!");
  }
  await saveStateToStorage();
  renderApp();
}

function loadExpenseIntoForm(expenseId) {
  const exp = state.expenses.find(e => e.id === expenseId);
  if (!exp) return;
  document.getElementById("edit-expense-id").value = exp.id;
  document.getElementById("select-expense-payer").value = exp.payerId;
  document.getElementById("input-expense-amount").value = (exp.amount / 100).toFixed(2);
  document.getElementById("select-expense-category").value = exp.category;
  document.getElementById("input-expense-date").value = exp.date;
  document.getElementById("input-expense-description").value = exp.description || "";

  const st = exp.splitType || 'all';
  const radio = document.querySelector(`input[name="expense-split-type"][value="${st}"]`);
  if (radio) { radio.checked = true; updateSplitTypeVisibility(st); }
  if (st === 'single' && exp.beneficiaryId) document.getElementById("select-single-beneficiary").value = exp.beneficiaryId;
  else if (st === 'custom' && Array.isArray(exp.splitParticipantIds)) {
    document.querySelectorAll('#custom-members-checkboxes input[type="checkbox"]').forEach(cb => { cb.checked = exp.splitParticipantIds.includes(cb.value); });
  }

  document.getElementById("expense-form-title-text").textContent = "Update Expense";
  document.getElementById("expense-form-icon").textContent = "✏️";
  document.getElementById("btn-submit-expense").textContent = "Update Expense";
  document.getElementById("btn-cancel-edit-expense").style.display = "inline-flex";
  document.getElementById("form-expense").scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetExpenseForm() {
  document.getElementById("form-expense").reset();
  document.getElementById("edit-expense-id").value = "";
  document.getElementById("input-expense-date").value = getTodayDateString();
  const defaultRadio = document.querySelector('input[name="expense-split-type"][value="all"]');
  if (defaultRadio) defaultRadio.checked = true;
  updateSplitTypeVisibility('all');

  document.getElementById("expense-form-title-text").textContent = "Add Expense";
  document.getElementById("expense-form-icon").textContent = "➕";
  document.getElementById("btn-submit-expense").textContent = "Save Expense";
  document.getElementById("btn-cancel-edit-expense").style.display = "none";
  document.getElementById("expense-payer-error").textContent = "";
  document.getElementById("expense-amount-error").textContent = "";
  document.getElementById("expense-beneficiary-error").textContent = "";
  document.getElementById("expense-custom-error").textContent = "";
  document.getElementById("select-expense-payer").classList.remove("input-error");
  document.getElementById("input-expense-amount").classList.remove("input-error");
  document.getElementById("select-single-beneficiary").classList.remove("input-error");
}

function updateSplitTypeVisibility(type) {
  document.getElementById("box-split-single").style.display = type === 'single' ? "block" : "none";
  document.getElementById("box-split-custom").style.display = type === 'custom' ? "block" : "none";
}

async function deleteExpense(expenseId) {
  state.expenses = state.expenses.filter(e => e.id !== expenseId);
  if (document.getElementById("edit-expense-id").value === expenseId) resetExpenseForm();
  await saveStateToStorage();
  renderApp();
  showToast("Expense removed");
}

function handleShareWhatsApp() {
  const total = calculateTotalExpense(state.expenses);
  const shares = calculateMemberShares(state.members, state.expenses);
  const settlements = calculateSettlements(shares);

  let msg = `🎒 *Trip Expense Summary*\n💰 *Total Spent:* ${formatRupees(total)}\n👥 *Members:* ${state.members.length} friends\n`;
  if (state.members.length > 0) msg += `🤝 *Equal Share / Person:* ${formatRupees(Math.round(total / state.members.length))}\n`;
  msg += "\n⚖️ *Member Balances:*\n";
  shares.forEach(m => {
    msg += m.balance > 0 ? `• ${m.name}: Gets back ${formatRupees(m.balance)}\n` : (m.balance < 0 ? `• ${m.name}: Owes ${formatRupees(Math.abs(m.balance))}\n` : `• ${m.name}: Settled (₹0.00)\n`);
  });
  msg += "\n🤝 *Pending Settlements:*\n";
  const pending = settlements.filter(s => !state.paidSettlements[s.key]);
  if (pending.length === 0) msg += "🎉 Everyone is settled up!\n";
  else pending.forEach((s, idx) => { msg += `${idx + 1}. ${s.fromName} pays ${s.toName} ${formatRupees(s.amount)}\n`; });
  msg += "\n_Generated by Group Expense Splitter (IndexedDB Edition)_";

  navigator.clipboard.writeText(msg).then(() => showToast("Summary copied to clipboard!")).catch(() => {});
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function handleLoadDemoData() {
  const applyDemo = async () => {
    const idRahul = "demo-" + generateId(), idAman = "demo-" + generateId(), idPriya = "demo-" + generateId();
    state.members = [
      { id: idRahul, name: "Rahul", upiId: "rahul@okhdfcbank" },
      { id: idAman, name: "Aman", upiId: "aman@paytm" },
      { id: idPriya, name: "Priya", upiId: "priya@okaxis" }
    ];
    state.expenses = [
      { id: generateId(), payerId: idRahul, amount: 60000, category: "Hotel", description: "Resort booking", date: getTodayDateString(), splitType: "all" },
      { id: generateId(), payerId: idAman, amount: 30000, category: "Food", description: "Highway Dhaba lunch", date: getTodayDateString(), splitType: "all" }
    ];
    state.paidSettlements = {};
    resetExpenseForm();
    await saveStateToStorage();
    renderApp();
    showToast("Demo trip loaded into IndexedDB!");
  };

  if (state.members.length > 0 || state.expenses.length > 0) {
    showConfirmModal({
      icon: "✨", title: "Load Demo Data?", desc: "This will replace current members and expenses with demo data.", confirmLabel: "Load Demo Data", onConfirm: applyDemo
    });
  } else applyDemo();
}

function handleClearAllData() {
  showConfirmModal({
    icon: "🗑️", title: "Clear All Trip Data?", desc: "Are you sure you want to clear all data from IndexedDB? This cannot be undone.", confirmLabel: "Clear Everything",
    onConfirm: async () => {
      state.members = []; state.expenses = []; state.paidSettlements = {};
      resetExpenseForm();
      await saveStateToStorage();
      renderApp();
      showToast("All data cleared from IndexedDB");
    }
  });
}

function handleDownloadSummaryTxt() {
  const total = calculateTotalExpense(state.expenses), shares = calculateMemberShares(state.members, state.expenses), settlements = calculateSettlements(shares);
  const today = new Date().toLocaleDateString("en-IN", { year: 'numeric', month: 'long', day: 'numeric' });

  let txt = `=================================================================\n            COLLEGE TRIP EXPENSE SETTLEMENT REPORT\n                     Generated on: ${today}\n=================================================================\n\n`;
  txt += `TRIP SUMMARY\n-----------------------------------------------------------------\nTotal Expense           : ${formatRupees(total)}\nTrip Budget             : ${formatRupees(state.tripBudget)}\nEqual Share / Person    : ${state.members.length > 0 ? formatRupees(Math.round(total / state.members.length)) : "₹0.00"}\nTotal Trip Friends      : ${state.members.length}\nTotal Expenses Logged   : ${state.expenses.length}\nStorage Engine          : IndexedDB (Transactional)\n\n`;
  txt += "MEMBER BALANCES BREAKDOWN\n-----------------------------------------------------------------\nName                 | Paid         | Share        | Status\n---------------------+--------------+--------------+-----------\n";
  shares.forEach(m => {
    let st = m.balance > 0 ? `Gets back ${formatRupees(m.balance)}` : (m.balance < 0 ? `Owes ${formatRupees(Math.abs(m.balance))}` : "Settled (₹0.00)");
    txt += `${m.name.padEnd(20, ' ').substring(0, 20)} | ${formatRupees(m.paid).padEnd(12, ' ')} | ${formatRupees(m.share).padEnd(12, ' ')} | ${st}\n`;
  });
  txt += "\nEXPENSES RECORD\n-----------------------------------------------------------------\n";
  state.expenses.forEach((e, idx) => {
    const p = state.members.find(m => m.id === e.payerId);
    txt += `${idx + 1}. [${e.date || today}] ${e.category} - ${formatRupees(e.amount)}\n   Paid by: ${p ? p.name : "Unknown"} | Split: ${e.splitType || 'all'} | Note: ${e.description || "None"}\n`;
  });
  txt += "\nSUGGESTED SETTLEMENTS (WHO PAYS WHOM)\n-----------------------------------------------------------------\n";
  if (settlements.length === 0) txt += "Everyone is all settled up! No payments pending. 🎉\n";
  else settlements.forEach((s, idx) => { txt += `${idx + 1}. ${s.fromName} pays ${s.toName} ${formatRupees(s.amount)} ${state.paidSettlements[s.key] ? "[PAID ✓]" : "[PENDING]"}\n`; });
  txt += "\n=================================================================\n             Split trip costs, keep friendships.                 \n=================================================================\n";

  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `college-trip-expenses-${getTodayDateString()}.txt`;
  a.click(); URL.revokeObjectURL(url);
}

function handleExportCsv() {
  const shares = calculateMemberShares(state.members, state.expenses);
  let csv = "Category,Description,Date,Payer,SplitType,Amount (INR)\n";
  state.expenses.forEach(e => {
    const p = state.members.find(m => m.id === e.payerId);
    csv += `"${e.category}","${(e.description || '').replace(/"/g, '""')}","${e.date || ''}","${p ? p.name : 'Unknown'}","${e.splitType || 'all'}",${(e.amount / 100).toFixed(2)}\n`;
  });
  csv += "\n\nMember,Total Paid (INR),Fair Share (INR),Net Balance (INR),Status\n";
  shares.forEach(m => {
    let st = m.balance > 0 ? "Gets money back" : (m.balance < 0 ? "Owes money" : "Settled");
    csv += `"${m.name}",${(m.paid / 100).toFixed(2)},${(m.share / 100).toFixed(2)},${(m.balance / 100).toFixed(2)},"${st}"\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `trip-expenses-${getTodayDateString()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

let modalConfirmCallback = null;
function showConfirmModal({ icon, title, desc, confirmLabel, onConfirm }) {
  document.getElementById("modal-icon").textContent = icon || "⚠️";
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-desc").textContent = desc;
  document.getElementById("btn-modal-confirm").textContent = confirmLabel || "Confirm";
  modalConfirmCallback = onConfirm;
  document.getElementById("confirm-modal").classList.add("open");
}

function closeConfirmModal() {
  document.getElementById("confirm-modal").classList.remove("open");
  modalConfirmCallback = null;
}

// ------------------------------------------------------------------------------
// 7. IN-BROWSER AUTOMATED UNIT TEST SUITE (Callable via runSelfTests())
// ------------------------------------------------------------------------------
window.runSelfTests = function() {
  console.log("%c=======================================================", "color: #0f766e; font-weight: bold;");
  console.log("%c   GROUP EXPENSE SPLITTER — AUTOMATED SELF TESTS       ", "color: #0f766e; font-weight: bold;");
  console.log("%c=======================================================", "color: #0f766e; font-weight: bold;");

  let totalPassed = 0, totalTests = 0;
  function assert(condition, testName, extraDetails) {
    totalTests++;
    if (condition) {
      console.log(`%c[PASS] ${testName}`, "color: #16a34a; font-weight: bold;");
      totalPassed++;
    } else {
      console.error(`[FAIL] ${testName}`, extraDetails || "");
    }
  }

  // Test 1: Demo Data Calculations
  const mockMembers1 = [{ id: "m1", name: "Rahul", upiId: "rahul@upi" }, { id: "m2", name: "Aman", upiId: "aman@upi" }, { id: "m3", name: "Priya", upiId: "priya@upi" }];
  const mockExpenses1 = [
    { id: "e1", payerId: "m1", amount: 60000, description: "Hotel", category: "Hotel", date: "2026-10-12", splitType: "all" },
    { id: "e2", payerId: "m2", amount: 30000, description: "Food", category: "Food", date: "2026-10-12", splitType: "all" }
  ];
  const total1 = calculateTotalExpense(mockExpenses1);
  assert(total1 === 90000, "Test 1A: Demo total is 90000 paise (₹900.00)", { total1 });
  const shares1 = calculateMemberShares(mockMembers1, mockExpenses1);
  assert(shares1.length === 3, "Test 1B: Exactly 3 member shares computed", { shares1 });
  const rahul = shares1.find(m => m.name === "Rahul"), aman = shares1.find(m => m.name === "Aman"), priya = shares1.find(m => m.name === "Priya");
  assert(rahul && rahul.share === 30000 && rahul.balance === 30000, "Test 1C: Rahul share is ₹300, balance is +₹300 (gets money)", rahul);
  assert(aman && aman.share === 30000 && aman.balance === 0, "Test 1D: Aman share is ₹300, balance is ₹0 (all settled)", aman);
  assert(priya && priya.share === 30000 && priya.balance === -30000, "Test 1E: Priya share is ₹300, balance is -₹300 (owes money)", priya);
  const settlements1 = calculateSettlements(shares1);
  assert(settlements1.length === 1, "Test 1F: Exactly 1 settlement generated", settlements1);
  assert(settlements1[0] && settlements1[0].fromName === "Priya" && settlements1[0].toName === "Rahul" && settlements1[0].amount === 30000, "Test 1G: Settlement is 'Priya pays Rahul ₹300.00'", settlements1[0]);

  // Test 2: Uneven Division (₹100 amongst 3 members)
  const mockMembers2 = [{ id: "u1", name: "Friend A" }, { id: "u2", name: "Friend B" }, { id: "u3", name: "Friend C" }];
  const mockExpenses2 = [{ id: "e3", payerId: "u1", amount: 10000, description: "Shared Pass", category: "Travel", date: "2026-10-12", splitType: "all" }];
  assert(calculateTotalExpense(mockExpenses2) === 10000, "Test 2A: Uneven total is 10000 paise (₹100.00)");
  const shares2 = calculateMemberShares(mockMembers2, mockExpenses2);
  assert(shares2.reduce((sum, m) => sum + m.share, 0) === 10000, "Test 2B: Sum of shares strictly equals total (10000 paise)");
  assert(shares2.reduce((sum, m) => sum + m.balance, 0) === 0, "Test 2C: Balances strictly sum to exactly 0");

  // Test 3: Currency Formatting
  assert(formatRupees(60000) === "₹600.00", "Test 3A: formatRupees(60000) -> '₹600.00'");
  assert(formatRupees(-30000) === "-₹300.00", "Test 3B: formatRupees(-30000) -> '-₹300.00'");

  // Test 4: Single Member Case
  const singleShares = calculateMemberShares([{ id: "solo", name: "Solo Traveler" }], [{ id: "esolo", payerId: "solo", amount: 5000, category: "Food" }]);
  assert(singleShares[0].balance === 0, "Test 4A: Single member balance is 0");
  assert(calculateSettlements(singleShares).length === 0, "Test 4B: No settlements needed for 1 member");

  // Test 5: Paid on Behalf (Rahul pays ₹500 for Priya)
  const mockMembers5 = [{ id: "p1", name: "Rahul" }, { id: "p2", name: "Aman" }, { id: "p3", name: "Priya" }];
  const mockExpenses5 = [{ id: "e5", payerId: "p1", amount: 50000, splitType: "single", beneficiaryId: "p3" }];
  const shares5 = calculateMemberShares(mockMembers5, mockExpenses5);
  const rahul5 = shares5.find(m => m.name === "Rahul"), aman5 = shares5.find(m => m.name === "Aman"), priya5 = shares5.find(m => m.name === "Priya");
  const settlements5 = calculateSettlements(shares5);
  assert(rahul5.balance === 50000, "Test 5A: Rahul balance is +₹500 for paying on behalf", rahul5);
  assert(aman5.balance === 0, "Test 5B: Aman has ₹0 share in Priya's personal shopping", aman5);
  assert(priya5.balance === -50000, "Test 5C: Priya owes exactly ₹500", priya5);
  assert(settlements5.length === 1 && settlements5[0].fromName === "Priya" && settlements5[0].toName === "Rahul" && settlements5[0].amount === 50000, "Test 5D: Single settlement: Priya pays Rahul ₹500.00 directly", settlements5);

  // Test 6: Custom Subset Split (Rahul pays ₹400 for Rahul + Aman only)
  const mockMembers6 = [{ id: "s1", name: "Rahul" }, { id: "s2", name: "Aman" }, { id: "s3", name: "Priya" }];
  const mockExpenses6 = [{ id: "e6", payerId: "s1", amount: 40000, splitType: "custom", splitParticipantIds: ["s1", "s2"] }];
  const shares6 = calculateMemberShares(mockMembers6, mockExpenses6);
  const rahul6 = shares6.find(m => m.name === "Rahul"), aman6 = shares6.find(m => m.name === "Aman"), priya6 = shares6.find(m => m.name === "Priya");
  const settlements6 = calculateSettlements(shares6);
  assert(rahul6.balance === 20000, "Test 6A: Rahul pays ₹400, owes ₹200 -> net balance +₹200", rahul6);
  assert(aman6.balance === -20000, "Test 6B: Aman pays ₹0, owes ₹200 -> net balance -₹200", aman6);
  assert(priya6.balance === 0, "Test 6C: Priya excluded from split -> net balance ₹0", priya6);
  assert(settlements6.length === 1 && settlements6[0].fromName === "Aman" && settlements6[0].toName === "Rahul" && settlements6[0].amount === 20000, "Test 6D: Settlement: Aman pays Rahul ₹200.00", settlements6);

  // Test 7: Security & XSS Sanitization
  const rawPayload = "<img src=x onerror=alert('xss')>&";
  const sanitized = escapeHTML(rawPayload);
  assert(sanitized === "&lt;img src=x onerror=alert(&#039;xss&#039;)&gt;&amp;", "Test 7: HTML escaping reliably neutralizes XSS payloads", { rawPayload, sanitized });

  console.log(`%cRESULTS: ${totalPassed} / ${totalTests} TESTS PASSED!`, totalPassed === totalTests ? "color: #16a34a; font-weight: bold; font-size: 14px;" : "color: #dc2626; font-weight: bold; font-size: 14px;");
  return totalPassed === totalTests;
};

// ------------------------------------------------------------------------------
// 8. APPLICATION INITIALIZATION (DOMContentLoaded)
// ------------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await initIndexedDB();
  await loadStateFromStorage();

  document.getElementById("input-expense-date").value = getTodayDateString();
  document.getElementById("form-add-member").addEventListener("submit", handleAddMember);
  document.getElementById("form-expense").addEventListener("submit", handleExpenseSubmit);
  document.getElementById("btn-cancel-edit-expense").addEventListener("click", resetExpenseForm);

  document.querySelectorAll('input[name="expense-split-type"]').forEach(r => {
    r.addEventListener("change", (e) => updateSplitTypeVisibility(e.target.value));
  });

  const bindClear = (inpId, errId) => {
    document.getElementById(inpId).addEventListener("input", () => {
      document.getElementById(errId).textContent = "";
      document.getElementById(inpId).classList.remove("input-error");
    });
  };
  bindClear("input-member-name", "member-name-error");
  bindClear("input-expense-amount", "expense-amount-error");
  document.getElementById("select-expense-payer").addEventListener("change", () => {
    document.getElementById("expense-payer-error").textContent = "";
    document.getElementById("select-expense-payer").classList.remove("input-error");
  });

  const updateBudgetHandler = async (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      state.tripBudget = rupeesToPaise(val);
      await saveStateToStorage();
      renderBudgetTracker(calculateTotalExpense(state.expenses));
    }
  };
  document.getElementById("input-trip-budget").addEventListener("input", updateBudgetHandler);
  document.getElementById("input-trip-budget").addEventListener("change", updateBudgetHandler);

  document.getElementById("filter-search-text").addEventListener("input", (e) => { state.filters.search = e.target.value; renderExpenseList(); });
  document.getElementById("filter-category").addEventListener("change", (e) => { state.filters.category = e.target.value; renderExpenseList(); });
  document.getElementById("filter-payer").addEventListener("change", (e) => { state.filters.payerId = e.target.value; renderExpenseList(); });
  document.getElementById("btn-reset-filters").addEventListener("click", () => {
    state.filters = { search: "", category: "", payerId: "" };
    document.getElementById("filter-search-text").value = "";
    document.getElementById("filter-category").value = "";
    document.getElementById("filter-payer").value = "";
    renderExpenseList();
  });

  document.getElementById("btn-share-whatsapp").addEventListener("click", handleShareWhatsApp);
  document.getElementById("btn-load-demo").addEventListener("click", handleLoadDemoData);
  document.getElementById("btn-clear-all").addEventListener("click", handleClearAllData);
  document.getElementById("btn-download-summary").addEventListener("click", handleDownloadSummaryTxt);
  document.getElementById("btn-export-csv").addEventListener("click", handleExportCsv);

  const btnCat = document.getElementById("btn-chart-category"), btnMem = document.getElementById("btn-chart-member");
  const switchChart = (mode) => {
    state.chartMode = mode;
    btnCat.classList.toggle("active", mode === "category");
    btnCat.setAttribute("aria-selected", mode === "category");
    btnMem.classList.toggle("active", mode === "member");
    btnMem.setAttribute("aria-selected", mode === "member");
    renderChart(calculateTotalExpense(state.expenses), calculateMemberShares(state.members, state.expenses));
  };
  btnCat.addEventListener("click", () => switchChart("category"));
  btnMem.addEventListener("click", () => switchChart("member"));

  document.getElementById("btn-modal-cancel").addEventListener("click", closeConfirmModal);
  document.getElementById("btn-modal-confirm").addEventListener("click", () => {
    if (typeof modalConfirmCallback === "function") modalConfirmCallback();
    closeConfirmModal();
  });
  document.getElementById("confirm-modal").addEventListener("click", (e) => {
    if (e.target.id === "confirm-modal") closeConfirmModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("confirm-modal").classList.contains("open")) closeConfirmModal();
  });

  renderApp();
  console.log("%c💾 Storage Engine: IndexedDB (Database: TripSplitterDB)", "color: #0f766e; font-weight: bold; font-size: 13px;");
});