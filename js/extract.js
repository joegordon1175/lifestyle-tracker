'use strict';

import { today, pad, titleCase } from './util.js';
import { GLOBAL_HINTS } from './presets.js';

/**
 * Turns a photo or file into a filled-in transaction.
 *
 *   file → (downscale + clean up) → text → parse → { amount, date, merchant, … }
 *
 * Text comes from a PDF's own text layer when there is one, otherwise from
 * on-device OCR (Tesseract.js, lazily fetched the first time it's needed and
 * then cached by the service worker). Nothing is uploaded anywhere.
 */

const TESS_VER = '5.1.1';
const PDFJS_VER = '4.6.82';

// The recognition engine is fetched on first use and then cached by the service
// worker. Two hosts are tried so one CDN being unreachable is not fatal.
const CDNS = ['https://cdn.jsdelivr.net/npm', 'https://unpkg.com'];
let CDN = CDNS[0];

// ── Image preparation ───────────────────────────────────────
/** Downscale for storage: long edge ≤ 1600px, JPEG. Keeps the DB small. */
export async function prepareImage(file, maxEdge = 1600, quality = 0.82) {
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  return blob || file;
}

/** Grayscale + contrast stretch. Receipt OCR accuracy improves a lot with this. */
async function prepareForOCR(blob, maxEdge = 2000) {
  const bmp = await loadBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // Pass 1: grayscale + histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    hist[g]++;
  }
  // Pass 2: stretch between the 5th and 95th percentile
  const total = w * h;
  let acc = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.05) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.05) { hi = i; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) / range) * 255));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

// ── Text extraction ─────────────────────────────────────────
let ocrWorker = null;
let ocrLoading = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load the text-recognition engine.'));
    document.head.appendChild(s);
  });
}

async function getOCRWorker(onProgress) {
  if (ocrWorker) return ocrWorker;
  if (!ocrLoading) {
    ocrLoading = (async () => {
      if (!window.Tesseract) {
        onProgress?.({ stage: 'download', pct: 0, label: 'Getting the reader ready…' });
        let lastErr;
        for (const host of CDNS) {
          try {
            await loadScript(`${host}/tesseract.js@${TESS_VER}/dist/tesseract.min.js`);
            CDN = host;
            lastErr = null;
            break;
          } catch (e) { lastErr = e; }
        }
        if (lastErr || !window.Tesseract) throw lastErr || new Error('Text recognition is unavailable.');
      }
      const worker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: `${CDN}/tesseract.js@${TESS_VER}/dist/worker.min.js`,
        corePath: `${CDN}/tesseract.js-core@${TESS_VER}`,
        logger: m => {
          if (m.status === 'recognizing text') {
            onProgress?.({ stage: 'ocr', pct: Math.round(m.progress * 100), label: 'Reading the receipt…' });
          } else if (m.status?.includes('loading') || m.status?.includes('initializ')) {
            onProgress?.({ stage: 'download', pct: Math.round((m.progress || 0) * 100), label: 'Getting the reader ready…' });
          }
        },
      });
      ocrWorker = worker;
      return worker;
    })().catch(err => {
      ocrLoading = null;          // let the next scan try again
      throw err;
    });
  }
  return ocrLoading;
}

async function ocrImage(blob, onProgress) {
  const worker = await getOCRWorker(onProgress);
  const cleaned = await prepareForOCR(blob);
  const { data } = await worker.recognize(cleaned);
  return data.text || '';
}

async function pdfText(file, onProgress) {
  onProgress?.({ stage: 'download', pct: 0, label: 'Opening the PDF…' });
  let pdfjs, host, lastErr;
  for (const candidate of CDNS) {
    try {
      pdfjs = await import(/* @vite-ignore */ `${candidate}/pdfjs-dist@${PDFJS_VER}/build/pdf.min.mjs`);
      host = candidate;
      lastErr = null;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!pdfjs) throw lastErr || new Error('Could not open PDFs.');
  pdfjs.GlobalWorkerOptions.workerSrc = `${host}/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = Math.min(doc.numPages, 3);
  let text = '';
  for (let i = 1; i <= pages; i++) {
    onProgress?.({ stage: 'ocr', pct: Math.round((i / pages) * 100), label: 'Reading the invoice…' });
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from item positions so "Total ....  42.50" stays on one line.
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 4);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], s: item.str });
    }
    text += [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.s).join(' '))
      .join('\n') + '\n';
  }

  // Render each page to a JPEG. Keeping page images rather than the original
  // PDF makes every record exportable the same way a photographed receipt is,
  // and lets the app show a preview without loading a PDF viewer.
  const renders = [];
  for (let i = 1; i <= pages; i++) {
    renders.push(await renderPdfPage(doc, i));
  }

  // Scanned PDF with no text layer — OCR the first rendered page instead.
  if (text.replace(/\s/g, '').length < 24) {
    text = await ocrImage(renders[0], onProgress);
  }
  return { text, pageImages: renders };
}

async function renderPdfPage(doc, pageNumber, scale = 2) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';                    // PDFs render on transparent by default
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
}

// ── Parsing ─────────────────────────────────────────────────
const CURRENCY_CODES = ['NZD', 'AUD', 'USD', 'GBP', 'EUR', 'CAD', 'SGD', 'JPY', 'INR', 'ZAR', 'CHF', 'HKD', 'THB', 'PHP'];
const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// Lines that must never be mistaken for the payable total.
const NOT_TOTAL = /(sub\s?-?total|subtotal|total\s+(items?|qty|quantity|savings?|discount|units?)|change|cash\s+(out|tender)|rounding|balance\s+(forward|b\/f)|previous|opening|loyalty|points|gst\s+content|tax\s+content|excl)/i;
const TOTAL_STRONG = /(grand\s*total|amount\s*(due|payable|paid)|total\s*(due|payable|to\s*pay|incl|including|inc\s*gst|amount)|balance\s*due|to\s*pay|you\s*paid|order\s*total|invoice\s*total)/i;
const TOTAL_WEAK = /(^|\b)(total|eftpos|visa|mastercard|debit|credit|card|paid|payment|charged)(\b|$)/i;

const MONEY = /(?:[$£€¥₹]|\b(?:NZ|AU|US|CA|SG|HK)?\$)?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{2})?)/g;

/**
 * Handles both 1,234.56 and 1.234,56 — whichever separator comes last and is
 * followed by one or two digits is the decimal point; the rest is grouping.
 */
function toNumber(raw) {
  const s = String(raw).replace(/\s/g, '');
  const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let n;
  if (sep === -1) n = parseFloat(s);
  else {
    const decimals = s.length - sep - 1;
    if (decimals === 1 || decimals === 2) {
      n = parseFloat(s.slice(0, sep).replace(/[.,]/g, '') + '.' + s.slice(sep + 1));
    } else {
      n = parseFloat(s.replace(/[.,]/g, ''));   // separators are all grouping
    }
  }
  return Number.isFinite(n) ? n : null;
}

function moneyOnLine(line) {
  const out = [];
  MONEY.lastIndex = 0;
  let m;
  while ((m = MONEY.exec(line))) {
    const n = toNumber(m[1]);
    // Ignore bare integers with no decimals unless they carry a currency symbol —
    // they're usually quantities, phone numbers or item codes.
    const hasSymbol = /[$£€¥₹]/.test(m[0]);
    const hasCents = /[.,]\d{2}$/.test(m[1]);
    if (n == null || n <= 0 || n > 5_000_000) continue;
    if (!hasSymbol && !hasCents) continue;
    out.push({ value: n, index: m.index, symbol: hasSymbol });
  }
  return out;
}

/**
 * Only reports a currency the receipt genuinely states. OCR throws off stray
 * glyphs — a single misread € on a local rates notice used to be enough to
 * relabel the whole record — so a lone symbol is not treated as evidence.
 * Returning null leaves the workspace's own currency in charge.
 */
function detectCurrency(text) {
  const upper = text.toUpperCase();

  for (const code of CURRENCY_CODES) {
    const hits = (upper.match(new RegExp(`\\b${code}\\b`, 'g')) || []).length;
    if (!hits) continue;
    // Convincing if it sits against an amount ("EUR 24.50", "24.50 EUR")
    // or is stated more than once.
    const besideAmount = new RegExp(`(\\b${code}\\b[^0-9A-Z]{0,3}[0-9]|[0-9][^0-9A-Z]{0,3}\\b${code}\\b)`).test(upper);
    if (besideAmount || hits >= 2) return code;
  }

  for (const [symbol, code] of [['£', 'GBP'], ['€', 'EUR'], ['₹', 'INR'], ['¥', 'JPY']]) {
    const attached = (text.match(new RegExp(`${symbol}\\s?[0-9]`, 'g')) || []).length;
    if (attached >= 2) return code;
  }
  return null;
}

function findAmount(lines) {
  const candidates = [];
  lines.forEach((line, i) => {
    if (NOT_TOTAL.test(line)) return;
    const monies = moneyOnLine(line);
    if (!monies.length) return;
    const last = monies[monies.length - 1];
    let score = 0;
    if (TOTAL_STRONG.test(line)) score += 100;
    else if (TOTAL_WEAK.test(line)) score += 55;
    else score += 5;
    // Totals sit near the bottom of a receipt.
    score += Math.round((i / Math.max(1, lines.length - 1)) * 20);
    if (last.symbol) score += 8;
    if (monies.length === 1) score += 4;
    candidates.push({ value: last.value, score, line: line.trim() });
  });

  if (!candidates.length) return { value: null, confidence: 0 };
  candidates.sort((a, b) => b.score - a.score || b.value - a.value);

  const best = candidates[0];
  // If several lines tie on score, the largest value is the safer read.
  const tied = candidates.filter(c => c.score === best.score);
  const pick = tied.reduce((a, b) => (b.value > a.value ? b : a), best);

  let confidence = 0.35;
  if (TOTAL_STRONG.test(pick.line)) confidence = 0.95;
  else if (TOTAL_WEAK.test(pick.line)) confidence = 0.7;
  else if (candidates.length === 1) confidence = 0.5;
  return { value: pick.value, confidence, line: pick.line };
}

function findTax(lines) {
  for (const line of lines) {
    if (!/\b(gst|vat|sales\s*tax|tax)\b/i.test(line)) continue;
    if (/\b(no|zero|exempt|free)\b/i.test(line)) continue;
    // "Total incl GST $112.60" is the total, not the tax component.
    if (TOTAL_STRONG.test(line) || /\bincl(uding)?\b/i.test(line)) continue;
    const monies = moneyOnLine(line);
    if (monies.length) return monies[monies.length - 1].value;
  }
  return null;
}

function clampYear(y) {
  if (y < 100) y += y > 70 ? 1900 : 2000;
  return y;
}

function validDate(y, m, d) {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  // Reject anything implausible: far future, or older than ~6 years.
  const t = today();
  if (iso > addYearsISO(t, 1)) return null;
  if (iso < addYearsISO(t, -6)) return null;
  return iso;
}
function addYearsISO(iso, n) {
  const [y, m, d] = iso.split('-');
  return `${Number(y) + n}-${m}-${d}`;
}

function findDate(text, dateOrder = 'dmy') {
  const found = [];

  // 2026-03-04 / 2026.03.04
  for (const m of text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const iso = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) found.push({ iso, confidence: 0.95 });
  }
  // 4 Mar 2026 / 4th March 26
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]?([A-Za-z]{3,9})[\s,-]+(\d{2,4})\b/g)) {
    const mo = MONTH_NAMES[m[2].slice(0, 4).toLowerCase()] || MONTH_NAMES[m[2].slice(0, 3).toLowerCase()];
    const iso = validDate(clampYear(Number(m[3])), mo, Number(m[1]));
    if (iso) found.push({ iso, confidence: 0.95 });
  }
  // Mar 4, 2026
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})[\s.]+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{2,4})\b/g)) {
    const mo = MONTH_NAMES[m[1].slice(0, 4).toLowerCase()] || MONTH_NAMES[m[1].slice(0, 3).toLowerCase()];
    const iso = validDate(clampYear(Number(m[3])), mo, Number(m[2]));
    if (iso) found.push({ iso, confidence: 0.95 });
  }
  // 04/03/2026 — ambiguous, resolved by the day-first / month-first setting
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const a = Number(m[1]), b = Number(m[2]), y = clampYear(Number(m[3]));
    let iso, conf = 0.8;
    if (a > 12 && b <= 12) iso = validDate(y, b, a);              // must be d/m
    else if (b > 12 && a <= 12) iso = validDate(y, a, b);         // must be m/d
    else {
      iso = dateOrder === 'mdy' ? validDate(y, a, b) : validDate(y, b, a);
      conf = 0.65;                                                // genuinely ambiguous
    }
    if (iso) found.push({ iso, confidence: conf });
  }

  if (!found.length) return { value: today(), confidence: 0 };

  const t = today();
  const past = found.filter(f => f.iso <= t);
  const pool = past.length ? past : found;
  // Prefer the most confident read; break ties with the most recent date.
  pool.sort((a, b) => b.confidence - a.confidence || b.iso.localeCompare(a.iso));
  return { value: pool[0].iso, confidence: pool[0].confidence };
}

const MERCHANT_NOISE = /^(tax\s*invoice|invoice|receipt|customer\s*copy|merchant\s*copy|eftpos|gst\s*(no|number)|abn|nzbn|www\.|http|tel|ph\b|phone|fax|order|table|terminal|card|thank\s*you|welcome)/i;

function findMerchant(lines) {
  const head = lines.slice(0, 8);
  let best = null, bestScore = -Infinity;
  head.forEach((raw, i) => {
    const line = raw.trim();
    if (line.length < 3 || line.length > 42) return;
    if (MERCHANT_NOISE.test(line)) return;
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    const digits = (line.match(/\d/g) || []).length;
    if (letters < 3 || digits > letters) return;
    if (/^\d/.test(line)) return;                          // street address
    if (/\b(street|road|avenue|lane|drive|highway|po box)\b/i.test(line)) return;

    let score = letters - digits - i * 3;
    if (/^[A-Z0-9 &'.#\-]+$/.test(line) && letters > 3) score += 8;  // shouty header
    if (/\b(ltd|limited|inc|llc|pty|co\b|group|store|market|cafe|shop)\b/i.test(line)) score += 6;
    if (score > bestScore) { bestScore = score; best = line; }
  });
  if (!best) return { value: '', confidence: 0 };
  const clean = best.replace(/[*_|]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const value = /[a-z]/.test(clean) ? clean : titleCase(clean);
  return { value, confidence: bestScore > 10 ? 0.75 : 0.45 };
}

function findReference(text) {
  // Horizontal whitespace only — a reference never wraps onto the next line.
  const re = /\b(?:invoice|receipt|order|docket|inv|ref)\.?[^\S\n]*(?:no\.?|number|nbr)?[^\S\n]*[:#]?[^\S\n]*([A-Z0-9][A-Z0-9\-/]{2,19})\b/gi;
  for (const m of text.matchAll(re)) {
    const ref = m[1].replace(/[-/]$/, '');
    if (/\d/.test(ref) && !/^\d{1,2}$/.test(ref)) return ref;   // must look like an ID
  }
  return '';
}

/** Score every category in the workspace against the receipt text. */
export function guessCategory(text, merchant, categories) {
  const hay = (merchant + '\n' + text).toLowerCase();
  let best = null, bestScore = 0;

  for (const cat of categories) {
    let score = 0;
    for (const kw of cat.keywords || []) {
      if (!kw) continue;
      if (hay.includes(kw)) score += merchant.toLowerCase().includes(kw) ? 12 : 5;
    }
    // The category's own name showing up in the text is a weak signal.
    const first = cat.name.toLowerCase().split(/[\s&/]+/)[0];
    if (first.length > 3 && hay.includes(first)) score += 3;
    if (score > bestScore) { bestScore = score; best = cat; }
  }

  if (!best) {
    for (const hint of GLOBAL_HINTS) {
      if (!hint.match.some(k => hay.includes(k))) continue;
      const cat = categories.find(c => hint.want.includes(c.name));
      if (cat) return { value: cat.name, confidence: 0.6 };
    }
    return { value: categories[categories.length - 1]?.name || 'Other', confidence: 0 };
  }
  return { value: best.name, confidence: Math.min(0.95, 0.4 + bestScore / 25) };
}

/** Pure text → fields. Exported so it can be exercised without a real file. */
export function parseReceiptText(text, { dateOrder = 'dmy', categories = [] } = {}) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const amount = findAmount(lines);
  const date = findDate(text, dateOrder);
  const merchant = findMerchant(lines);
  const category = categories.length ? guessCategory(text, merchant.value, categories) : { value: '', confidence: 0 };

  return {
    amount: amount.value,
    date: date.value,
    merchant: merchant.value,
    category: category.value,
    currency: detectCurrency(text),
    tax: findTax(lines),
    ref: findReference(text),
    text,
    confidence: {
      amount: amount.confidence,
      date: date.confidence,
      merchant: merchant.confidence,
      category: category.confidence,
    },
  };
}

/**
 * Main entry point: a File from camera or file picker → parsed fields plus the
 * image blob to store alongside the record.
 */
export async function extractFromFile(file, { dateOrder = 'dmy', categories = [], onProgress } = {}) {
  const isPDF = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  let text = '', blobs = [], fileType = 'image';

  if (isPDF) {
    fileType = 'pdf';
    const res = await pdfText(file, onProgress);
    text = res.text;
    blobs = res.pageImages.filter(Boolean);
  } else {
    onProgress?.({ stage: 'prep', pct: 0, label: 'Preparing the image…' });
    blobs = [await prepareImage(file)];
    text = await ocrImage(blobs[0], onProgress);
  }

  onProgress?.({ stage: 'parse', pct: 100, label: 'Pulling out the details…' });
  const parsed = parseReceiptText(text, { dateOrder, categories });
  return { ...parsed, blobs, fileType };
}

export async function releaseOCR() {
  if (ocrWorker) { try { await ocrWorker.terminate(); } catch { /* ignore */ } }
  ocrWorker = null; ocrLoading = null;
}
