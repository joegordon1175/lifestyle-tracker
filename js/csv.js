'use strict';

import { today, pad, titleCase } from './util.js';
import { guessCategory } from './extract.js';

/**
 * Bank / card statement import. Columns are detected by header name and, where
 * headers are useless, by looking at what the values actually are.
 */

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const DATE_HEADERS = /^(date|transaction\s*date|posted?\s*date|value\s*date|when|day)$/i;
const AMOUNT_HEADERS = /^(amount|value|transaction\s*amount|amt|total)$/i;
const DEBIT_HEADERS = /^(debit|withdrawal|money\s*out|paid\s*out|spent|outgoing)$/i;
const CREDIT_HEADERS = /^(credit|deposit|money\s*in|paid\s*in|received|incoming)$/i;
const DESC_HEADERS = /^(description|details?|narrative|memo|reference|payee|merchant|name|particulars|transaction|other\s*party)$/i;

function looksLikeDate(s) {
  return /^\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\s*$/.test(s || '');
}
function looksLikeAmount(s) {
  return /^\s*-?[($]?\s*-?\d{1,3}(,\d{3})*(\.\d+)?\s*\)?\s*$/.test(s || '') && /\d/.test(s || '');
}

function toISO(s, dateOrder = 'dmy') {
  const v = String(s || '').trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    let y = Number(m[3]); if (y < 100) y += 2000;
    if (mo) return `${y}-${pad(mo)}-${pad(Number(m[1]))}`;
  }
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    if (y < 100) y += 2000;
    let d, mo;
    if (a > 12) { d = a; mo = b; }
    else if (b > 12) { d = b; mo = a; }
    else if (dateOrder === 'mdy') { mo = a; d = b; }
    else { d = a; mo = b; }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

function toAmount(s) {
  let v = String(s || '').trim();
  if (!v) return null;
  const negParens = /^\(.*\)$/.test(v);
  v = v.replace(/[()$£€¥₹,\s]/g, '');
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return negParens ? -Math.abs(n) : n;
}

/** Work out which column is which. Returns a mapping plus a preview of rows. */
export function detectColumns(rows) {
  if (!rows.length) return null;
  const header = rows[0].map(c => c.trim());
  const looksHeaderish = header.some(c => DATE_HEADERS.test(c) || AMOUNT_HEADERS.test(c) || DESC_HEADERS.test(c)
    || DEBIT_HEADERS.test(c) || CREDIT_HEADERS.test(c));
  const body = looksHeaderish ? rows.slice(1) : rows;
  if (!body.length) return null;

  const map = { date: -1, amount: -1, debit: -1, credit: -1, desc: -1 };

  if (looksHeaderish) {
    header.forEach((c, i) => {
      if (map.date < 0 && DATE_HEADERS.test(c)) map.date = i;
      else if (map.debit < 0 && DEBIT_HEADERS.test(c)) map.debit = i;
      else if (map.credit < 0 && CREDIT_HEADERS.test(c)) map.credit = i;
      else if (map.amount < 0 && AMOUNT_HEADERS.test(c)) map.amount = i;
      else if (map.desc < 0 && DESC_HEADERS.test(c)) map.desc = i;
    });
  }

  // Fill any gaps by inspecting the data itself.
  const cols = body[0].length;
  const sample = body.slice(0, 25);
  const scoreCol = test => {
    const scores = [];
    for (let i = 0; i < cols; i++) {
      scores.push(sample.filter(r => test(r[i])).length);
    }
    return scores;
  };
  if (map.date < 0) {
    const s = scoreCol(looksLikeDate);
    const best = s.indexOf(Math.max(...s));
    if (s[best] > sample.length * 0.6) map.date = best;
  }
  if (map.amount < 0 && map.debit < 0 && map.credit < 0) {
    const s = scoreCol(looksLikeAmount).map((v, i) => (i === map.date ? -1 : v));
    const best = s.indexOf(Math.max(...s));
    if (s[best] > sample.length * 0.6) map.amount = best;
  }
  if (map.desc < 0) {
    // Longest average text that isn't the date or amount column.
    let best = -1, bestLen = 0;
    for (let i = 0; i < cols; i++) {
      if (i === map.date || i === map.amount || i === map.debit || i === map.credit) continue;
      const len = sample.reduce((a, r) => a + String(r[i] || '').replace(/\d/g, '').trim().length, 0) / sample.length;
      if (len > bestLen) { bestLen = len; best = i; }
    }
    if (bestLen > 3) map.desc = best;
  }

  return { map, header: looksHeaderish ? header : null, body };
}

/**
 * Rows → draft records. `signConvention` controls how a single amount column
 * is read: 'negative-is-expense' (most banks) or 'positive-is-expense'.
 */
export function rowsToRecords(detected, {
  dateOrder = 'dmy',
  categories = { expense: [], income: [] },
  signConvention = 'negative-is-expense',
} = {}) {
  const { map, body } = detected;
  const out = [];
  let skipped = 0;

  for (const row of body) {
    const iso = map.date >= 0 ? toISO(row[map.date], dateOrder) : null;
    let desc = (map.desc >= 0 ? row[map.desc] : '').trim().replace(/\s{2,}/g, ' ');
    // Bank exports shout; sentence case is far easier to scan in a list.
    if (desc && desc === desc.toUpperCase() && /[A-Z]{3}/.test(desc)) desc = titleCase(desc);

    let amount = null, type = 'expense';
    if (map.debit >= 0 || map.credit >= 0) {
      const d = map.debit >= 0 ? toAmount(row[map.debit]) : null;
      const c = map.credit >= 0 ? toAmount(row[map.credit]) : null;
      if (d) { amount = Math.abs(d); type = 'expense'; }
      else if (c) { amount = Math.abs(c); type = 'income'; }
    } else if (map.amount >= 0) {
      const a = toAmount(row[map.amount]);
      if (a != null && a !== 0) {
        amount = Math.abs(a);
        const isExpense = signConvention === 'negative-is-expense' ? a < 0 : a > 0;
        type = isExpense ? 'expense' : 'income';
      }
    }

    if (!iso || amount == null) { skipped++; continue; }

    const cats = categories[type] || [];
    const guess = cats.length ? guessCategory(desc, desc, cats) : { value: 'Other', confidence: 0 };
    out.push({
      type,
      amount,
      date: iso,
      merchant: desc.slice(0, 60),
      description: '',
      category: guess.value,
      source: 'import',
      confidence: { category: guess.confidence },
    });
  }
  return { records: out, skipped };
}

export function toCSV(records, { categoryIcon } = {}) {
  const head = ['Date', 'Type', 'Amount', 'Currency', 'Category', 'Merchant', 'Description', 'Reference', 'Tax', 'Notes'];
  const cell = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = records
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => [r.date, r.type, r.amount.toFixed(2), r.currency, r.category,
      r.merchant, r.description, r.ref, r.tax ?? '', r.notes].map(cell).join(','));
  return [head.join(','), ...rows].join('\n');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { toISO as csvDateToISO, toAmount as csvAmount, today };
