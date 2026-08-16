'use strict';

/**
 * A very small PDF writer — enough for receipt packs, with no dependencies.
 *
 * It only needs two things: Helvetica text (a standard font, so nothing to
 * embed) and JPEG images, which PDF can carry verbatim via the DCTDecode
 * filter. That means a stored receipt photo is copied into the document
 * byte-for-byte with no re-encoding and no quality loss.
 */

export const A4 = { w: 595.28, h: 841.89 };

// Helvetica / Helvetica-Bold advance widths (units per 1000) for ASCII 32–126.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** PDF text is ASCII here — emoji and accents would need an embedded font. */
export function sanitise(str) {
  return String(str ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[−]/g, '-')
    .replace(/ /g, ' ')
    // Separators the UI leans on. Without a mapping they would simply vanish
    // and run adjacent fields together ("Small Business This year").
    .replace(/[·•]/g, '-')
    .replace(/[×]/g, 'x')
    .replace(/…/g, '...')
    // Drop anything outside printable ASCII (emoji, CJK, …) rather than
    // emitting bytes the viewer would render as noise.
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function textWidth(str, size, bold = false) {
  const table = bold ? W_BOLD : W_REG;
  let total = 0;
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    total += (code >= 32 && code <= 126) ? table[code - 32] : 556;
  }
  return (total / 1000) * size;
}

/** Greedy word wrap; falls back to hard-breaking a single over-long word. */
export function wrap(str, size, maxWidth, bold = false) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (textWidth(candidate, size, bold) <= maxWidth) { line = candidate; continue; }
    if (line) lines.push(line);
    if (textWidth(word, size, bold) <= maxWidth) { line = word; continue; }
    let chunk = '';
    for (const ch of word) {
      if (textWidth(chunk + ch, size, bold) > maxWidth) { lines.push(chunk); chunk = ch; }
      else chunk += ch;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

function latin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function escapeText(str) {
  return str.replace(/[\\()]/g, c => '\\' + c);
}

export class PdfDoc {
  constructor({ width = A4.w, height = A4.h } = {}) {
    this.width = width;
    this.height = height;
    this.objects = [];        // each entry: array of string | Uint8Array
    this.pages = [];          // { ops: string[], images: Map<name, objNum> }
    this.images = new Map();  // dedupe key → { obj, w, h }
    this.page = null;
  }

  _addObject(parts) {
    this.objects.push(parts);
    return this.objects.length;   // object numbers are 1-based
  }

  addPage() {
    this.page = { ops: [], images: new Map() };
    this.pages.push(this.page);
    return this.page;
  }

  /** y is measured from the top of the page, which is easier to lay out with. */
  text(x, yTop, str, { size = 10, bold = false, color = [0, 0, 0], align = 'left', width = 0 } = {}) {
    const clean = sanitise(str);
    if (!clean) return;
    let tx = x;
    if (align === 'right') tx = x + width - textWidth(clean, size, bold);
    else if (align === 'center') tx = x + (width - textWidth(clean, size, bold)) / 2;
    const y = this.height - yTop - size;
    this.page.ops.push(
      'BT',
      `/${bold ? 'F2' : 'F1'} ${size} Tf`,
      `${color.map(n => n.toFixed(3)).join(' ')} rg`,
      `1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm`,
      `(${escapeText(clean)}) Tj`,
      'ET',
    );
  }

  /** Returns the y position just past the block, so callers can flow content. */
  paragraph(x, yTop, str, { size = 10, bold = false, color = [0, 0, 0], width = 400, leading = 1.35 } = {}) {
    const lines = wrap(sanitise(str), size, width, bold);
    let y = yTop;
    for (const line of lines) {
      this.text(x, y, line, { size, bold, color });
      y += size * leading;
    }
    return y;
  }

  rect(x, yTop, w, h, color = [0.9, 0.9, 0.9]) {
    const y = this.height - yTop - h;
    this.page.ops.push(
      `${color.map(n => n.toFixed(3)).join(' ')} rg`,
      `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`,
    );
  }

  rule(x, yTop, w, color = [0.85, 0.85, 0.85]) {
    this.rect(x, yTop, w, 0.7, color);
  }

  /**
   * Places a baseline JPEG. `bytes` is the raw file, copied straight into the
   * document — the whole reason this stays small and lossless.
   */
  image(bytes, { x, yTop, w, h, key }) {
    let entry = key && this.images.get(key);
    if (!entry) {
      const obj = this._addObject([
        `<</Type/XObject/Subtype/Image/Width ${this._iw}/Height ${this._ih}` +
        `/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${bytes.length}>>\nstream\n`,
        bytes,
        '\nendstream',
      ]);
      entry = { obj };
      if (key) this.images.set(key, entry);
    }
    const name = `Im${entry.obj}`;
    this.page.images.set(name, entry.obj);
    const y = this.height - yTop - h;
    this.page.ops.push(
      'q',
      `${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`,
      `/${name} Do`,
      'Q',
    );
  }

  /** Dimensions must be known before image() builds the XObject dictionary. */
  setImageSize(w, h) { this._iw = w; this._ih = h; }

  build() {
    const fontReg = this._addObject(['<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>']);
    const fontBold = this._addObject(['<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>']);

    const pagesObjNum = this.objects.length + 1 + this.pages.length * 2 + 1;
    const pageRefs = [];

    for (const page of this.pages) {
      const content = page.ops.join('\n');
      const contentObj = this._addObject([
        `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
      ]);
      const xobjects = [...page.images.entries()]
        .map(([name, obj]) => `/${name} ${obj} 0 R`).join(' ');
      const pageObj = this._addObject([
        `<</Type/Page/Parent ${pagesObjNum} 0 R` +
        `/MediaBox[0 0 ${this.width.toFixed(2)} ${this.height.toFixed(2)}]` +
        `/Resources<</Font<</F1 ${fontReg} 0 R/F2 ${fontBold} 0 R>>` +
        (xobjects ? `/XObject<<${xobjects}>>` : '') + '>>' +
        `/Contents ${contentObj} 0 R>>`,
      ]);
      pageRefs.push(pageObj);
    }

    const pagesObj = this._addObject([
      `<</Type/Pages/Kids[${pageRefs.map(n => `${n} 0 R`).join(' ')}]/Count ${pageRefs.length}>>`,
    ]);
    const catalogObj = this._addObject([`<</Type/Catalog/Pages ${pagesObj} 0 R>>`]);
    const infoObj = this._addObject([
      `<</Producer(Snap Expense Tracker)/CreationDate(D:${pdfDate(new Date())})>>`,
    ]);

    // ── Serialise ──
    const chunks = [];
    let length = 0;
    const push = part => {
      const bytes = typeof part === 'string' ? latin1(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const offsets = [0];
    this.objects.forEach((parts, i) => {
      offsets[i + 1] = length;
      push(`${i + 1} 0 obj\n`);
      parts.forEach(push);
      push('\nendobj\n');
    });

    const xrefOffset = length;
    const count = this.objects.length + 1;
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push(`trailer\n<</Size ${count}/Root ${catalogObj} 0 R/Info ${infoObj} 0 R>>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return new Blob([out], { type: 'application/pdf' });
  }
}

function pdfDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Normalises any stored image blob into baseline-JPEG bytes plus dimensions.
 * Images the app captured are already baseline JPEG and pass through untouched;
 * anything else (a PNG page render, an imported file) is re-encoded once.
 */
export async function toJpegBytes(blob, { maxEdge = 1600, quality = 0.85 } = {}) {
  const bmp = await createImageBitmap(blob);
  const needsReencode = blob.type !== 'image/jpeg'
    || Math.max(bmp.width, bmp.height) > maxEdge;

  if (!needsReencode) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const size = { w: bmp.width, h: bmp.height };
    bmp.close?.();
    return { bytes, ...size };
  }

  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);            // flatten transparency; PDF has no alpha here
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  return { bytes: new Uint8Array(await out.arrayBuffer()), w, h };
}
