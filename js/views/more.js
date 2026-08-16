'use strict';

import { esc, h, $, $$, openSheet, toast, confirmSheet, haptic, fmtMoney } from '../util.js';
import {
  state, activeWorkspace, workspaceRecords, makeWorkspace, addWorkspace, saveWorkspaces,
  setActiveWorkspace, deleteWorkspace, saveSettings, categoriesFor, addCategory, removeCategory,
  exportBackup, importBackup, estimateUsage,
} from '../store.js';
import { PRESETS, ACCENTS } from '../presets.js';
import { toCSV, downloadBlob } from '../csv.js';

const CURRENCIES = ['NZD', 'AUD', 'USD', 'GBP', 'EUR', 'CAD', 'SGD', 'JPY', 'INR', 'ZAR', 'CHF', 'HKD', 'THB', 'PHP'];

export function renderMore() {
  const ws = activeWorkspace();
  const count = workspaceRecords().length;
  const theme = state.settings.theme;

  // Wrapped so wireMore() can bind to an element that is replaced on every
  // render — binding to the persistent #view would stack listeners.
  return `<div class="more-root">
    <div class="section-head"><span class="section-title">Workspaces</span></div>
    <div class="card"><div class="rows">
      ${state.workspaces.map(w => `
        <button class="ws-row row" data-ws="${esc(w.id)}" type="button">
          <div class="row-icon" style="background:${esc(w.accent)}22">${esc(w.icon || '📁')}</div>
          <div class="row-body">
            <div class="row-title">${esc(w.name)}</div>
            <div class="row-sub">${esc(PRESETS[w.preset]?.label || 'Custom')} · ${state.records.filter(r => r.ws === w.id).length} records · ${esc(w.currency)}</div>
          </div>
          ${w.id === ws.id ? '<span class="tick">✓</span>' : ''}
        </button>`).join('')}
      <button class="row" data-act="new-ws" type="button">
        <div class="row-icon" style="background:var(--accent-soft)">＋</div>
        <div class="row-body"><div class="row-title">New workspace</div>
          <div class="row-sub">Keep a trip, a rental or the business separate</div></div>
      </button>
    </div></div>

    <div class="section-head"><span class="section-title">${esc(ws.name)}</span></div>
    <div class="card"><div class="rows">
      <button class="row" data-act="edit-ws" type="button">
        <div class="row-icon">✏️</div>
        <div class="row-body"><div class="row-title">Name, colour & currency</div>
          <div class="row-sub">${esc(ws.name)} · ${esc(ws.currency)}</div></div>
      </button>
      <button class="row" data-act="categories" type="button">
        <div class="row-icon">🏷️</div>
        <div class="row-body"><div class="row-title">Categories</div>
          <div class="row-sub">${categoriesFor('expense', ws).length} out · ${categoriesFor('income', ws).length} in</div></div>
      </button>
    </div></div>

    <div class="section-head"><span class="section-title">Your data</span></div>
    <div class="card"><div class="rows">
      <button class="row" data-act="export-csv" type="button">
        <div class="row-icon">📊</div>
        <div class="row-body"><div class="row-title">Export to CSV</div>
          <div class="row-sub">${count} records — opens in Excel or Sheets</div></div>
      </button>
      <button class="row" data-act="backup" type="button">
        <div class="row-icon">💾</div>
        <div class="row-body"><div class="row-title">Back up everything</div>
          <div class="row-sub">All workspaces to a single file</div></div>
      </button>
      <button class="row" data-act="restore" type="button">
        <div class="row-icon">📥</div>
        <div class="row-body"><div class="row-title">Restore from backup</div>
          <div class="row-sub">Merge a backup file into this device</div></div>
      </button>
    </div></div>

    <div class="section-head"><span class="section-title">Preferences</span></div>
    <div class="card" style="padding:4px 14px">
      <div class="switch-row">
        <div class="switch-text"><b>Appearance</b><small>How the app looks</small></div>
      </div>
      <div class="segmented" id="theme-seg" style="margin-bottom:14px">
        <button data-theme="system" aria-selected="${theme === 'system'}">Auto</button>
        <button data-theme="light" aria-selected="${theme === 'light'}">Light</button>
        <button data-theme="dark" aria-selected="${theme === 'dark'}">Dark</button>
      </div>
      <div class="switch-row" style="border-top:1px solid var(--border)">
        <div class="switch-text"><b>Dates on receipts</b><small>How 04/03/26 should be read</small></div>
      </div>
      <div class="segmented" id="dateorder-seg" style="margin-bottom:14px">
        <button data-order="dmy" aria-selected="${state.settings.dateOrder === 'dmy'}">Day first</button>
        <button data-order="mdy" aria-selected="${state.settings.dateOrder === 'mdy'}">Month first</button>
      </div>
    </div>

    <div class="section-head"><span class="section-title">About</span></div>
    <div class="note">
      Everything stays on this device — receipts are read on your phone and nothing is uploaded.
      Add the app to your home screen to use it offline.
      <div id="usage" style="margin-top:8px;color:var(--text-3)"></div>
    </div>

    <button class="btn btn-outline btn-sm" data-act="danger" type="button" style="margin-top:18px">Delete this workspace…</button>
  </div>`;
}

export function wireMore(container, { rerender, refreshChrome }) {
  const root = $('.more-root', container);
  if (!root) return;
  estimateUsage().then(est => {
    if (!est || !$('#usage', root)) return;
    const mb = (est.usage || 0) / 1048576;
    $('#usage', root).textContent = `Using about ${mb < 1 ? '<1' : mb.toFixed(1)} MB of on-device storage.`;
  });

  $('#theme-seg', root)?.addEventListener('click', async e => {
    const b = e.target.closest('[data-theme]');
    if (!b) return;
    state.settings.theme = b.dataset.theme;
    await saveSettings();
    refreshChrome();
    rerender();
  });

  $('#dateorder-seg', root)?.addEventListener('click', async e => {
    const b = e.target.closest('[data-order]');
    if (!b) return;
    state.settings.dateOrder = b.dataset.order;
    await saveSettings();
    rerender();
  });

  root.addEventListener('click', async e => {
    const wsBtn = e.target.closest('[data-ws]');
    if (wsBtn) {
      await setActiveWorkspace(wsBtn.dataset.ws);
      haptic();
      refreshChrome();
      rerender();
      return;
    }

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;

    if (act === 'new-ws') openWorkspaceSheet({ onDone: () => { refreshChrome(); rerender(); } });
    if (act === 'edit-ws') openWorkspaceSheet({ ws: activeWorkspace(), onDone: () => { refreshChrome(); rerender(); } });
    if (act === 'categories') openCategorySheet({ onDone: rerender });
    if (act === 'export-csv') doExportCSV();
    if (act === 'backup') doBackup();
    if (act === 'restore') document.getElementById('restore-input').click();
    if (act === 'danger') {
      const ws = activeWorkspace();
      const n = workspaceRecords().length;
      const ok = await confirmSheet({
        title: `Delete “${ws.name}”?`,
        message: `${n} record${n === 1 ? '' : 's'} and any attached receipts will be permanently removed. Back up first if you might want them.`,
        confirmLabel: 'Delete workspace',
        danger: true,
      });
      if (!ok) return;
      await deleteWorkspace(ws.id);
      refreshChrome();
      rerender();
      toast('Workspace deleted');
    }
  });
}

// ── Workspace create / edit ─────────────────────────────────
export function openWorkspaceSheet({ ws = null, onDone, firstRun = false } = {}) {
  const editing = !!ws;
  let preset = ws?.preset || 'personal';
  let accent = ws?.accent || PRESETS[preset].accent;

  const body = h(`<form>
    ${firstRun ? '<p class="sheet-text" style="margin-bottom:14px">Pick what you are tracking. You can add more workspaces later and switch between them.</p>' : ''}

    ${editing ? '' : `
    <div class="field">
      <span class="field-label">What is this for?</span>
      <div class="preset-grid" id="preset-grid">
        ${Object.entries(PRESETS).map(([key, p]) => `
          <button type="button" class="preset-tile" data-preset="${key}" aria-pressed="${key === preset}">
            <span class="e">${p.icon}</span><b>${esc(p.label)}</b><small>${esc(p.blurb)}</small>
          </button>`).join('')}
      </div>
    </div>`}

    <div class="field">
      <label for="wsf-name">Name</label>
      <input class="input" id="wsf-name" type="text" value="${esc(ws?.name || PRESETS[preset].label)}"
             placeholder="e.g. Japan trip 2026" autocomplete="off" />
    </div>

    <div class="field-pair">
      <div class="field">
        <label for="wsf-cur">Currency</label>
        <select class="input" id="wsf-cur">
          ${CURRENCIES.map(c => `<option value="${c}"${c === (ws?.currency || 'NZD') ? ' selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <span class="field-label">Colour</span>
        <div style="display:flex;gap:7px;flex-wrap:wrap;padding-top:5px" id="accent-row">
          ${ACCENTS.map(c => `<button type="button" data-accent="${c}" aria-pressed="${c === accent}"
            style="width:32px;height:32px;border-radius:50%;background:${c};border:3px solid ${c === accent ? 'var(--text)' : 'transparent'}"
            aria-label="Accent colour"></button>`).join('')}
        </div>
      </div>
    </div>

    ${editing ? '<div class="note">Changing the name or colour keeps all your records.</div>' : ''}

    <div class="sheet-actions">
      ${firstRun ? '' : '<button type="button" class="btn btn-ghost" id="wsf-cancel">Cancel</button>'}
      <button type="submit" class="btn btn-primary ${firstRun ? 'full' : ''}">${editing ? 'Save' : 'Create workspace'}</button>
    </div>
  </form>`);

  const sheet = openSheet({
    title: editing ? 'Edit workspace' : firstRun ? 'What are you tracking?' : 'New workspace',
    body,
    size: 'full',
    dismissable: !firstRun,
  });

  const nameInput = $('#wsf-name', body);
  let nameTouched = editing;
  nameInput.addEventListener('input', () => { nameTouched = true; });

  $('#preset-grid', body)?.addEventListener('click', e => {
    const tile = e.target.closest('[data-preset]');
    if (!tile) return;
    preset = tile.dataset.preset;
    accent = PRESETS[preset].accent;
    haptic();
    $$('.preset-tile', body).forEach(t => t.setAttribute('aria-pressed', String(t === tile)));
    $$('[data-accent]', body).forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.accent === accent));
      b.style.borderColor = b.dataset.accent === accent ? 'var(--text)' : 'transparent';
    });
    if (!nameTouched) nameInput.value = PRESETS[preset].label;
  });

  $('#accent-row', body).addEventListener('click', e => {
    const b = e.target.closest('[data-accent]');
    if (!b) return;
    accent = b.dataset.accent;
    $$('[data-accent]', body).forEach(x => {
      x.setAttribute('aria-pressed', String(x === b));
      x.style.borderColor = x === b ? 'var(--text)' : 'transparent';
    });
  });

  $('#wsf-cancel', body)?.addEventListener('click', () => sheet.close());

  body.addEventListener('submit', async e => {
    e.preventDefault();
    const name = nameInput.value.trim() || PRESETS[preset].label;
    const currency = $('#wsf-cur', body).value;

    if (editing) {
      ws.name = name;
      ws.currency = currency;
      ws.accent = accent;
      delete ws.provisional;
      await saveWorkspaces();
    } else {
      const created = makeWorkspace({ name, preset, currency, accent });
      await addWorkspace(created);
      await setActiveWorkspace(created.id);
      // Drop the empty starter workspace rather than leaving a duplicate.
      const stale = state.workspaces.find(w =>
        w.provisional && w.id !== created.id && !state.records.some(r => r.ws === w.id));
      if (stale) await deleteWorkspace(stale.id);
      await setActiveWorkspace(created.id);
    }
    if (firstRun) {
      state.settings.onboarded = true;
      await saveSettings();
    }
    sheet.close();
    haptic([10, 30, 10]);
    onDone?.();
    if (!editing) toast(`“${name}” is ready — snap a receipt to start`);
  });

  return sheet;
}

// ── Category management ─────────────────────────────────────
function openCategorySheet({ onDone }) {
  const ws = activeWorkspace();
  let type = 'expense';

  const body = h('<div></div>');
  openSheet({ title: 'Categories', body, size: 'full' });

  function draw() {
    const cats = categoriesFor(type, ws);
    body.innerHTML = `
      <div class="segmented" id="c-type">
        <button data-t="expense" aria-selected="${type === 'expense'}">Money out</button>
        <button data-t="income" aria-selected="${type === 'income'}">Money in</button>
      </div>
      <div class="card" style="margin-top:12px"><div class="rows">
        ${cats.map(c => `
          <div class="row">
            <div class="row-icon">${esc(c.icon)}</div>
            <div class="row-body"><div class="row-title">${esc(c.name)}</div>
              <div class="row-sub">${state.records.filter(r => r.ws === ws.id && r.category === c.name).length} records</div></div>
            <button class="icon-btn" data-remove="${esc(c.name)}" type="button" aria-label="Remove ${esc(c.name)}">✕</button>
          </div>`).join('')}
      </div></div>
      <form class="field-pair" id="c-add" style="margin-top:14px;align-items:end">
        <div class="field" style="margin:0">
          <label for="c-name">Add a category</label>
          <input class="input" id="c-name" type="text" placeholder="e.g. Childcare" autocomplete="off" />
        </div>
        <button class="btn btn-ghost" type="submit" style="min-height:48px">Add</button>
      </form>
      <div class="note">Removing a category leaves existing records alone — they keep the old name.</div>`;

    $('#c-type', body).addEventListener('click', e => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      type = b.dataset.t;
      draw();
    });

    $('#c-add', body).addEventListener('submit', async e => {
      e.preventDefault();
      const name = $('#c-name', body).value.trim();
      if (!name) return;
      const ok = await addCategory(type, name);
      if (!ok) { toast('That one already exists'); return; }
      onDone?.();
      draw();
    });
  }

  // Bound once — draw() replaces body's children, not body itself.
  body.addEventListener('click', async e => {
    const name = e.target.closest('[data-remove]')?.dataset.remove;
    if (!name) return;
    await removeCategory(type, name);
    onDone?.();
    draw();
  });

  draw();
}

// ── Data in / out ───────────────────────────────────────────
function doExportCSV() {
  const ws = activeWorkspace();
  const rows = workspaceRecords();
  if (!rows.length) { toast('Nothing to export yet'); return; }
  const name = `${ws.name.replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadBlob(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), name);
  toast(`Exported ${rows.length} records`);
}

async function doBackup() {
  const data = await exportBackup();
  const name = `expense-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
  toast('Backup saved — receipt images stay on this device');
}

export async function doRestore(file, { onDone }) {
  try {
    const data = JSON.parse(await file.text());
    const added = await importBackup(data);
    onDone?.();
    toast(added ? `Restored ${added} records` : 'Nothing new in that backup');
  } catch (err) {
    toast(err.message || 'That file could not be read', { tone: 'danger' });
  }
}

/** Quick workspace switcher opened from the app bar. */
export function openWorkspaceSwitcher({ onDone }) {
  const cur = activeWorkspace();
  const body = h(`<div>
    <div class="card"><div class="rows">
      ${state.workspaces.map(w => {
        const recs = state.records.filter(r => r.ws === w.id);
        const spent = recs.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
        return `<button class="ws-row row" data-ws="${esc(w.id)}" type="button">
          <div class="row-icon" style="background:${esc(w.accent)}22">${esc(w.icon || '📁')}</div>
          <div class="row-body">
            <div class="row-title">${esc(w.name)}</div>
            <div class="row-sub">${recs.length} records · ${esc(fmtMoney(spent, w.currency, { compact: true }))} out</div>
          </div>
          ${w.id === cur.id ? '<span class="tick">✓</span>' : ''}
        </button>`;
      }).join('')}
      <button class="row" data-new="1" type="button">
        <div class="row-icon" style="background:var(--accent-soft)">＋</div>
        <div class="row-body"><div class="row-title">New workspace</div></div>
      </button>
    </div></div>
  </div>`);

  const sheet = openSheet({ title: 'Switch workspace', body });

  body.addEventListener('click', async e => {
    if (e.target.closest('[data-new]')) {
      sheet.close();
      setTimeout(() => openWorkspaceSheet({ onDone }), 220);
      return;
    }
    const id = e.target.closest('[data-ws]')?.dataset.ws;
    if (!id) return;
    await setActiveWorkspace(id);
    haptic();
    sheet.close();
    onDone?.();
  });
}
