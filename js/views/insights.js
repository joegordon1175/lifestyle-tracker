'use strict';

import { esc, fmtMoney, fmtMonth } from '../util.js';
import { activeWorkspace, workspaceRecords, categoryIcon } from '../store.js';
import { PERIODS, inPeriod, totals, byCategory, monthSeries, emptyState, periodLabel, periodRange } from './shared.js';

export function renderInsights({ period }) {
  const ws = activeWorkspace();
  const all = workspaceRecords();
  if (!all.length) {
    return emptyState({
      icon: '📈',
      title: 'No numbers yet',
      text: 'Once you have a few records, this is where the patterns show up.',
    });
  }

  const rows = inPeriod(all, period);
  const t = totals(rows);
  const series = monthSeries(all, 6);
  const peak = Math.max(1, ...series.flatMap(s => [s.income, s.expense]));

  const expCats = byCategory(rows, 'expense');
  const incCats = byCategory(rows, 'income');
  const expMax = expCats[0]?.[1] || 1;
  const incMax = incCats[0]?.[1] || 1;

  const merchants = new Map();
  for (const r of rows) {
    if (r.type !== 'expense' || !r.merchant) continue;
    const key = r.merchant.trim();
    const cur = merchants.get(key) || { total: 0, count: 0 };
    cur.total += r.amount; cur.count++;
    merchants.set(key, cur);
  }
  const topMerchants = [...merchants.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);

  const days = Math.max(1, elapsedDays(period, rows));
  const perDay = t.expense / days;

  return `
    <div class="segmented" role="tablist" id="period-seg">
      ${PERIODS.map(p => `<button role="tab" data-period="${p.key}" aria-selected="${p.key === period}">${p.label}</button>`).join('')}
    </div>

    <section class="hero">
      <div class="hero-label">${esc(periodLabel(period))} · spending</div>
      <div class="hero-amount neg">${esc(fmtMoney(t.expense, ws.currency))}</div>
      <div class="hero-split">
        <div class="hero-stat">
          <div class="hero-stat-label">Average per day</div>
          <div class="hero-stat-value">${esc(fmtMoney(perDay, ws.currency))}</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-label">Records</div>
          <div class="hero-stat-value">${rows.length}</div>
        </div>
      </div>
    </section>

    <div class="section-head"><span class="section-title">Last 6 months</span></div>
    <div class="card trend">
      <div class="trend-bars">
        ${series.map(s => `
          <div class="trend-col" title="${esc(fmtMonth(s.key))}">
            <div class="trend-pair">
              <div class="trend-bar out" style="height:${bar(s.expense, peak)}"></div>
              <div class="trend-bar in" style="height:${bar(s.income, peak)}"></div>
            </div>
          </div>`).join('')}
      </div>
      <div class="trend-labels">
        ${series.map(s => `<span>${esc(fmtMonth(s.key).split(' ')[0])}</span>`).join('')}
      </div>
      <div class="legend"><span><i class="out"></i>Out</span><span><i class="in"></i>In</span></div>
    </div>

    ${expCats.length ? `
      <div class="section-head"><span class="section-title">Spending by category</span></div>
      <div class="card"><div class="rows">
        ${expCats.map(([name, amt]) => catRow(name, amt, expMax, t.expense, ws, 'out')).join('')}
      </div></div>` : ''}

    ${incCats.length ? `
      <div class="section-head"><span class="section-title">Income by category</span></div>
      <div class="card"><div class="rows">
        ${incCats.map(([name, amt]) => catRow(name, amt, incMax, t.income, ws, 'in')).join('')}
      </div></div>` : ''}

    ${topMerchants.length ? `
      <div class="section-head"><span class="section-title">Most spent with</span></div>
      <div class="card"><div class="rows">
        ${topMerchants.map(([name, v]) => `
          <div class="row">
            <div class="row-icon">🏬</div>
            <div class="row-body">
              <div class="row-title">${esc(name)}</div>
              <div class="row-sub">${v.count} visit${v.count === 1 ? '' : 's'}</div>
            </div>
            <div class="row-end"><div class="row-amount out">${esc(fmtMoney(v.total, ws.currency))}</div></div>
          </div>`).join('')}
      </div></div>` : ''}

    <button class="btn btn-outline" id="btn-export" type="button" style="margin-top:20px">⬇︎ Export these records as CSV</button>
  `;
}

/** A month with no activity gets no bar at all, rather than a misleading stub. */
function bar(value, peak) {
  return value > 0 ? `${Math.max(2, (value / peak) * 100)}%` : '0';
}

function catRow(name, amt, max, total, ws, tone) {
  return `<div class="cat-row">
    <div class="cat-line">
      <span class="cat-emoji">${esc(categoryIcon(name, ws))}</span>
      <span class="cat-name">${esc(name)}</span>
      <span class="cat-amt">${esc(fmtMoney(amt, ws.currency, { compact: true }))}</span>
      <span class="cat-pct">${Math.round((amt / (total || 1)) * 100)}%</span>
    </div>
    <div class="bar"><i class="${tone}" style="width:${Math.max(3, (amt / max) * 100)}%"></i></div>
  </div>`;
}

/**
 * Days the period has actually covered so far — up to today for a live
 * period, or the whole span of the records for "all time".
 */
function elapsedDays(period, rows) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (period === 'all') {
    if (!rows.length) return 1;
    const dates = rows.map(r => r.date).sort();
    const from = new Date(dates[0] + 'T00:00');
    return Math.max(1, Math.round((t - from) / 86400000) + 1);
  }
  const from = new Date(periodRange(period).from + 'T00:00');
  return Math.max(1, Math.round((t - from) / 86400000) + 1);
}
