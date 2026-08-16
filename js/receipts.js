'use strict';

import { PdfDoc, A4, toJpegBytes, textWidth, sanitise } from './pdf.js';
import { fmtMoney, fmtDate } from './util.js';
import { getFile, recordFileIds } from './store.js';

/**
 * Builds a "receipt pack": one PDF holding a copy of every stored receipt
 * image, each on its own page with the transaction details printed above it,
 * behind a summary index. This is the thing you hand to an accountant.
 */

const M = 42;                       // page margin
const GREY = [0.42, 0.47, 0.54];
const FAINT = [0.62, 0.66, 0.72];
const INK = [0.06, 0.09, 0.15];

export async function buildReceiptPack(records, {
  workspace,
  periodLabel = 'All time',
  onProgress,
} = {}) {
  const withFiles = records
    .filter(r => recordFileIds(r).length)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!withFiles.length) {
    return { blob: null, included: 0, skipped: records.length };
  }

  const doc = new PdfDoc();
  const generated = new Date();
  const contentWidth = A4.w - M * 2;

  // ── Summary page ──────────────────────────────────────────
  doc.addPage();
  let y = M;
  doc.text(M, y, 'Receipt pack', { size: 22, bold: true, color: INK });
  y += 28;
  doc.text(M, y, `${workspace.name} · ${periodLabel}`, { size: 11, color: GREY });
  y += 15;
  doc.text(M, y, `Generated ${generated.toLocaleDateString()} · ${withFiles.length} receipt${withFiles.length === 1 ? '' : 's'}`,
    { size: 9, color: FAINT });
  y += 22;
  doc.rule(M, y, contentWidth);
  y += 16;

  const total = withFiles.reduce((s, r) => s + (r.type === 'income' ? 0 : r.amount), 0);
  doc.text(M, y, 'Total of receipts included', { size: 10, color: GREY });
  doc.text(M, y, fmtMoney(total, workspace.currency), {
    size: 13, bold: true, color: INK, align: 'right', width: contentWidth,
  });
  y += 26;

  // ── Index table ───────────────────────────────────────────
  const COLS = { page: M, date: M + 34, who: M + 92, cat: M + 300, amt: M };
  const ROW_H = 15;
  const BOTTOM = A4.h - M - ROW_H;
  const CONT_TOP = M + 22;            // where a continuation sheet's rows start

  const drawIndexHeader = (atY) => {
    doc.text(COLS.page, atY, 'PG', { size: 8, bold: true, color: FAINT });
    doc.text(COLS.date, atY, 'DATE', { size: 8, bold: true, color: FAINT });
    doc.text(COLS.who, atY, 'WHO', { size: 8, bold: true, color: FAINT });
    doc.text(COLS.cat, atY, 'CATEGORY', { size: 8, bold: true, color: FAINT });
    doc.text(COLS.amt, atY, 'AMOUNT', { size: 8, bold: true, color: FAINT, align: 'right', width: contentWidth });
    doc.rule(M, atY + 12, contentWidth);
    return atY + 20;
  };

  const firstRowY = y + 20;           // after the header row drawn below

  // Work out how many sheets the index needs *before* numbering anything —
  // receipt page numbers depend on it, so it cannot be discovered midway.
  const fitsOnFirst = Math.max(1, Math.floor((BOTTOM - firstRowY) / ROW_H));
  const fitsOnLater = Math.max(1, Math.floor((BOTTOM - (CONT_TOP + 20)) / ROW_H));
  let indexPages = 1;
  let overflow = withFiles.length - fitsOnFirst;
  while (overflow > 0) { indexPages++; overflow -= fitsOnLater; }

  let pageNo = indexPages + 1;        // receipts begin after the whole index
  const indexRows = withFiles.map(r => {
    const row = { rec: r, page: pageNo };
    pageNo += recordFileIds(r).length;
    return row;
  });

  y = drawIndexHeader(y);
  let onPage = 0;
  let capacity = fitsOnFirst;

  for (const row of indexRows) {
    if (onPage >= capacity) {
      doc.addPage();
      y = CONT_TOP;
      doc.text(M, M, 'Receipt pack (continued)', { size: 12, bold: true, color: GREY });
      y = drawIndexHeader(y);
      onPage = 0;
      capacity = fitsOnLater;
    }
    const r = row.rec;
    doc.text(COLS.page, y, String(row.page), { size: 9, color: FAINT });
    doc.text(COLS.date, y, fmtDate(r.date), { size: 9, color: INK });
    doc.text(COLS.who, y, clip(r.merchant || r.description || r.category, 9, 200), { size: 9, color: INK });
    doc.text(COLS.cat, y, clip(r.category, 9, 150), { size: 9, color: GREY });
    doc.text(COLS.amt, y, `${r.type === 'income' ? '+' : '-'}${fmtMoney(r.amount, r.currency)}`,
      { size: 9, bold: true, color: INK, align: 'right', width: contentWidth });
    y += ROW_H;
    onPage++;
  }

  // ── One page per receipt image ────────────────────────────
  let done = 0;
  for (const r of withFiles) {
    const ids = recordFileIds(r);
    for (let i = 0; i < ids.length; i++) {
      const file = await getFile(ids[i]);
      if (!file?.blob) continue;

      let img;
      try {
        img = await toJpegBytes(file.blob);
      } catch {
        continue;                      // unreadable image — skip rather than abort
      }

      doc.addPage();
      let py = M;

      const who = r.merchant || r.description || r.category;
      doc.text(M, py, who, { size: 15, bold: true, color: INK, width: contentWidth - 110 });
      doc.text(M, py, `${r.type === 'income' ? '+' : '-'}${fmtMoney(r.amount, r.currency)}`,
        { size: 15, bold: true, color: INK, align: 'right', width: contentWidth });
      py += 20;

      const meta = [
        fmtDate(r.date, 'long'),
        r.category,
        ids.length > 1 ? `page ${i + 1} of ${ids.length}` : null,
      ].filter(Boolean).join('  ·  ');
      doc.text(M, py, meta, { size: 9.5, color: GREY });
      py += 16;

      const extras = [
        r.tax != null ? `Tax/GST ${fmtMoney(r.tax, r.currency)}` : null,
        r.ref ? `Ref ${r.ref}` : null,
        r.description && r.description !== who ? r.description : null,
        r.notes || null,
      ].filter(Boolean);
      if (extras.length) {
        py = doc.paragraph(M, py, extras.join('  ·  '), { size: 9, color: FAINT, width: contentWidth });
        py += 4;
      }

      doc.rule(M, py, contentWidth);
      py += 14;

      // Fit the image into whatever space is left, never upscaling past the
      // column width, and centre it.
      const availH = A4.h - py - M - 18;
      const scale = Math.min(contentWidth / img.w, availH / img.h);
      const drawW = img.w * scale;
      const drawH = img.h * scale;
      doc.setImageSize(img.w, img.h);
      doc.image(img.bytes, { x: M + (contentWidth - drawW) / 2, yTop: py, w: drawW, h: drawH, key: ids[i] });

      doc.text(M, A4.h - M + 2, `${workspace.name} · receipt copy · generated ${generated.toLocaleDateString()}`,
        { size: 7.5, color: FAINT });
    }
    done++;
    onProgress?.({ done, total: withFiles.length });
  }

  return {
    blob: doc.build(),
    included: withFiles.length,
    skipped: records.length - withFiles.length,
  };
}

/** Single receipt, same layout, no index page. */
export async function buildSingleReceipt(record, { workspace }) {
  return buildReceiptPack([record], {
    workspace,
    periodLabel: fmtDate(record.date),
  });
}

function clip(str, size, maxWidth) {
  const clean = sanitise(str);
  if (textWidth(clean, size) <= maxWidth) return clean;
  let out = clean;
  while (out.length > 1 && textWidth(out + '…', size) > maxWidth) out = out.slice(0, -1);
  return out + '...';
}

export function receiptPackFilename(workspace, periodLabel) {
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `receipts-${slug(workspace.name)}-${slug(periodLabel)}.pdf`;
}
