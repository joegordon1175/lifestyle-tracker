'use strict';

import { esc, fmtMoney, fmtDate, relativeDays } from '../util.js';
import { activeWorkspace, workspaceRecords, categoryIcon } from '../store.js';
import {
  recordRow, emptyState, PERIODS, inPeriod, totals, byCategory, upcoming, periodLabel,
} from './shared.js';

export function renderHome({ period }) {
  const ws = activeWorkspace();
  const all = workspaceRecords();
  const rows = inPeriod(all, period);
  const t = totals(rows);
  const cats = byCategory(rows, 'expense').slice(0, 5);
  const catMax = cats[0]?.[1] || 1;
  const due = upcoming(all, 45).slice(0, 4);
  const recent = all
    .filter(r => r.date <= new Date().toISOString().slice(0, 10))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const first = !all.length;

  return `
    <section class="scan-card">
      <div class="scan-title">Snap a receipt</div>
      <div class="scan-sub">Point the camera at it. The amount, date, shop and category fill themselves in.</div>
      <div class="scan-actions">
        <button class="scan-btn primary" data-act="camera" type="button">📷 Take photo</button>
        <button class="scan-btn" data-act="file" type="button">📁 Upload</button>
        <button class="scan-btn icon-only" data-act="paste" type="button" aria-label="Paste from clipboard" title="Paste from clipboard">📋</button>
      </div>
    </section>

    ${first ? emptyState({
      icon: '👋',
      title: 'Nothing here yet',
      text: 'Snap your first receipt, or upload a PDF invoice or CSV bank statement to fill this in fast.',
    }) : `
    <div class="segmented" role="tablist" id="period-seg">
      ${PERIODS.map(p => `<button role="tab" data-period="${p.key}" aria-selected="${p.key === period}">${p.label}</button>`).join('')}
    </div>

    <section class="hero">
      <div class="hero-label">${esc(periodLabel(period))} · net</div>
      <div class="hero-amount ${t.net >= 0 ? 'pos' : 'neg'}">${esc(fmtMoney(t.net, ws.currency))}</div>
      <div class="hero-split">
        <div class="hero-stat in">
          <div class="hero-stat-label">Money in</div>
          <div class="hero-stat-value">${esc(fmtMoney(t.income, ws.currency, { compact: true }))}</div>
        </div>
        <div class="hero-stat out">
          <div class="hero-stat-label">Money out</div>
          <div class="hero-stat-value">${esc(fmtMoney(t.expense, ws.currency, { compact: true }))}</div>
        </div>
      </div>
    </section>

    ${due.length ? `
      <div class="section-head"><span class="section-title">Coming up</span></div>
      <div class="card"><div class="rows">
        ${due.map(r => {
          const days = relativeDays(r._due);
          const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
          return `<button class="row" data-record="${esc(r.id)}" type="button">
            <div class="row-icon">${esc(categoryIcon(r.category, ws))}</div>
            <div class="row-body">
              <div class="row-title">${esc(r.merchant || r.description || r.category)}</div>
              <div class="row-sub">${esc(fmtDate(r._due))} · ${esc(when)}${r._recurring ? '<span class="chip-mini">🔁</span>' : ''}</div>
            </div>
            <div class="row-end"><div class="row-amount out">${esc(fmtMoney(r.amount, r.currency))}</div></div>
          </button>`;
        }).join('')}
      </div></div>` : ''}

    ${cats.length ? `
      <div class="section-head">
        <span class="section-title">Where it went</span>
        <button class="section-link" data-goto="insights" type="button">Details</button>
      </div>
      <div class="card"><div class="rows">
        ${cats.map(([name, amt]) => `
          <div class="cat-row">
            <div class="cat-line">
              <span class="cat-emoji">${esc(categoryIcon(name, ws))}</span>
              <span class="cat-name">${esc(name)}</span>
              <span class="cat-amt">${esc(fmtMoney(amt, ws.currency, { compact: true }))}</span>
              <span class="cat-pct">${Math.round((amt / (t.expense || 1)) * 100)}%</span>
            </div>
            <div class="bar"><i class="out" style="width:${Math.max(3, (amt / catMax) * 100)}%"></i></div>
          </div>`).join('')}
      </div></div>` : ''}

    ${recent.length ? `
      <div class="section-head">
        <span class="section-title">Recent</span>
        <button class="section-link" data-goto="records" type="button">See all</button>
      </div>
      <div class="card"><div class="rows">${recent.map(r => recordRow(r, ws)).join('')}</div></div>` : ''}
    `}
  `;
}
