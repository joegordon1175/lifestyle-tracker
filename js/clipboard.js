'use strict';

import { h, $, openSheet, toast } from './util.js';

/**
 * Getting a receipt out of the clipboard.
 *
 * Two routes, because browsers differ:
 *  1. `navigator.clipboard.read()` — needs a user gesture and, on iOS, shows a
 *     system "Paste" confirmation. Preferred when available.
 *  2. A focused paste target the user long-presses into, which works anywhere
 *     the first route is unsupported or denied.
 */

const WANTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

function extFor(type) {
  return ({
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'application/pdf': 'pdf',
  })[type] || 'bin';
}

function fileFrom(blob, type) {
  return new File([blob], `pasted-receipt.${extFor(type)}`, { type });
}

/** Pull an inline image out of copied rich text (email bodies often carry one). */
async function fileFromHtml(html) {
  const match = /<img[^>]+src\s*=\s*["'](data:image\/[a-z+]+;base64,[^"']+)["']/i.exec(html);
  if (!match) return null;
  try {
    const blob = await (await fetch(match[1])).blob();
    return fileFrom(blob, blob.type || 'image/png');
  } catch {
    return null;
  }
}

/**
 * Reads the clipboard directly. Must be called synchronously from a user
 * gesture or the browser will reject it.
 * Returns { file } on success, or { reason } explaining why not.
 */
export async function readClipboardFile() {
  if (!navigator.clipboard?.read) return { reason: 'unsupported' };

  let items;
  try {
    items = await navigator.clipboard.read();
  } catch (err) {
    // NotAllowedError covers both a denied permission and a dismissed prompt.
    return { reason: err?.name === 'NotAllowedError' ? 'denied' : 'failed' };
  }

  for (const item of items) {
    const type = WANTED.find(t => item.types.includes(t))
      || item.types.find(t => t.startsWith('image/'));
    if (type) {
      try { return { file: fileFrom(await item.getType(type), type) }; }
      catch { /* try the next item */ }
    }
    if (item.types.includes('text/html')) {
      try {
        const file = await fileFromHtml(await (await item.getType('text/html')).text());
        if (file) return { file };
      } catch { /* try the next item */ }
    }
  }
  return { reason: 'empty' };
}

/** Same extraction, but from a paste event's clipboardData. */
export async function fileFromPasteEvent(event) {
  const dt = event.clipboardData;
  if (!dt) return null;

  for (const item of dt.items || []) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) return file;
  }
  if (dt.files?.length) {
    const file = dt.files[0];
    if (file.type.startsWith('image/') || file.type === 'application/pdf') return file;
  }
  const html = dt.getData?.('text/html');
  if (html) return fileFromHtml(html);
  return null;
}

/**
 * Fallback for browsers that will not hand over the clipboard programmatically:
 * give the user somewhere to paste into and read the resulting paste event.
 */
export function openPasteTarget({ onFile }) {
  const body = h(`<div>
    <p class="sheet-text">Long-press the box below and choose <b>Paste</b>, or press
      ${navigator.platform?.includes('Mac') ? '⌘V' : 'Ctrl+V'} if you have a keyboard.</p>
    <div class="paste-target" id="paste-box" contenteditable="true" role="textbox"
         aria-label="Paste the receipt here" spellcheck="false"></div>
    <div class="note">Copy the receipt image in your email app first. Screenshots
      work too — anything that puts a picture on the clipboard.</div>
    <div class="sheet-actions">
      <button class="btn btn-ghost full" id="paste-cancel" type="button">Cancel</button>
    </div>
  </div>`);

  const sheet = openSheet({ title: 'Paste a receipt', body });
  const box = $('#paste-box', body);
  setTimeout(() => box.focus(), 250);

  box.addEventListener('paste', async e => {
    e.preventDefault();
    const file = await fileFromPasteEvent(e);
    if (!file) {
      toast('No image on the clipboard — copy the receipt first', { tone: 'danger' });
      return;
    }
    sheet.close();
    onFile(file);
  });

  $('#paste-cancel', body).addEventListener('click', sheet.close);
  return sheet;
}

/**
 * The single entry point the UI calls. Tries the direct read, and falls back to
 * the paste target when that is not an option.
 */
export async function pasteReceipt({ onFile }) {
  const { file, reason } = await readClipboardFile();
  if (file) { onFile(file); return; }

  if (reason === 'empty') {
    toast('Nothing to paste — copy the receipt image first', { tone: 'danger' });
    return;
  }
  // unsupported / denied / failed → let the user paste manually instead.
  openPasteTarget({ onFile });
}
