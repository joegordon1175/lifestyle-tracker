'use strict';

// ── Storage ────────────────────────────────────────────────
const STORE_KEY = 'lbTracker_v1';

function loadData() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch { return []; }
}
function saveData(arr) {
  localStorage.setItem(STORE_KEY, JSON.stringify(arr));
}

let records = loadData();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Navigation ─────────────────────────────────────────────
const pages   = document.querySelectorAll('.page');
const navBtns = document.querySelectorAll('.nav-btn');

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.page;
    pages.forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + target).classList.add('active');
    if (target === 'dashboard')  renderDashboard();
    if (target === 'list')       renderList();
    if (target === 'calendar')   renderCalendar();
  });
});

// ── Format helpers ──────────────────────────────────────────
function fmt(n) {
  return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthStart(year, month) {
  return new Date(year, month, 1).toISOString().slice(0, 10);
}
function monthEnd(year, month) {
  return new Date(year, month + 1, 0).toISOString().slice(0, 10);
}

// ── Period filter ───────────────────────────────────────────
function periodFilter(rec, period) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const d = rec.date;
  if (!d) return false;
  if (period === 'month')   return d >= monthStart(y, m) && d <= monthEnd(y, m);
  if (period === 'quarter') {
    const qStart = new Date(y, Math.floor(m / 3) * 3, 1).toISOString().slice(0, 10);
    const qEnd   = new Date(y, Math.floor(m / 3) * 3 + 3, 0).toISOString().slice(0, 10);
    return d >= qStart && d <= qEnd;
  }
  if (period === 'year') return d.startsWith(String(y));
  return true;
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════
function renderDashboard() {
  const period = document.getElementById('summary-period').value;
  const filtered = records.filter(r => periodFilter(r, period) && r.date <= today());

  const income   = filtered.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const expenses = filtered.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const lease    = filtered.filter(r => r.category === 'Lease Payment').reduce((s, r) => s + r.amount, 0);

  document.getElementById('sum-income').textContent   = fmt(income);
  document.getElementById('sum-expenses').textContent = fmt(expenses);
  document.getElementById('sum-balance').textContent  = fmt(income - expenses);
  document.getElementById('sum-lease').textContent    = fmt(lease);
  document.getElementById('sum-balance').style.color  = income - expenses >= 0 ? 'var(--green)' : 'var(--red)';

  // Header balance
  document.getElementById('header-balance').textContent =
    (income - expenses >= 0 ? '+' : '-') + fmt(income - expenses);

  // Category breakdown
  const bycat = {};
  filtered.forEach(r => {
    if (!bycat[r.category]) bycat[r.category] = { income: 0, expense: 0 };
    bycat[r.category][r.type] += r.amount;
  });
  const maxAmt = Math.max(...Object.values(bycat).map(v => v.income + v.expense), 1);
  const catEl = document.getElementById('category-breakdown');
  catEl.innerHTML = Object.entries(bycat)
    .sort((a, b) => (b[1].income + b[1].expense) - (a[1].income + a[1].expense))
    .map(([cat, v]) => {
      const isIncome = v.income > v.expense;
      const total = v.income + v.expense;
      const pct = Math.round((total / maxAmt) * 100);
      return `<div class="cat-row">
        <span class="cat-name">${cat}</span>
        <div class="cat-bar-wrap"><div class="cat-bar ${isIncome ? 'income' : 'expense'}" style="width:${pct}%"></div></div>
        <span class="cat-amt ${isIncome ? '' : ''}" style="color:${isIncome ? 'var(--green)' : 'var(--red)'}">${fmt(total)}</span>
      </div>`;
    }).join('') || '<div class="empty-state">No data for this period</div>';

  // Upcoming (recurring + future-dated)
  const future  = today();
  const horizon = addDays(today(), 30);
  const upcoming = records.filter(r => r.date > future && r.date <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Also add next occurrences of recurring records
  const recurUpcoming = records.filter(r => r.recurring && r.recurNext)
    .filter(r => r.recurNext > future && r.recurNext <= horizon)
    .map(r => ({ ...r, date: r.recurNext, _isRecur: true }));

  const allUpcoming = [...upcoming, ...recurUpcoming].sort((a, b) => a.date.localeCompare(b.date));

  document.getElementById('upcoming-list').innerHTML = allUpcoming.length
    ? allUpcoming.map(r => {
        const overdue = r.date < today();
        return `<div class="upcoming-item${overdue ? ' overdue' : ''}" data-id="${r.id}">
          <div class="upcoming-left">
            <div class="upcoming-cat">${r.category}${r._isRecur ? ' · recurring' : ''}</div>
            <div class="upcoming-desc">${r.description || r.category}</div>
            <div class="upcoming-date${overdue ? ' overdue' : ''}">${fmtDate(r.date)}${overdue ? ' — overdue' : ''}</div>
          </div>
          <div class="upcoming-amt">${fmt(r.amount)}</div>
        </div>`;
      }).join('')
    : '<div class="empty-state">No upcoming expenses in the next 30 days</div>';
}

document.getElementById('summary-period').addEventListener('change', renderDashboard);

// ══════════════════════════════════════════════════════════════
// PHOTO CAPTURE
// ══════════════════════════════════════════════════════════════
let capturedPhoto = null;

document.getElementById('photo-input').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    capturedPhoto = e.target.result;
    const prev = document.getElementById('photo-preview');
    prev.src = capturedPhoto;
    prev.classList.remove('hidden');
    document.getElementById('photo-label').classList.add('hidden');
    document.getElementById('photo-clear').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

document.getElementById('photo-clear').addEventListener('click', () => {
  capturedPhoto = null;
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('photo-label').classList.remove('hidden');
  document.getElementById('photo-clear').classList.add('hidden');
  document.getElementById('photo-input').value = '';
});

// ══════════════════════════════════════════════════════════════
// ADD / EDIT FORM
// ══════════════════════════════════════════════════════════════
document.getElementById('f-recurring').addEventListener('change', function () {
  document.getElementById('recurring-fields').classList.toggle('hidden', !this.checked);
});

// Set today as default date
document.getElementById('f-date').value = today();

const form = document.getElementById('transaction-form');

form.addEventListener('submit', e => {
  e.preventDefault();
  const type     = form.querySelector('[name=type]:checked').value;
  const amount   = parseFloat(document.getElementById('f-amount').value);
  const category = document.getElementById('f-category').value;
  const desc     = document.getElementById('f-desc').value.trim();
  const date     = document.getElementById('f-date').value;
  const payee    = document.getElementById('f-payee').value.trim();
  const ref      = document.getElementById('f-ref').value.trim();
  const notes    = document.getElementById('f-notes').value.trim();
  const recurring = document.getElementById('f-recurring').checked;
  const recurFreq = document.getElementById('f-recur-freq').value;
  const recurNext = document.getElementById('f-recur-next').value;

  const editId = document.getElementById('edit-id').value;

  const rec = {
    id: editId || uid(),
    type, amount, category, description: desc, date,
    payee, ref, notes, recurring, recurFreq,
    recurNext: recurring ? recurNext : null,
    photo: capturedPhoto,
    createdAt: editId ? undefined : new Date().toISOString(),
  };

  if (editId) {
    const idx = records.findIndex(r => r.id === editId);
    if (idx !== -1) {
      rec.createdAt = records[idx].createdAt;
      records[idx] = rec;
    }
  } else {
    records.push(rec);
  }
  saveData(records);
  resetForm();
  renderDashboard();
  // Switch to list
  navBtns.forEach(b => b.classList.remove('active'));
  document.querySelector('[data-page="list"]').classList.add('active');
  pages.forEach(p => p.classList.remove('active'));
  document.getElementById('page-list').classList.add('active');
  renderList();
});

function resetForm() {
  form.reset();
  document.getElementById('edit-id').value = '';
  document.getElementById('f-date').value = today();
  capturedPhoto = null;
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('photo-label').classList.remove('hidden');
  document.getElementById('photo-clear').classList.add('hidden');
  document.getElementById('photo-input').value = '';
  document.getElementById('recurring-fields').classList.add('hidden');
  document.getElementById('add-page-title').textContent = 'Add Transaction';
  document.getElementById('btn-cancel').classList.add('hidden');
  document.getElementById('btn-save').textContent = 'Save Transaction';
}

document.getElementById('btn-cancel').addEventListener('click', resetForm);

// ══════════════════════════════════════════════════════════════
// RECORDS LIST
// ══════════════════════════════════════════════════════════════
function buildFilterCats() {
  const cats = [...new Set(records.map(r => r.category))].sort();
  const sel = document.getElementById('filter-cat');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' +
    cats.map(c => `<option value="${c}"${c === cur ? ' selected' : ''}>${c}</option>`).join('');
}

function renderList() {
  buildFilterCats();
  const search  = document.getElementById('search-box').value.toLowerCase();
  const typeF   = document.getElementById('filter-type').value;
  const catF    = document.getElementById('filter-cat').value;

  const filtered = records.filter(r => {
    if (typeF && r.type !== typeF) return false;
    if (catF  && r.category !== catF) return false;
    if (search) {
      const haystack = [r.description, r.category, r.payee, r.ref, r.notes].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));

  const el = document.getElementById('records-list');
  if (!filtered.length) {
    el.innerHTML = '<div class="empty-state">No records found</div>';
    return;
  }

  const catIcons = {
    'Lease Payment': '🏡', 'Feed & Supplements': '🌾', 'Veterinary': '🩺',
    'Fencing': '🪚', 'Equipment': '🚜', 'Fuel': '⛽', 'Electricity': '⚡',
    'Water / Irrigation': '💧', 'Seeds & Plants': '🌱', 'Fertiliser & Sprays': '🧪',
    'Insurance': '🛡️', 'Rates': '📜', 'Repairs & Maintenance': '🔧', 'Labour': '👷',
    'Livestock Sales': '🐄', 'Produce Sales': '🥕', 'Rental Income': '🏘️',
    'Grant / Subsidy': '💵', 'Other Income': '💰', 'Other Expense': '📦',
  };

  el.innerHTML = filtered.map(r => `
    <div class="record-item ${r.type}-rec" data-id="${r.id}">
      <div class="record-icon">${catIcons[r.category] || (r.type === 'income' ? '💰' : '📦')}</div>
      <div class="record-body">
        <div class="record-cat">${r.category} ${r.photo ? '📷' : ''}</div>
        <div class="record-desc">${r.description || r.payee || r.category}</div>
        <div class="record-date">${fmtDate(r.date)}${r.payee ? ' · ' + r.payee : ''}</div>
      </div>
      <div class="record-amount">${r.type === 'income' ? '+' : '-'}${fmt(r.amount)}</div>
    </div>
  `).join('');

  el.querySelectorAll('.record-item').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
  });
}

['search-box', 'filter-type', 'filter-cat'].forEach(id => {
  document.getElementById(id).addEventListener('input', renderList);
  document.getElementById(id).addEventListener('change', renderList);
});

// ══════════════════════════════════════════════════════════════
// DETAIL MODAL
// ══════════════════════════════════════════════════════════════
let modalRecordId = null;

function openDetail(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  modalRecordId = id;

  const rows = [
    ['Type',       r.type === 'income' ? '💰 Income' : '💸 Expense'],
    ['Amount',     fmt(r.amount)],
    ['Category',   r.category],
    ['Date',       fmtDate(r.date)],
    r.description && ['Description', r.description],
    r.payee       && ['Payee',        r.payee],
    r.ref         && ['Reference',    r.ref],
    r.recurring   && ['Recurring',    r.recurFreq + (r.recurNext ? ' · next ' + fmtDate(r.recurNext) : '')],
    r.notes       && ['Notes',        r.notes],
    r.createdAt   && ['Added',        new Date(r.createdAt).toLocaleDateString()],
  ].filter(Boolean);

  document.getElementById('modal-content').innerHTML =
    (r.photo ? `<img src="${r.photo}" alt="Receipt" />` : '') +
    rows.map(([l, v]) => `<div class="modal-detail-row"><span class="modal-detail-label">${l}</span><span class="modal-detail-value">${v}</span></div>`).join('');

  document.getElementById('detail-modal').classList.remove('hidden');
}

document.querySelector('.modal-close').addEventListener('click', closeModal);
document.querySelector('.modal-backdrop').addEventListener('click', closeModal);

function closeModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  modalRecordId = null;
}

document.getElementById('modal-edit').addEventListener('click', () => {
  if (!modalRecordId) return;
  closeModal();
  startEdit(modalRecordId);
});

document.getElementById('modal-delete').addEventListener('click', () => {
  if (!modalRecordId) return;
  if (!confirm('Delete this record?')) return;
  records = records.filter(r => r.id !== modalRecordId);
  saveData(records);
  closeModal();
  renderList();
  renderDashboard();
});

function startEdit(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;

  // Navigate to add page
  navBtns.forEach(b => b.classList.remove('active'));
  document.querySelector('[data-page="add"]').classList.add('active');
  pages.forEach(p => p.classList.remove('active'));
  document.getElementById('page-add').classList.add('active');

  document.getElementById('edit-id').value = r.id;
  document.querySelector(`[name=type][value=${r.type}]`).checked = true;
  document.getElementById('f-amount').value   = r.amount;
  document.getElementById('f-category').value = r.category;
  document.getElementById('f-desc').value     = r.description || '';
  document.getElementById('f-date').value     = r.date;
  document.getElementById('f-payee').value    = r.payee || '';
  document.getElementById('f-ref').value      = r.ref || '';
  document.getElementById('f-notes').value    = r.notes || '';
  document.getElementById('f-recurring').checked = !!r.recurring;
  document.getElementById('recurring-fields').classList.toggle('hidden', !r.recurring);
  if (r.recurring) {
    document.getElementById('f-recur-freq').value = r.recurFreq || 'monthly';
    document.getElementById('f-recur-next').value = r.recurNext || '';
  }

  if (r.photo) {
    capturedPhoto = r.photo;
    document.getElementById('photo-preview').src = r.photo;
    document.getElementById('photo-preview').classList.remove('hidden');
    document.getElementById('photo-label').classList.add('hidden');
    document.getElementById('photo-clear').classList.remove('hidden');
  }

  document.getElementById('add-page-title').textContent = 'Edit Transaction';
  document.getElementById('btn-cancel').classList.remove('hidden');
  document.getElementById('btn-save').textContent = 'Update Transaction';
  window.scrollTo(0, 0);
}

// ══════════════════════════════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════════════════════════════
let calYear, calMonth;
{
  const n = new Date();
  calYear  = n.getFullYear();
  calMonth = n.getMonth();
}

document.getElementById('cal-prev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

function renderCalendar() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-title').textContent = `${months[calMonth]} ${calYear}`;

  const grid = document.getElementById('cal-grid');
  const days  = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html = days.map(d => `<div class="cal-header">${d}</div>`).join('');

  const first = new Date(calYear, calMonth, 1).getDay();
  const last  = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr = today();

  // Build date → records map (include future-dated records + recurring next)
  const dateMap = {};
  records.forEach(r => {
    const key = r.date;
    if (!dateMap[key]) dateMap[key] = [];
    dateMap[key].push({ type: r.type, future: key > todayStr });
    if (r.recurring && r.recurNext) {
      if (!dateMap[r.recurNext]) dateMap[r.recurNext] = [];
      dateMap[r.recurNext].push({ type: r.type, future: true });
    }
  });

  // Blanks before month start
  for (let i = 0; i < first; i++) {
    const prevDate = new Date(calYear, calMonth, -(first - i - 1)).getDate();
    html += `<div class="cal-cell other-month"><div class="cal-day-num">${prevDate}</div></div>`;
  }

  for (let d = 1; d <= last; d++) {
    const iso = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = iso === todayStr;
    const events  = dateMap[iso] || [];
    const dots = events.slice(0, 6).map(e =>
      `<div class="cal-dot ${e.future ? 'future' : e.type}"></div>`
    ).join('');
    html += `<div class="cal-cell${isToday ? ' today' : ''}${events.length ? ' has-event' : ''}" data-date="${iso}">
      <div class="cal-day-num">${d}</div>
      <div class="cal-dots">${dots}</div>
    </div>`;
  }

  // Trailing blanks
  const total = first + last;
  const trail = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= trail; i++) {
    html += `<div class="cal-cell other-month"><div class="cal-day-num">${i}</div></div>`;
  }

  grid.innerHTML = html;

  grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => showCalDay(cell.dataset.date));
  });

  document.getElementById('cal-day-detail').classList.add('hidden');
}

function showCalDay(iso) {
  const dayRecs = records.filter(r => r.date === iso);
  // Also show recurring items due on this date
  const recurRecs = records.filter(r => r.recurring && r.recurNext === iso);

  const all = [
    ...dayRecs,
    ...recurRecs.filter(r => !dayRecs.includes(r)).map(r => ({ ...r, _isRecur: true })),
  ];

  const detail = document.getElementById('cal-day-detail');
  if (!all.length) {
    detail.innerHTML = `<h3>${fmtDate(iso)}</h3><div class="empty-state">No entries for this day</div>`;
  } else {
    detail.innerHTML = `<h3>${fmtDate(iso)}</h3>` + all.map(r => `
      <div class="record-item ${r.type}-rec" data-id="${r.id}" style="margin-bottom:6px">
        <div class="record-body">
          <div class="record-cat">${r.category}${r._isRecur ? ' · recurring' : ''}</div>
          <div class="record-desc">${r.description || r.payee || r.category}</div>
        </div>
        <div class="record-amount">${r.type === 'income' ? '+' : '-'}${fmt(r.amount)}</div>
      </div>
    `).join('');
    detail.querySelectorAll('.record-item').forEach(el => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
    });
  }
  detail.classList.remove('hidden');
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Init ────────────────────────────────────────────────────
renderDashboard();
renderList();
renderCalendar();

// Seed sample data if empty so the app looks useful on first launch
if (!records.length) {
  const samples = [
    { id: uid(), type:'expense', amount:1200,  category:'Lease Payment',       description:'Monthly lease',        date: today().slice(0,7)+'-01', payee:'Land Trust',       ref:'', notes:'', recurring:true, recurFreq:'monthly', recurNext: addDays(today(), 30), photo:null, createdAt: new Date().toISOString() },
    { id: uid(), type:'expense', amount:340.50, category:'Feed & Supplements', description:'Hay bales × 10',       date: addDays(today(),-5),       payee:'Smith Rural',      ref:'INV-001', notes:'', recurring:false, photo:null, createdAt: new Date().toISOString() },
    { id: uid(), type:'expense', amount:85,    category:'Veterinary',           description:'Sheep drenching',      date: addDays(today(),-12),      payee:'Valley Vets',      ref:'', notes:'', recurring:false, photo:null, createdAt: new Date().toISOString() },
    { id: uid(), type:'income',  amount:650,   category:'Livestock Sales',      description:'2× lambs sold',        date: addDays(today(),-3),       payee:'Farmgate Market',  ref:'', notes:'', recurring:false, photo:null, createdAt: new Date().toISOString() },
    { id: uid(), type:'expense', amount:220,   category:'Electricity',          description:'Monthly power bill',   date: addDays(today(),-8),       payee:'Power Co',         ref:'ELEC-882', notes:'', recurring:true, recurFreq:'monthly', recurNext: addDays(today(), 22), photo:null, createdAt: new Date().toISOString() },
    { id: uid(), type:'expense', amount:95,    category:'Fuel',                 description:'Diesel for tractor',   date: addDays(today(),-2),       payee:'Gull Service Stn', ref:'', notes:'', recurring:false, photo:null, createdAt: new Date().toISOString() },
    { id: uid(), type:'income',  amount:200,   category:'Produce Sales',        description:'Eggs & vegetables',    date: addDays(today(),-1),       payee:'Farmers Market',   ref:'', notes:'', recurring:false, photo:null, createdAt: new Date().toISOString() },
    { id: uid(), type:'expense', amount:1200,  category:'Lease Payment',        description:'Next month lease',     date: addDays(today(), 18),      payee:'Land Trust',       ref:'', notes:'', recurring:false, photo:null, createdAt: new Date().toISOString() },
  ];
  records = samples;
  saveData(records);
  renderDashboard();
  renderList();
  renderCalendar();
}
