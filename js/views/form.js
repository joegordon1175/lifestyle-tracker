'use strict';

import {
  esc, h, $, $$, openSheet, toast, haptic, fmtMoney, today, addMonths, confirmSheet,
} from '../util.js';
import {
  activeWorkspace, categoriesFor, saveRecord, saveFile, deleteRecord, getFileURL, state,
  recordFileIds,
} from '../store.js';
import { saveReceiptPdf } from '../export.js';

/**
 * The single editor used for everything that writes a record: manual entry,
 * editing an existing one, and confirming a scan. Scans arrive with `draft`
 * pre-filled and `confidence` set, which is all that changes about the UI.
 */
export function openEditor({
  record = null,
  draft = null,
  blobs = null,
  fileType = 'image',
  confidence = null,
  title,
  onDone,
} = {}) {
  const ws = activeWorkspace();
  const isEdit = !!record;
  const src = record || draft || {};

  const model = {
    id: record?.id || null,
    type: src.type || 'expense',
    amount: src.amount ?? '',
    currency: src.currency || ws.currency,
    category: src.category || '',
    merchant: src.merchant || '',
    description: src.description || '',
    date: src.date || today(),
    ref: src.ref || '',
    tax: src.tax ?? '',
    notes: src.notes || '',
    recurring: src.recurring || null,
    fileIds: recordFileIds(record),
  };

  // Make sure the category exists in this workspace, otherwise fall back.
  const validate = () => {
    const names = categoriesFor(model.type, ws).map(c => c.name);
    if (!names.includes(model.category)) model.category = names[names.length - 1] || '';
  };
  validate();

  const conf = confidence || {};
  const flag = (key) => {
    if (!conf[key] && conf[key] !== 0) return '';
    if (conf[key] >= 0.7) return '<span class="auto-flag">auto</span>';
    if (conf[key] > 0) return '<span class="auto-flag low">check</span>';
    return '<span class="auto-flag low">guess</span>';
  };

  const body = h(`<form class="editor" novalidate>
    <div class="photo-slot"></div>

    <div class="field">
      <div class="type-toggle">
        <label>
          <input type="radio" name="type" value="expense" ${model.type === 'expense' ? 'checked' : ''} />
          <span>↓ Money out</span>
        </label>
        <label>
          <input type="radio" name="type" value="income" ${model.type === 'income' ? 'checked' : ''} />
          <span>↑ Money in</span>
        </label>
      </div>
    </div>

    <div class="field">
      <span class="field-label">Amount ${flag('amount')}<span id="cur-flag"></span></span>
      <div class="amount-field">
        <span class="amount-cur" id="cur-sym"></span>
        <input id="f-amount" type="text" inputmode="decimal" placeholder="0.00"
               value="${model.amount === '' ? '' : esc(Number(model.amount).toFixed(2))}"
               autocomplete="off" enterkeyhint="done" />
      </div>
    </div>

    <div class="field">
      <span class="field-label">Category ${flag('category')}</span>
      <div class="cat-grid" id="cat-grid"></div>
    </div>

    <div class="field-pair">
      <div class="field">
        <label for="f-date">Date ${flag('date')}</label>
        <input class="input" id="f-date" type="date" value="${esc(model.date)}" />
      </div>
      <div class="field">
        <label for="f-merchant">Who ${flag('merchant')}</label>
        <input class="input" id="f-merchant" type="text" placeholder="Shop or payer"
               value="${esc(model.merchant)}" autocomplete="off" />
      </div>
    </div>

    <div class="field">
      <label for="f-desc">Note <span style="font-weight:500;text-transform:none">(optional)</span></label>
      <input class="input" id="f-desc" type="text" placeholder="What was it for?"
             value="${esc(model.description)}" autocomplete="off" />
    </div>

    <button type="button" class="btn btn-ghost btn-sm" id="more-toggle">More details ▾</button>

    <div id="more-fields" hidden style="margin-top:14px">
      <div class="field-pair">
        <div class="field">
          <label for="f-ref">Reference</label>
          <input class="input" id="f-ref" type="text" placeholder="INV-1234" value="${esc(model.ref)}" autocomplete="off" />
        </div>
        <div class="field">
          <label for="f-tax">Tax / GST</label>
          <input class="input" id="f-tax" type="text" inputmode="decimal" placeholder="0.00" value="${model.tax === '' || model.tax == null ? '' : esc(model.tax)}" />
        </div>
      </div>
      <div class="field">
        <label for="f-currency">Currency</label>
        <select class="input" id="f-currency"></select>
      </div>
      <div class="field">
        <label for="f-notes">Notes</label>
        <textarea class="input" id="f-notes" placeholder="Anything else worth remembering…">${esc(model.notes)}</textarea>
      </div>
      <div class="switch-row">
        <div class="switch-text">
          <b>Repeats</b>
          <small>Show it on the upcoming list</small>
        </div>
        <input type="checkbox" class="switch" id="f-recur" ${model.recurring ? 'checked' : ''} />
      </div>
      <div id="recur-fields" ${model.recurring ? '' : 'hidden'}>
        <div class="field-pair" style="margin-top:12px">
          <div class="field">
            <label for="f-recur-freq">How often</label>
            <select class="input" id="f-recur-freq">
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Yearly</option>
            </select>
          </div>
          <div class="field">
            <label for="f-recur-next">Next due</label>
            <input class="input" id="f-recur-next" type="date" value="${esc(model.recurring?.next || '')}" />
          </div>
        </div>
      </div>
    </div>

    <div class="sheet-actions">
      ${isEdit
        ? '<button type="button" class="btn btn-ghost" id="btn-delete">Delete</button>'
        : '<button type="button" class="btn btn-ghost" id="btn-cancel">Cancel</button>'}
      <button type="submit" class="btn btn-primary" id="btn-save">${isEdit ? 'Save changes' : 'Save'}</button>
    </div>
  </form>`);

  const sheet = openSheet({
    title: title || (isEdit ? 'Edit record' : 'New record'),
    body,
    size: 'full',
  });

  // ── Currency select ──
  const CURRENCIES = ['NZD', 'AUD', 'USD', 'GBP', 'EUR', 'CAD', 'SGD', 'JPY', 'INR', 'ZAR', 'CHF', 'HKD', 'THB', 'PHP'];
  const curSel = $('#f-currency', body);
  curSel.innerHTML = CURRENCIES.map(c => `<option value="${c}"${c === model.currency ? ' selected' : ''}>${c}</option>`).join('');
  const syncCurSymbol = () => {
    $('#cur-sym', body).textContent = fmtMoney(0, model.currency).replace(/[\d.,]/g, '').trim() || '$';
    // A record in a different currency to its workspace is nearly always a
    // misread, so say so here rather than let it surface in the list later.
    $('#cur-flag', body).innerHTML = model.currency === ws.currency ? ''
      : `<span class="auto-flag low">${esc(model.currency)}, not ${esc(ws.currency)}</span>`;
  };
  syncCurSymbol();
  curSel.addEventListener('change', () => { model.currency = curSel.value; syncCurSymbol(); });

  // ── Photo preview ──
  const slot = $('.photo-slot', body);
  (async () => {
    const urls = blobs?.length
      ? blobs.map(b => URL.createObjectURL(b))
      : (await Promise.all(model.fileIds.map(getFileURL))).filter(Boolean);
    if (!urls.length) return;
    slot.innerHTML = `<div class="review-photo">
      <img src="${urls[0]}" alt="Attached receipt" />
      <button type="button" class="expand">${urls.length > 1 ? `View all ${urls.length} pages` : 'View full'}</button>
    </div>`;
    $('.expand', slot).addEventListener('click', () => {
      openSheet({
        title: urls.length > 1 ? `Receipt · ${urls.length} pages` : 'Receipt',
        body: urls.map(u => `<img class="detail-img" src="${u}" alt="Attached receipt" />`).join(''),
      });
    });
  })();

  // ── Category grid ──
  const grid = $('#cat-grid', body);
  function renderCats() {
    const cats = categoriesFor(model.type, ws);
    grid.innerHTML = cats.map(c => `
      <button type="button" class="cat-tile" data-cat="${esc(c.name)}"
              aria-pressed="${c.name === model.category}">
        <span class="e">${esc(c.icon)}</span>${esc(c.name)}
      </button>`).join('');
  }
  renderCats();

  grid.addEventListener('click', e => {
    const tile = e.target.closest('[data-cat]');
    if (!tile) return;
    model.category = tile.dataset.cat;
    haptic();
    $$('.cat-tile', grid).forEach(t => t.setAttribute('aria-pressed', String(t === tile)));
  });

  $$('[name=type]', body).forEach(r => r.addEventListener('change', () => {
    model.type = r.value;
    validate();
    renderCats();
    haptic();
  }));

  // ── More details ──
  $('#more-toggle', body).addEventListener('click', () => {
    const more = $('#more-fields', body);
    more.hidden = !more.hidden;
    $('#more-toggle', body).textContent = more.hidden ? 'More details ▾' : 'Fewer details ▴';
  });

  const recurBox = $('#f-recur', body);
  recurBox.addEventListener('change', () => {
    $('#recur-fields', body).hidden = !recurBox.checked;
    const next = $('#f-recur-next', body);
    if (recurBox.checked && !next.value) next.value = addMonths($('#f-date', body).value || today(), 1);
  });
  if (model.recurring?.freq) $('#f-recur-freq', body).value = model.recurring.freq;

  // ── Save ──
  body.addEventListener('submit', async e => {
    e.preventDefault();
    const amount = parseFloat(String($('#f-amount', body).value).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter an amount first', { tone: 'danger' });
      $('#f-amount', body).focus();
      return;
    }
    const btn = $('#btn-save', body);
    btn.disabled = true;

    let fileIds = model.fileIds;
    if (blobs?.length) {
      try { fileIds = await Promise.all(blobs.map(b => saveFile(b, 'receipt'))); }
      catch { toast('Saved, but the receipt image could not be stored'); }
    }

    const recurOn = recurBox.checked;
    const rec = await saveRecord({
      id: model.id,
      ws: ws.id,
      type: model.type,
      amount,
      currency: model.currency,
      category: model.category,
      merchant: $('#f-merchant', body).value.trim(),
      description: $('#f-desc', body).value.trim(),
      date: $('#f-date', body).value || today(),
      ref: $('#f-ref', body).value.trim(),
      tax: $('#f-tax', body).value ? parseFloat($('#f-tax', body).value) : null,
      notes: $('#f-notes', body).value.trim(),
      recurring: recurOn ? { freq: $('#f-recur-freq', body).value, next: $('#f-recur-next', body).value || null } : null,
      fileIds,
      fileType: blobs?.length ? fileType : record?.fileType || null,
      source: record?.source || (blobs?.length ? 'scan' : 'manual'),
      confidence,
      createdAt: record?.createdAt,
    });

    haptic([10, 40, 14]);
    sheet.close();
    onDone?.(rec);

    if (!isEdit) {
      toast(`${rec.type === 'income' ? 'Added' : 'Recorded'} ${fmtMoney(rec.amount, rec.currency)} · ${rec.category}`, {
        action: 'Undo',
        onAction: async () => { await deleteRecord(rec.id); onDone?.(null); toast('Removed'); },
      });
    } else {
      toast('Changes saved');
    }
  });

  $('#btn-cancel', body)?.addEventListener('click', () => sheet.close());
  $('#btn-delete', body)?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Delete this record?',
      message: 'It will be removed from this workspace along with any attached receipt.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteRecord(model.id);
    sheet.close();
    onDone?.(null);
    toast('Record deleted');
  });

  // A brand new manual record starts on the amount so the keypad is right there.
  if (!isEdit && !draft) setTimeout(() => $('#f-amount', body).focus(), 320);

  return sheet;
}

/** Read-only detail view with edit / delete actions. */
export async function openDetail(id, { onChange } = {}) {
  const rec = state.records.find(r => r.id === id);
  if (!rec) return;
  const ws = activeWorkspace();
  const fileIds = recordFileIds(rec);

  const rows = [
    ['Category', rec.category],
    ['Date', new Date(rec.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })],
    rec.merchant && ['Who', rec.merchant],
    rec.description && ['Note', rec.description],
    rec.ref && ['Reference', rec.ref],
    rec.tax != null && ['Tax / GST', fmtMoney(rec.tax, rec.currency)],
    rec.recurring && ['Repeats', `${rec.recurring.freq}${rec.recurring.next ? ' · next ' + rec.recurring.next : ''}`],
    rec.notes && ['Notes', rec.notes],
    ['Added', `${new Date(rec.createdAt).toLocaleDateString()} · ${rec.source}`],
  ].filter(Boolean);

  const body = h(`<div>
    <div class="photo-slot"></div>
    <div class="detail-amount">
      <div class="v ${rec.type === 'income' ? 'in' : ''}">${esc(fmtMoney(rec.amount, rec.currency))}</div>
      <div class="c">${rec.type === 'income' ? 'Money in' : 'Money out'} · ${esc(ws.name)}</div>
    </div>
    <dl class="detail-list">
      ${rows.map(([k, v]) => `<div class="detail-item"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
    </dl>
    ${fileIds.length ? '<button class="btn btn-outline btn-sm" id="d-pdf" type="button" style="margin-top:16px">⬇︎ Save receipt as PDF</button>' : ''}
    <div class="sheet-actions">
      <button class="btn btn-ghost" id="d-del" type="button">Delete</button>
      <button class="btn btn-primary" id="d-edit" type="button">Edit</button>
    </div>
  </div>`);

  const sheet = openSheet({ title: rec.merchant || rec.category, body });

  if (fileIds.length) {
    const urls = (await Promise.all(fileIds.map(getFileURL))).filter(Boolean);
    $('.photo-slot', body).innerHTML = urls
      .map(u => `<img class="detail-img" src="${u}" alt="Attached receipt" />`).join('');
    $('#d-pdf', body).addEventListener('click', () => saveReceiptPdf(rec));
  }

  $('#d-edit', body).addEventListener('click', () => {
    sheet.close();
    openEditor({ record: rec, title: 'Edit record', onDone: onChange });
  });
  $('#d-del', body).addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Delete this record?',
      message: `${fmtMoney(rec.amount, rec.currency)} · ${rec.category}`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteRecord(id);
    sheet.close();
    onChange?.(null);
    toast('Record deleted');
  });
}
