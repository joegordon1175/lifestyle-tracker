'use strict';

import { toast, fmtDate } from './util.js';
import { activeWorkspace } from './store.js';
import { downloadBlob } from './csv.js';
import { buildReceiptPack, receiptPackFilename } from './receipts.js';

/**
 * Hands a generated file to the user. Downloading always happens; where the
 * platform supports sharing files (iOS/Android), a Share action is offered
 * afterwards so the pack can go straight to email, Files or an accountant.
 */
export function deliverFile(blob, filename, message) {
  downloadBlob(blob, filename);

  let file = null;
  try {
    file = new File([blob], filename, { type: blob.type });
  } catch { /* File constructor unavailable — download only */ }

  const canShare = file && navigator.canShare?.({ files: [file] });
  toast(message, {
    duration: canShare ? 8000 : 5000,
    action: canShare ? 'Share' : undefined,
    // The toast tap is its own user gesture, which is what share() requires.
    onAction: canShare
      ? () => navigator.share({ files: [file], title: filename }).catch(() => {})
      : undefined,
  });
}

/** Export one record's receipt as a small PDF. */
export async function saveReceiptPdf(record) {
  const ws = activeWorkspace();
  const dismiss = toast('Building the PDF…', { duration: 20000 });
  try {
    const { blob, included } = await buildReceiptPack([record], {
      workspace: ws,
      periodLabel: fmtDate(record.date),
    });
    dismiss?.();
    if (!included || !blob) { toast('That record has no receipt attached'); return; }
    const who = (record.merchant || record.category).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    deliverFile(blob, `receipt-${record.date}-${who || 'record'}.pdf`, 'Receipt PDF saved');
  } catch (err) {
    dismiss?.();
    console.error(err);
    toast('Could not build that PDF', { tone: 'danger' });
  }
}

/** Export every receipt in a set of records as one PDF pack. */
export async function saveReceiptPack(records, { periodLabel, onProgress } = {}) {
  const ws = activeWorkspace();
  const { blob, included, skipped } = await buildReceiptPack(records, {
    workspace: ws,
    periodLabel,
    onProgress,
  });
  if (!included || !blob) {
    toast('No receipts attached in that period', { tone: 'danger' });
    return null;
  }
  const note = skipped
    ? `${included} receipt${included === 1 ? '' : 's'} exported · ${skipped} record${skipped === 1 ? '' : 's'} had no image`
    : `${included} receipt${included === 1 ? '' : 's'} exported`;
  deliverFile(blob, receiptPackFilename(ws, periodLabel), note);
  return { included, skipped };
}
