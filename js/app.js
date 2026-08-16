'use strict';

import { $, $$, debounce, haptic, toast, today } from './util.js';
import { init, state, activeWorkspace, saveSettings } from './store.js';
import { renderHome } from './views/home.js';
import { renderRecords } from './views/records.js';
import { renderInsights } from './views/insights.js';
import { renderMore, wireMore, openWorkspaceSheet, openWorkspaceSwitcher, doRestore } from './views/more.js';
import { openDetail } from './views/form.js';
import { handleFile, openCaptureMenu } from './views/capture.js';
import { fileFromPasteEvent, pasteReceipt } from './clipboard.js';
import { periodLabel } from './views/shared.js';
import { toCSV, downloadBlob } from './csv.js';

const ui = {
  tab: 'home',
  period: 'month',
  filters: { query: '', type: '', category: '', mode: 'list', calMonth: today().slice(0, 7), calDay: null },
};

const view = $('#view');
const inputs = {
  file: $('#file-input'),
  camera: $('#camera-input'),
  restore: $('#restore-input'),
};

// ── Chrome (app bar, accent, theme, tabs) ───────────────────
function refreshChrome() {
  const ws = activeWorkspace();
  $('#ws-icon').textContent = ws.icon || '📁';
  $('#ws-name').textContent = ws.name;
  $('#ws-sub').textContent = ui.tab === 'home' ? periodLabel(ui.period) : ws.currency;

  document.documentElement.style.setProperty('--accent', ws.accent);
  document.documentElement.style.setProperty('--accent-text', ws.accent);
  document.documentElement.style.setProperty('--accent-soft', ws.accent + '1f');

  const theme = state.settings.theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);

  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#0b0f17' : ws.accent);

  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === ui.tab)));
}

// ── Rendering ───────────────────────────────────────────────
function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  if (ui.tab === 'home') view.innerHTML = renderHome({ period: ui.period });
  else if (ui.tab === 'records') view.innerHTML = renderRecords(ui.filters);
  else if (ui.tab === 'insights') view.innerHTML = renderInsights({ period: ui.period });
  else if (ui.tab === 'more') {
    view.innerHTML = renderMore();
    wireMore(view, { rerender: () => render(), refreshChrome });
  }
  refreshChrome();
  if (keepScroll) window.scrollTo(0, y);
  else window.scrollTo({ top: 0 });
}

function goTab(tab) {
  if (ui.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  ui.tab = tab;
  haptic();
  render();
}

const afterChange = () => render({ keepScroll: true });

// ── Global event wiring ─────────────────────────────────────
$('#tabbar').addEventListener('click', e => {
  const tab = e.target.closest('.tab')?.dataset.tab;
  if (tab) goTab(tab);
});

$('#fab-scan').addEventListener('click', () => {
  haptic();
  openCaptureMenu({ onDone: afterChange, inputs });
});

$('#ws-switch').addEventListener('click', () => {
  haptic();
  openWorkspaceSwitcher({ onDone: () => { refreshChrome(); render(); } });
});

$('#btn-settings').addEventListener('click', () => goTab('more'));

// Delegated handling for everything the views render.
view.addEventListener('click', e => {
  const t = e.target;

  const recordId = t.closest('[data-record]')?.dataset.record;
  if (recordId) { openDetail(recordId, { onChange: afterChange }); return; }

  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'camera') { haptic(); inputs.camera.click(); return; }
  if (act === 'file') { haptic(); inputs.file.click(); return; }
  if (act === 'paste') {
    haptic();
    pasteReceipt({ onFile: f => handleFile(f, { onDone: afterChange }) }).catch(() => {});
    return;
  }

  const goto = t.closest('[data-goto]')?.dataset.goto;
  if (goto) { goTab(goto); return; }

  const period = t.closest('[data-period]')?.dataset.period;
  if (period) { ui.period = period; haptic(); render({ keepScroll: true }); return; }

  const mode = t.closest('[data-mode]')?.dataset.mode;
  if (mode) { ui.filters.mode = mode; haptic(); render({ keepScroll: true }); return; }

  if (t.closest('#q-clear')) { ui.filters.query = ''; render({ keepScroll: true }); return; }

  const typeChip = t.closest('[data-type]');
  if (typeChip) {
    ui.filters.type = typeChip.dataset.type;
    ui.filters.category = '';
    haptic();
    render({ keepScroll: true });
    return;
  }

  const catChip = t.closest('[data-cat]');
  if (catChip) {
    ui.filters.category = ui.filters.category === catChip.dataset.cat ? '' : catChip.dataset.cat;
    haptic();
    render({ keepScroll: true });
    return;
  }

  const calStep = t.closest('[data-cal]')?.dataset.cal;
  if (calStep) {
    const [y, m] = ui.filters.calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(calStep), 1);
    ui.filters.calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    ui.filters.calDay = null;
    render({ keepScroll: true });
    return;
  }

  const day = t.closest('[data-day]')?.dataset.day;
  if (day) {
    ui.filters.calDay = ui.filters.calDay === day ? null : day;
    haptic();
    render({ keepScroll: true });
    return;
  }

  if (t.closest('#btn-export')) {
    const rows = state.records.filter(r => r.ws === state.settings.activeWs);
    if (!rows.length) { toast('Nothing to export yet'); return; }
    const ws = activeWorkspace();
    downloadBlob(
      new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }),
      `${ws.name.replace(/[^\w-]+/g, '-').toLowerCase()}-${today()}.csv`,
    );
    toast(`Exported ${rows.length} records`);
  }
});

const onSearch = debounce(v => { ui.filters.query = v; render({ keepScroll: true }); }, 220);
view.addEventListener('input', e => {
  if (e.target.id === 'q') onSearch(e.target.value);
});

// File inputs — one handler, whichever route the file came in by.
for (const el of [inputs.file, inputs.camera]) {
  el.addEventListener('change', function () {
    const file = this.files?.[0];
    this.value = '';                       // let the same file be picked twice
    if (file) handleFile(file, { onDone: afterChange });
  });
}
inputs.restore.addEventListener('change', function () {
  const file = this.files?.[0];
  this.value = '';
  if (file) doRestore(file, { onDone: () => { refreshChrome(); render(); } });
});

/**
 * A file handed over by the Android share sheet is left in a cache by the
 * service worker, because the share arrives as a POST that cannot render the
 * app itself. Collect it once, then tidy the URL.
 */
async function collectSharedFile() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState({}, '', './');
  try {
    const cache = await caches.open('shared-inbox');
    const res = await cache.match('./__shared-file');
    if (!res) return;
    await cache.delete('./__shared-file');
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-filename') || 'shared');
    handleFile(new File([blob], name, { type: blob.type }), { onDone: afterChange });
  } catch { /* nothing shared, or caches unavailable */ }
}

// Files opened with the app (desktop "Open with", Chrome file handlers).
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async launchParams => {
    if (!launchParams.files?.length) return;
    const file = await launchParams.files[0].getFile();
    handleFile(file, { onDone: afterChange });
  });
}

// Ctrl/Cmd+V anywhere drops a copied receipt straight in. Ignored while the
// user is typing into a field, and silent when the clipboard holds only text.
document.addEventListener('paste', async e => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  const file = await fileFromPasteEvent(e);
  if (!file) return;
  e.preventDefault();
  handleFile(file, { onDone: afterChange });
});

// Drag a receipt onto the window.
['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'drop') {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file, { onDone: afterChange });
  }
}));

window.addEventListener('scroll', () => {
  $('.app-bar').classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshChrome);

// ── Boot ────────────────────────────────────────────────────
(async function boot() {
  try {
    await init();
  } catch (err) {
    console.error(err);
    $('#boot').innerHTML = `<div class="empty"><span class="e">😕</span><b>Storage unavailable</b>
      <p>This browser blocked local storage, so records cannot be saved. Private browsing is the usual cause.</p></div>`;
    return;
  }

  $('.app-bar').hidden = false;
  view.hidden = false;
  $('#tabbar').hidden = false;
  render();

  const boot = $('#boot');
  boot.classList.add('out');
  setTimeout(() => boot.remove(), 320);

  if (!state.settings.onboarded) {
    setTimeout(() => openWorkspaceSheet({
      firstRun: true,
      onDone: () => { refreshChrome(); render(); },
    }), 400);
    state.settings.onboarded = true;
    await saveSettings();
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }

  collectSharedFile();
})();
