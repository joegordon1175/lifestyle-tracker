'use strict';

import { esc, fmtMoney, fmtDayLabel, relativeDays, today, monthKey } from '../util.js';
import { categoryIcon, activeWorkspace, recordFileIds } from '../store.js';

/** One transaction row. Used on Home, Records and the calendar day list. */
export function recordRow(r, ws = activeWorkspace()) {
  const income = r.type === 'income';
  const sub = [r.merchant, r.description].filter(Boolean).join(' · ') || r.category;
  return `<button class="row" data-record="${esc(r.id)}" type="button">
    <div class="row-icon ${income ? 'in' : 'out'}">${esc(categoryIcon(r.category, ws))}</div>
    <div class="row-body">
      <div class="row-title">${esc(sub)}</div>
      <div class="row-sub">${esc(r.category)}${recordFileIds(r).length ? '<span class="chip-mini">📎</span>' : ''}${r.recurring ? '<span class="chip-mini">🔁</span>' : ''}</div>
    </div>
    <div class="row-end">
      <div class="row-amount ${income ? 'in' : 'out'}">${income ? '+' : '−'}${esc(fmtMoney(r.amount, r.currency))}</div>
      ${r.date > today() ? '<div class="row-note">scheduled</div>' : ''}
    </div>
  </button>`;
}

/** Records grouped under Today / Yesterday / date headings. */
export function groupedRecords(records, ws = activeWorkspace()) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, rows]) => {
      const net = rows.reduce((s, r) => s + (r.type === 'income' ? r.amount : -r.amount), 0);
      return `<div class="day-head">
          <span>${esc(fmtDayLabel(date))}</span>
          <span class="day-total">${esc(fmtMoney(net, ws.currency, { sign: true }))}</span>
        </div>
        <div class="card"><div class="rows">${rows.map(r => recordRow(r, ws)).join('')}</div></div>`;
    }).join('');
}

export function emptyState({ icon = '🧾', title, text }) {
  return `<div class="empty"><span class="e">${esc(icon)}</span><b>${esc(title)}</b><p>${esc(text)}</p></div>`;
}

// ── Period handling ─────────────────────────────────────────
export const PERIODS = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: '3 months' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All' },
];

export function periodRange(key) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (key === 'month') return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (key === 'quarter') return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (key === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: '0000-01-01', to: '9999-12-31' };
}

export function periodLabel(key) {
  if (key === 'month') return 'This month';
  if (key === 'quarter') return 'Last 3 months';
  if (key === 'year') return 'This year';
  return 'All time';
}

/** Records inside the period that have actually happened (not future-dated). */
export function inPeriod(records, key) {
  const { from, to } = periodRange(key);
  const t = today();
  return records.filter(r => r.date >= from && r.date <= to && r.date <= t);
}

export function totals(records) {
  let income = 0, expense = 0;
  for (const r of records) {
    if (r.type === 'income') income += r.amount; else expense += r.amount;
  }
  return { income, expense, net: income - expense };
}

export function byCategory(records, type) {
  const map = new Map();
  for (const r of records) {
    if (r.type !== type) continue;
    map.set(r.category, (map.get(r.category) || 0) + r.amount);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** Recurring items and future-dated records due within `days`. */
export function upcoming(records, days = 45) {
  const t = today();
  const out = [];
  for (const r of records) {
    if (r.date > t) out.push({ ...r, _due: r.date });
    else if (r.recurring?.next && r.recurring.next > t) out.push({ ...r, _due: r.recurring.next, _recurring: true });
  }
  return out
    .filter(r => relativeDays(r._due) <= days)
    .sort((a, b) => a._due.localeCompare(b._due));
}

export function monthSeries(records, count = 6) {
  const now = new Date();
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const map = Object.fromEntries(keys.map(k => [k, { income: 0, expense: 0 }]));
  const t = today();
  for (const r of records) {
    if (r.date > t) continue;
    const k = monthKey(r.date);
    if (map[k]) map[k][r.type] += r.amount;
  }
  return keys.map(k => ({ key: k, ...map[k] }));
}
