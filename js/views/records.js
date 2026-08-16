'use strict';

import { esc, fmtMoney, fmtDate, pad, today } from '../util.js';
import { activeWorkspace, workspaceRecords } from '../store.js';
import { groupedRecords, emptyState, recordRow, totals } from './shared.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function filterRecords(records, { query, type, category }) {
  const q = (query || '').trim().toLowerCase();
  return records.filter(r => {
    if (type && r.type !== type) return false;
    if (category && r.category !== category) return false;
    if (q) {
      const hay = [r.merchant, r.description, r.category, r.ref, r.notes, r.amount.toFixed(2)]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function renderRecords(filters) {
  const ws = activeWorkspace();
  const all = workspaceRecords();
  const matches = filterRecords(all, filters);
  const usedCats = [...new Set(all.map(r => r.category))].sort();
  const sums = totals(matches);

  if (!all.length) {
    return emptyState({
      icon: '🧾',
      title: 'No records yet',
      text: 'Tap the camera button below to snap your first receipt.',
    });
  }

  return `
    <div class="segmented" id="mode-seg" role="tablist">
      <button role="tab" data-mode="list" aria-selected="${filters.mode !== 'calendar'}">List</button>
      <button role="tab" data-mode="calendar" aria-selected="${filters.mode === 'calendar'}">Calendar</button>
    </div>

    ${filters.mode === 'calendar' ? renderCalendar(all, filters, ws) : `
      <div class="searchbar">
        <span aria-hidden="true">🔍</span>
        <input id="q" type="search" placeholder="Search records" value="${esc(filters.query || '')}"
               autocomplete="off" enterkeyhint="search" />
        ${filters.query ? '<button class="clear" id="q-clear" type="button" aria-label="Clear search">✕</button>' : ''}
      </div>

      <div class="chiprow">
        <button class="chip" data-type="" aria-pressed="${!filters.type}">All</button>
        <button class="chip" data-type="expense" aria-pressed="${filters.type === 'expense'}">Out</button>
        <button class="chip" data-type="income" aria-pressed="${filters.type === 'income'}">In</button>
        ${usedCats.map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${filters.category === c}">${esc(c)}</button>`).join('')}
      </div>

      ${matches.length ? `
        <div class="day-head" style="padding-top:12px">
          <span>${matches.length} record${matches.length === 1 ? '' : 's'}</span>
          <span class="day-total">${esc(fmtMoney(sums.net, ws.currency, { sign: true }))}</span>
        </div>
        ${groupedRecords(matches, ws)}
      ` : emptyState({ icon: '🔍', title: 'Nothing matches', text: 'Try a different search or clear the filters.' })}
    `}
  `;
}

function renderCalendar(all, filters, ws) {
  const [cy, cm] = (filters.calMonth || today().slice(0, 7)).split('-').map(Number);
  const monthIso = `${cy}-${pad(cm)}`;
  const firstDow = new Date(cy, cm - 1, 1).getDay();
  const daysInMonth = new Date(cy, cm, 0).getDate();
  const prevDays = new Date(cy, cm - 1, 0).getDate();
  const t = today();

  const byDate = new Map();
  for (const r of all) {
    const keys = [r.date];
    if (r.recurring?.next) keys.push(r.recurring.next);
    for (const k of keys) {
      if (!k.startsWith(monthIso)) continue;
      if (!byDate.has(k)) byDate.set(k, []);
      byDate.get(k).push(r);
    }
  }

  const monthRecords = all.filter(r => r.date.startsWith(monthIso));
  const sums = totals(monthRecords);

  const cells = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push(`<div class="cal-cell muted">${prevDays - i}</div>`);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${monthIso}-${pad(d)}`;
    const items = byDate.get(iso) || [];
    const dots = [...new Set(items.map(r => r.type))]
      .map(type => `<i class="${type === 'income' ? 'in' : 'out'}"></i>`).join('');
    const cls = [
      'cal-cell',
      iso === t ? 'today' : '',
      filters.calDay === iso ? 'sel' : '',
    ].filter(Boolean).join(' ');
    cells.push(`<button class="${cls}" data-day="${iso}" type="button">${d}<span class="cal-dots">${dots}</span></button>`);
  }
  const trail = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= trail; i++) cells.push(`<div class="cal-cell muted">${i}</div>`);

  const selected = filters.calDay
    ? all.filter(r => r.date === filters.calDay || r.recurring?.next === filters.calDay)
    : [];

  return `
    <div class="cal-head" style="margin-top:12px">
      <button class="cal-nav-btn" data-cal="-1" type="button" aria-label="Previous month">‹</button>
      <b>${MONTHS[cm - 1]} ${cy}</b>
      <button class="cal-nav-btn" data-cal="1" type="button" aria-label="Next month">›</button>
    </div>

    <div class="card" style="padding:12px">
      <div class="cal-grid">
        ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
        ${cells.join('')}
      </div>
    </div>

    <div class="hero" style="margin-top:12px">
      <div class="hero-split">
        <div class="hero-stat in">
          <div class="hero-stat-label">In this month</div>
          <div class="hero-stat-value">${esc(fmtMoney(sums.income, ws.currency, { compact: true }))}</div>
        </div>
        <div class="hero-stat out">
          <div class="hero-stat-label">Out this month</div>
          <div class="hero-stat-value">${esc(fmtMoney(sums.expense, ws.currency, { compact: true }))}</div>
        </div>
      </div>
    </div>

    ${filters.calDay ? `
      <div class="section-head"><span class="section-title">${esc(fmtDate(filters.calDay, 'long'))}</span></div>
      ${selected.length
        ? `<div class="card"><div class="rows">${selected.map(r => recordRow(r, ws)).join('')}</div></div>`
        : '<div class="note">Nothing recorded on this day.</div>'}
    ` : '<div class="note" style="margin-top:12px">Tap a day to see what happened.</div>'}
  `;
}
