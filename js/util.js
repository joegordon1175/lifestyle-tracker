'use strict';

// ── Escaping ────────────────────────────────────────────────
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── Dates ───────────────────────────────────────────────────
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function pad(n) { return String(n).padStart(2, '0'); }

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d, lastDay));
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
export function monthKey(iso) { return iso.slice(0, 7); }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtDate(iso, style = 'short') {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (style === 'long') return `${Number(d)} ${MONTHS_LONG[Number(m) - 1]} ${y}`;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
export function fmtMonth(key) {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** "Today" / "Yesterday" / "3 Mar 2026" — used for list grouping headers. */
export function fmtDayLabel(iso) {
  const t = today();
  if (iso === t) return 'Today';
  if (iso === addDays(t, -1)) return 'Yesterday';
  if (iso === addDays(t, 1)) return 'Tomorrow';
  return fmtDate(iso);
}

export function relativeDays(iso) {
  const t = today();
  const ms = new Date(iso + 'T00:00') - new Date(t + 'T00:00');
  return Math.round(ms / 86400000);
}

// ── Money ───────────────────────────────────────────────────
const SYMBOLS = {
  NZD: '$', AUD: '$', USD: '$', CAD: '$', SGD: '$', HKD: '$',
  GBP: '£', EUR: '€', JPY: '¥', CNY: '¥', INR: '₹', ZAR: 'R',
  CHF: 'CHF ', SEK: 'kr ', NOK: 'kr ', DKK: 'kr ', PHP: '₱', THB: '฿',
};
export function currencySymbol(code) { return SYMBOLS[code] || (code ? code + ' ' : '$'); }

export function fmtMoney(n, currency = 'NZD', opts = {}) {
  const { sign = false, compact = false } = opts;
  const v = Math.abs(Number(n) || 0);
  let body;
  if (compact && v >= 10000) {
    body = (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  } else {
    body = v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const prefix = sign ? (Number(n) < 0 ? '−' : '+') : (Number(n) < 0 ? '−' : '');
  return prefix + currencySymbol(currency) + body;
}

// ── Misc ────────────────────────────────────────────────────
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function haptic(pattern = 8) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
}

/** Title case, but short all-caps tokens stay shouty — "AA", "BP", "NZ". */
export function titleCase(s) {
  return String(s || '').split(/(\s+)/).map(tok => {
    if (/^[A-Z0-9&]{1,2}$/.test(tok)) return tok;
    return tok.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  }).join('');
}

// ── DOM helpers ─────────────────────────────────────────────
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

// ── Toast ───────────────────────────────────────────────────
let toastTimer;
export function toast(message, { action, onAction, duration = 4000, tone = 'default' } = {}) {
  const host = $('#toast-host');
  if (!host) return;
  host.innerHTML = '';
  const el = h(`
    <div class="toast toast-${esc(tone)}" role="status">
      <span class="toast-msg">${esc(message)}</span>
      ${action ? `<button class="toast-action" type="button">${esc(action)}</button>` : ''}
    </div>`);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));

  const dismiss = () => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 220);
  };
  if (action) {
    $('.toast-action', el).addEventListener('click', () => { dismiss(); onAction?.(); });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(dismiss, duration);
  return dismiss;
}

// ── Bottom sheet ────────────────────────────────────────────
/**
 * Opens a bottom sheet. `body` may be an HTML string or an element.
 * Returns { el, close } — `close` also fires the optional onClose callback.
 */
export function openSheet({ title, body, size = 'auto', onClose, dismissable = true } = {}) {
  const host = $('#sheet-host');
  const wrap = h(`
    <div class="sheet-wrap" role="dialog" aria-modal="true">
      <div class="sheet-backdrop"></div>
      <div class="sheet sheet-${esc(size)}">
        <div class="sheet-grip"></div>
        ${title ? `<div class="sheet-head"><h2 class="sheet-title">${esc(title)}</h2>
          ${dismissable ? '<button class="icon-btn sheet-x" type="button" aria-label="Close">✕</button>' : ''}</div>` : ''}
        <div class="sheet-body"></div>
      </div>
    </div>`);

  const bodyEl = $('.sheet-body', wrap);
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  host.appendChild(wrap);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => wrap.classList.add('in'));

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('in');
    setTimeout(() => {
      wrap.remove();
      if (!$('.sheet-wrap', host)) document.body.classList.remove('no-scroll');
    }, 240);
    onClose?.();
  };

  if (dismissable) {
    $('.sheet-backdrop', wrap).addEventListener('click', close);
    $('.sheet-x', wrap)?.addEventListener('click', close);
    // Swipe-down-to-dismiss on the grip / header area.
    const sheet = $('.sheet', wrap);
    let startY = null, dy = 0;
    const onStart = e => {
      if (sheet.scrollTop > 0) return;
      startY = e.touches[0].clientY; dy = 0;
      sheet.style.transition = 'none';
    };
    const onMove = e => {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = () => {
      if (startY === null) return;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 110) close();
      startY = null;
    };
    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: true });
    sheet.addEventListener('touchend', onEnd);
  }

  const onKey = e => { if (e.key === 'Escape' && dismissable) { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  return { el: wrap, body: bodyEl, close };
}

/** Promise-based confirm dialog styled as a sheet. */
export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const sheet = openSheet({
      title,
      body: `
        <p class="sheet-text">${esc(message)}</p>
        <div class="sheet-actions">
          <button class="btn btn-ghost" data-act="cancel" type="button">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(confirmLabel)}</button>
        </div>`,
      onClose: () => { if (!done) resolve(false); },
    });
    sheet.body.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      done = true;
      resolve(act === 'ok');
      sheet.close();
    });
  });
}
