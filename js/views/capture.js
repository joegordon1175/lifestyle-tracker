'use strict';

import { esc, h, $, openSheet, toast, haptic, fmtMoney } from '../util.js';
import { activeWorkspace, categoriesFor, state, saveRecord } from '../store.js';
import { extractFromFile } from '../extract.js';
import { parseCSV, detectColumns, rowsToRecords } from '../csv.js';
import { openEditor } from './form.js';
import { pasteReceipt } from '../clipboard.js';

/**
 * The whole point of the app: hand it a file, get a record.
 * Images and PDFs go through OCR/parsing; CSVs go through the statement
 * importer. Either way the user only confirms — they never type from scratch.
 */
export async function handleFile(file, { onDone } = {}) {
  if (!file) return;

  const isCSV = /\.csv$/i.test(file.name || '') || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel';
  if (isCSV) return importStatement(file, { onDone });

  const looksSupported = file.type.startsWith('image/') || file.type === 'application/pdf' || /\.(pdf|jpe?g|png|heic|heif|webp)$/i.test(file.name || '');
  if (!looksSupported) {
    toast('Give it a photo, a PDF or a CSV statement', { tone: 'danger' });
    return;
  }

  const ws = activeWorkspace();
  const progress = openProgressSheet();

  try {
    const result = await extractFromFile(file, {
      dateOrder: state.settings.dateOrder,
      categories: categoriesFor('expense', ws),
      onProgress: p => progress.update(p),
    });

    progress.close();
    haptic([8, 30, 8]);

    const duplicate = findDuplicate(result, ws.id);
    openEditor({
      draft: {
        type: 'expense',
        amount: result.amount ?? '',
        currency: result.currency || ws.currency,
        category: result.category,
        merchant: result.merchant,
        date: result.date,
        ref: result.ref,
        tax: result.tax,
      },
      blobs: result.blobs,
      fileType: result.fileType,
      confidence: result.confidence,
      title: result.amount ? 'Check and save' : 'Almost there',
      onDone,
    });

    if (duplicate) {
      setTimeout(() => toast('Looks like you already saved this one', { duration: 6000 }), 500);
    } else if (!result.amount) {
      setTimeout(() => toast('Could not read a total — pop it in yourself', { duration: 5000 }), 400);
    }
  } catch (err) {
    progress.close();
    console.error(err);
    const offline = !navigator.onLine;
    openEditor({
      draft: { type: 'expense' },
      blobs: file.type.startsWith('image/') ? [file] : null,
      title: 'Add it manually',
      onDone,
    });
    toast(offline
      ? 'Reading receipts needs a connection the first time. Photo attached — fill in the rest.'
      : 'Could not read that one. Photo attached — fill in the rest.',
    { duration: 6000 });
  }
}

function findDuplicate(result, wsId) {
  if (!result.amount) return null;
  return state.records.find(r =>
    r.ws === wsId &&
    Math.abs(r.amount - result.amount) < 0.005 &&
    r.date === result.date &&
    (!result.merchant || !r.merchant || r.merchant.toLowerCase() === result.merchant.toLowerCase()));
}

// ── Progress sheet ──────────────────────────────────────────
function openProgressSheet() {
  const body = h(`<div class="progress-wrap">
    <div class="progress-mark">🧾</div>
    <div class="progress-label" id="p-label">Reading the receipt…</div>
    <div class="progress-hint" id="p-hint">This all happens on your phone</div>
    <div class="progress-track"><i id="p-bar" style="width:6%"></i></div>
  </div>`);

  const sheet = openSheet({ body, dismissable: false });
  const HINTS = {
    download: 'First scan downloads the reader — later ones are instant',
    prep: 'Sharpening the image',
    ocr: 'This all happens on your phone',
    parse: 'Finding the total, date and shop',
  };

  return {
    update({ stage, pct, label }) {
      $('#p-label', body).textContent = label || 'Working…';
      $('#p-hint', body).textContent = HINTS[stage] || '';
      const base = { download: 0, prep: 8, ocr: 20, parse: 96 }[stage] ?? 0;
      const span = { download: 18, prep: 12, ocr: 74, parse: 4 }[stage] ?? 10;
      $('#p-bar', body).style.width = Math.min(99, base + (pct / 100) * span) + '%';
    },
    close: sheet.close,
  };
}

// ── CSV statement import ────────────────────────────────────
async function importStatement(file, { onDone } = {}) {
  const ws = activeWorkspace();
  let detected;
  try {
    const rows = parseCSV(await file.text());
    detected = detectColumns(rows);
  } catch {
    toast('Could not read that CSV', { tone: 'danger' });
    return;
  }
  if (!detected || detected.map.date < 0) {
    toast('No date column found in that file', { tone: 'danger' });
    return;
  }

  const build = (sign) => rowsToRecords(detected, {
    dateOrder: state.settings.dateOrder,
    categories: { expense: categoriesFor('expense', ws), income: categoriesFor('income', ws) },
    signConvention: sign,
  });

  let sign = 'negative-is-expense';
  let { records: drafts, skipped } = build(sign);

  if (!drafts.length) {
    toast('No transactions found in that file', { tone: 'danger' });
    return;
  }

  const body = h(`<div>
    <p class="sheet-text">Found <b id="i-count">${drafts.length}</b> transactions in
      <b>${esc(file.name || 'the file')}</b>.${skipped ? ` <span id="i-skip">${skipped} rows skipped.</span>` : ''}</p>

    <div class="field" style="margin-top:16px">
      <span class="field-label">Amounts are shown as</span>
      <div class="segmented" id="i-sign">
        <button type="button" data-sign="negative-is-expense" aria-selected="true">−12.50 is spending</button>
        <button type="button" data-sign="positive-is-expense" aria-selected="false">12.50 is spending</button>
      </div>
    </div>

    <div class="card" style="margin-top:14px"><div class="rows" id="i-preview"></div></div>

    <div class="sheet-actions">
      <button class="btn btn-ghost" id="i-cancel" type="button">Cancel</button>
      <button class="btn btn-primary" id="i-go" type="button">Import</button>
    </div>
  </div>`);

  const sheet = openSheet({ title: 'Import statement', body, size: 'full' });

  const renderPreview = () => {
    $('#i-count', body).textContent = drafts.length;
    $('#i-preview', body).innerHTML = drafts.slice(0, 6).map(d => `
      <div class="row">
        <div class="row-icon ${d.type === 'income' ? 'in' : 'out'}">${d.type === 'income' ? '↑' : '↓'}</div>
        <div class="row-body">
          <div class="row-title">${esc(d.merchant || d.category)}</div>
          <div class="row-sub">${esc(d.date)} · ${esc(d.category)}</div>
        </div>
        <div class="row-end"><div class="row-amount ${d.type === 'income' ? 'in' : 'out'}">${esc(fmtMoney(d.amount, ws.currency, { sign: true }).replace('+', d.type === 'income' ? '+' : '−'))}</div></div>
      </div>`).join('') +
      (drafts.length > 6 ? `<div class="row"><div class="row-body"><div class="row-sub">+ ${drafts.length - 6} more…</div></div></div>` : '');
  };
  renderPreview();

  $('#i-sign', body).addEventListener('click', e => {
    const btn = e.target.closest('[data-sign]');
    if (!btn) return;
    sign = btn.dataset.sign;
    [...$('#i-sign', body).children].forEach(b => b.setAttribute('aria-selected', String(b === btn)));
    ({ records: drafts, skipped } = build(sign));
    renderPreview();
  });

  $('#i-cancel', body).addEventListener('click', sheet.close);
  $('#i-go', body).addEventListener('click', async () => {
    const btn = $('#i-go', body);
    btn.disabled = true;
    btn.textContent = 'Importing…';

    let added = 0, dupes = 0;
    for (const d of drafts) {
      const dupe = state.records.some(r => r.ws === ws.id && r.date === d.date
        && Math.abs(r.amount - d.amount) < 0.005 && r.merchant === d.merchant);
      if (dupe) { dupes++; continue; }
      await saveRecord({ ...d, ws: ws.id, currency: ws.currency });
      added++;
    }
    sheet.close();
    haptic([10, 40, 14]);
    onDone?.();
    toast(`Imported ${added} transaction${added === 1 ? '' : 's'}${dupes ? ` · skipped ${dupes} duplicate${dupes === 1 ? '' : 's'}` : ''}`);
  });
}

/** Small chooser shown by the centre button: camera, file, or type it in. */
export function openCaptureMenu({ onDone, inputs }) {
  const body = h(`<div>
    <div class="card"><div class="rows">
      <button class="row" data-act="camera" type="button">
        <div class="row-icon" style="background:var(--accent-soft)">📷</div>
        <div class="row-body">
          <div class="row-title">Take a photo</div>
          <div class="row-sub">Snap the receipt — the details fill themselves in</div>
        </div>
      </button>
      <button class="row" data-act="file" type="button">
        <div class="row-icon">📁</div>
        <div class="row-body">
          <div class="row-title">Upload a file</div>
          <div class="row-sub">Photo, PDF invoice, or a CSV bank statement</div>
        </div>
      </button>
      <button class="row" data-act="paste" type="button">
        <div class="row-icon">📋</div>
        <div class="row-body">
          <div class="row-title">Paste from clipboard</div>
          <div class="row-sub">Copied out of an email or a screenshot</div>
        </div>
      </button>
      <button class="row" data-act="manual" type="button">
        <div class="row-icon">✏️</div>
        <div class="row-body">
          <div class="row-title">Type it in</div>
          <div class="row-sub">No receipt handy</div>
        </div>
      </button>
    </div></div>
  </div>`);

  const sheet = openSheet({ title: 'Add an expense', body });

  body.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    haptic();

    // Reading the clipboard must start inside this gesture, so kick it off
    // before closing the sheet rather than after an animation delay.
    if (act === 'paste') {
      const paste = pasteReceipt({ onFile: file => handleFile(file, { onDone }) });
      sheet.close();
      paste.catch(() => {});
      return;
    }

    sheet.close();
    if (act === 'camera') inputs.camera.click();
    else if (act === 'file') inputs.file.click();
    else setTimeout(() => openEditor({ onDone }), 220);
  });
}
