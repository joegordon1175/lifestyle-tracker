'use strict';

import { uid, today } from './util.js';
import { presetCategories, PRESETS } from './presets.js';

/**
 * Persistence. Records and settings live in IndexedDB so that receipt images
 * (stored as Blobs, not base64) don't blow the 5 MB localStorage quota.
 * Everything is mirrored into an in-memory cache at boot so views can render
 * synchronously.
 */

const DB_NAME = 'expense-tracker';
const DB_VER = 1;
const LEGACY_KEY = 'lbTracker_v1';

let db;
export const state = {
  records: [],      // all records, all workspaces
  workspaces: [],
  settings: {},
  payees: {},       // wsId → { key: { merchant, category, count } }
};

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('records')) {
        const s = d.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('ws', 'ws');
        s.createIndex('date', 'date');
      }
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeNames, mode = 'readonly') {
  return db.transaction(storeNames, mode);
}
function reqP(request) {
  return new Promise((res, rej) => {
    request.onsuccess = () => res(request.result);
    request.onerror = () => rej(request.error);
  });
}

async function getAll(storeName) {
  return reqP(tx(storeName).objectStore(storeName).getAll());
}
/** Resolves when the transaction commits; rejects if it aborts (e.g. storage full). */
function committed(t, value) {
  return new Promise((res, rej) => {
    t.oncomplete = () => res(value);
    t.onabort = () => rej(t.error || new Error('Storage write was aborted'));
    t.onerror = () => rej(t.error || new Error('Storage write failed'));
  });
}
async function put(storeName, value) {
  const t = tx(storeName, 'readwrite');
  const done = committed(t, value);
  t.objectStore(storeName).put(value);
  return done;
}
async function del(storeName, key) {
  const t = tx(storeName, 'readwrite');
  const done = committed(t);
  t.objectStore(storeName).delete(key);
  return done;
}

/** True when an error means the device is out of room for the app. */
export function isQuotaError(err) {
  return err?.name === 'QuotaExceededError'
    || /quota|storage.*full|not enough space/i.test(String(err?.message || err?.name || ''));
}

// ── Boot ────────────────────────────────────────────────────
export async function init() {
  db = await open();

  const metaRows = await getAll('meta');
  const meta = Object.fromEntries(metaRows.map(r => [r.key, r.value]));

  state.workspaces = meta.workspaces || [];
  state.payees = meta.payees || {};
  state.settings = Object.assign({
    activeWs: null,
    dateOrder: 'dmy',        // how ambiguous scanned dates like 04/03/26 are read
    theme: 'system',
    autoSaveHighConfidence: false,
    cropReceipts: true,      // show the scanner-style crop step for photos
    scanCleanup: 'strong',   // clean-up level last chosen in the scan preview
    onboarded: false,
  }, meta.settings || {});

  state.records = await getAll('records');

  if (!state.workspaces.length) await migrateOrSeed();

  if (!state.settings.activeWs || !state.workspaces.some(w => w.id === state.settings.activeWs)) {
    state.settings.activeWs = state.workspaces[0].id;
    await saveSettings();
  }
  return state;
}

/**
 * First run: adopt any data from the original Lifestyle Block Tracker into a
 * "Lifestyle Block" workspace, otherwise start clean with no workspace chosen
 * yet (onboarding picks one).
 */
async function migrateOrSeed() {
  let legacy = [];
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)) || []; } catch { legacy = []; }

  if (legacy.length) {
    const ws = makeWorkspace({ name: 'Lifestyle Block', preset: 'lifestyle' });
    state.workspaces = [ws];
    state.settings.activeWs = ws.id;
    state.settings.onboarded = true;

    const known = new Set(ws.categories.expense.concat(ws.categories.income).map(c => c.name));
    for (const old of legacy) {
      const category = remapLegacyCategory(old.category, known);
      const rec = normaliseRecord({
        id: old.id || uid(),
        ws: ws.id,
        type: old.type === 'income' ? 'income' : 'expense',
        amount: Number(old.amount) || 0,
        category,
        merchant: old.payee || '',
        description: old.description || '',
        date: old.date || today(),
        ref: old.ref || '',
        notes: old.notes || '',
        recurring: old.recurring ? { freq: old.recurFreq || 'monthly', next: old.recurNext || null } : null,
        source: 'migrated',
        createdAt: old.createdAt || new Date().toISOString(),
      });
      if (old.photo && typeof old.photo === 'string' && old.photo.startsWith('data:')) {
        try {
          const blob = await (await fetch(old.photo)).blob();
          const fid = uid();
          rec.fileIds = [fid];
          rec.fileType = 'image';
          await put('files', { id: fid, blob, name: 'receipt.jpg' });
        } catch { /* photo is not critical — keep the record */ }
      }
      state.records.push(rec);
      await put('records', rec);
    }
    localStorage.setItem(LEGACY_KEY + '_migrated', '1');
    await saveWorkspaces();
    await saveSettings();
    return;
  }

  // Clean install — one Personal workspace so the app is usable immediately.
  // It is marked provisional: onboarding replaces it if the user picks
  // something else, rather than leaving an empty duplicate behind.
  const ws = makeWorkspace({ name: 'Personal', preset: 'personal' });
  ws.provisional = true;
  state.workspaces = [ws];
  state.settings.activeWs = ws.id;
  await saveWorkspaces();
  await saveSettings();
}

const LEGACY_MAP = {
  'Veterinary': 'Veterinary & Animal Health',
  'Equipment': 'Equipment & Machinery',
  'Water / Irrigation': 'Water & Irrigation',
  'Labour': 'Labour & Contracting',
  'Grant / Subsidy': 'Grant & Subsidy',
  'Other Expense': 'Other',
  'Other Income': 'Other Income',
};
function remapLegacyCategory(name, known) {
  const mapped = LEGACY_MAP[name] || name;
  return known.has(mapped) ? mapped : (known.has(name) ? name : 'Other');
}

// ── Workspaces ──────────────────────────────────────────────
export function makeWorkspace({ name, preset, currency = 'NZD', accent }) {
  const p = PRESETS[preset] || PRESETS.personal;
  return {
    id: uid(),
    name: name || p.label,
    preset,
    icon: p.icon,
    accent: accent || p.accent,
    currency,
    categories: presetCategories(preset),
    createdAt: new Date().toISOString(),
  };
}

export function activeWorkspace() {
  return state.workspaces.find(w => w.id === state.settings.activeWs) || state.workspaces[0];
}

export function workspaceRecords(wsId = state.settings.activeWs) {
  return state.records.filter(r => r.ws === wsId);
}

export async function saveWorkspaces() {
  await put('meta', { key: 'workspaces', value: state.workspaces });
}
export async function saveSettings() {
  await put('meta', { key: 'settings', value: state.settings });
}

export async function addWorkspace(ws) {
  state.workspaces.push(ws);
  await saveWorkspaces();
  return ws;
}

export async function deleteWorkspace(id) {
  const doomed = state.records.filter(r => r.ws === id);
  for (const r of doomed) await deleteRecord(r.id);
  state.workspaces = state.workspaces.filter(w => w.id !== id);
  delete state.payees[id];
  await put('meta', { key: 'payees', value: state.payees });
  if (!state.workspaces.length) state.workspaces = [makeWorkspace({ name: 'Personal', preset: 'personal' })];
  if (state.settings.activeWs === id) state.settings.activeWs = state.workspaces[0].id;
  await saveWorkspaces();
  await saveSettings();
}

export async function setActiveWorkspace(id) {
  state.settings.activeWs = id;
  await saveSettings();
}

/** All categories for a workspace/type, as {name, icon, keywords}. */
export function categoriesFor(type, ws = activeWorkspace()) {
  return ws.categories[type] || [];
}

export function categoryIcon(name, ws = activeWorkspace()) {
  const all = [...(ws.categories.expense || []), ...(ws.categories.income || [])];
  return all.find(c => c.name === name)?.icon || '📦';
}

export async function addCategory(type, name, icon = '🏷️') {
  const ws = activeWorkspace();
  if (!name || ws.categories[type].some(c => c.name.toLowerCase() === name.toLowerCase())) return false;
  ws.categories[type].push({ name, icon, keywords: [] });
  await saveWorkspaces();
  return true;
}

export async function removeCategory(type, name) {
  const ws = activeWorkspace();
  ws.categories[type] = ws.categories[type].filter(c => c.name !== name);
  await saveWorkspaces();
}

// ── Records ─────────────────────────────────────────────────

/**
 * Attachments are a list of page images. Records written before multi-page
 * support carry a single `fileId`, so read through both shapes.
 */
export function recordFileIds(r) {
  if (!r) return [];
  if (Array.isArray(r.fileIds)) return r.fileIds.filter(Boolean);
  return r.fileId ? [r.fileId] : [];
}
function normaliseFileIds(r) {
  const ids = Array.isArray(r.fileIds) ? r.fileIds : (r.fileId ? [r.fileId] : []);
  return ids.filter(Boolean);
}

export function normaliseRecord(r) {
  return {
    id: r.id || uid(),
    ws: r.ws,
    type: r.type === 'income' ? 'income' : 'expense',
    amount: Math.abs(Number(r.amount) || 0),
    currency: r.currency || activeWorkspace()?.currency || 'NZD',
    category: r.category || 'Other',
    merchant: r.merchant || '',
    description: r.description || '',
    date: r.date || today(),
    ref: r.ref || '',
    tax: Number.isFinite(Number(r.tax)) && r.tax !== '' && r.tax !== null ? Number(r.tax) : null,
    notes: r.notes || '',
    tags: r.tags || [],
    recurring: r.recurring || null,
    fileIds: normaliseFileIds(r),
    fileType: r.fileType || null,
    source: r.source || 'manual',
    confidence: r.confidence || null,
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function saveRecord(input) {
  const rec = normaliseRecord(input);
  const idx = state.records.findIndex(r => r.id === rec.id);
  if (idx !== -1) rec.createdAt = state.records[idx].createdAt;

  await put('records', rec);            // throws on failure; memory stays honest
  if (idx === -1) state.records.push(rec);
  else state.records[idx] = rec;

  // Once a workspace holds real data it is no longer the disposable starter.
  const ws = state.workspaces.find(w => w.id === rec.ws);
  if (ws?.provisional) { delete ws.provisional; await saveWorkspaces(); }

  return rec;
}

export async function deleteRecord(id) {
  const rec = state.records.find(r => r.id === id);
  for (const fid of recordFileIds(rec)) await del('files', fid).catch(() => {});
  state.records = state.records.filter(r => r.id !== id);
  await del('records', id);
}

export function getRecord(id) { return state.records.find(r => r.id === id); }

// ── Remembered payees ───────────────────────────────────────
/**
 * What the user calls a supplier, learned from what they confirmed last time.
 *
 * Matching on the recognised name alone is not enough: the same letterhead
 * rarely reads the same way twice — one scan of a council notice comes back as
 * "WBOPDC" and the next as "Combined Rates/Levy Notice". So each entry also
 * keeps a handful of distinctive words from the page, and a new scan is matched
 * on those when the name itself does not line up.
 */
const PAYEE_LIMIT = 300;

// Words that turn up on everyone's paperwork and so prove nothing.
const COMMON = new Set([
  'invoice', 'receipt', 'total', 'notice', 'account', 'number', 'statement',
  'limited', 'payment', 'please', 'amount', 'date', 'balance', 'reference',
  'page', 'customer', 'service', 'charge', 'charges', 'period', 'instalment',
  'road', 'street', 'avenue', 'drive', 'lane', 'highway', 'phone', 'email',
  'subtotal', 'change', 'card', 'eftpos', 'visa', 'mastercard', 'thank',
  'thanks', 'copy', 'merchant', 'terminal', 'order', 'items', 'item', 'qty',
]);

export function payeeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

/** Distinctive words from the top of a receipt — the letterhead, in effect. */
function fingerprint(text, limit = 8) {
  const head = String(text || '').split(/\r?\n/).slice(0, 12).join(' ').toLowerCase();
  const out = [];
  const seen = new Set();
  for (const raw of head.match(/[a-z][a-z0-9.&]{3,}/g) || []) {
    const token = raw.replace(/[^a-z0-9]/g, '');
    if (token.length < 4 || COMMON.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= limit) break;
  }
  return out;
}

function bookFor(wsId) {
  const existing = state.payees[wsId];
  if (Array.isArray(existing)) return existing;
  return (state.payees[wsId] = []);
}

export async function rememberPayee(wsId, { detected = '', merchant = '', category = '', text = '' } = {}) {
  const name = merchant.trim();
  if (!name) return;
  const book = bookFor(wsId);

  const keys = [payeeKey(name), payeeKey(detected)].filter(k => k.length >= 3);
  const tokens = fingerprint(text);

  let entry = book.find(e => e.merchant.toLowerCase() === name.toLowerCase());
  if (!entry) {
    entry = { merchant: name, category, keys: [], tokens: [], count: 0 };
    book.push(entry);
  }
  entry.merchant = name;
  if (category) entry.category = category;
  entry.keys = [...new Set([...entry.keys, ...keys])].slice(0, 12);
  entry.tokens = [...new Set([...entry.tokens, ...tokens])].slice(0, 16);
  entry.count = (entry.count || 0) + 1;
  entry.updatedAt = new Date().toISOString();

  if (book.length > PAYEE_LIMIT) {
    book.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    book.length = PAYEE_LIMIT;
  }
  await put('meta', { key: 'payees', value: state.payees });
}

export function recallPayee(wsId, { detected = '', text = '' } = {}) {
  const book = state.payees[wsId];
  if (!Array.isArray(book) || !book.length) return null;

  const direct = payeeKey(detected);
  if (direct.length >= 3) {
    const hit = book.find(e => e.keys?.includes(direct));
    if (hit) return hit;
  }

  // Otherwise weigh up the page itself. A remembered name appearing verbatim
  // settles it; failing that, two distinctive words have to line up.
  const hay = payeeKey(text);
  if (!hay) return null;
  let best = null;
  for (const entry of book) {
    let score = (entry.keys || []).some(k => k.length >= 6 && hay.includes(k)) ? 3 : 0;
    for (const token of entry.tokens || []) {
      if (token.length >= 5 && hay.includes(token)) score++;
    }
    if (score >= 2 && (!best || score > best.score)) best = { score, entry };
  }
  return best?.entry || null;
}

/** Names offered as you type, most-used first. */
export function payeeNames(wsId = state.settings.activeWs) {
  const book = state.payees[wsId];
  if (!Array.isArray(book)) return [];
  return book.slice()
    .sort((a, b) => (b.count || 0) - (a.count || 0) || a.merchant.localeCompare(b.merchant))
    .map(e => e.merchant);
}

// ── Files ───────────────────────────────────────────────────
export async function saveFile(blob, name = 'receipt') {
  const id = uid();
  await put('files', { id, blob, name });
  return id;
}
export async function getFile(id) {
  if (!id) return null;
  return reqP(tx('files').objectStore('files').get(id));
}
export async function getFileURL(id) {
  const f = await getFile(id);
  return f?.blob ? URL.createObjectURL(f.blob) : null;
}

// ── Backup / restore ────────────────────────────────────────
export async function exportBackup() {
  return {
    app: 'snap-expense-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    workspaces: state.workspaces,
    settings: state.settings,
    payees: state.payees,
    records: state.records.map(({ fileIds, fileId, ...r }) => r), // images export separately as a receipt pack
  };
}

export async function importBackup(data, { replace = false } = {}) {
  if (!data || !Array.isArray(data.records) || !Array.isArray(data.workspaces)) {
    throw new Error('That file is not a tracker backup.');
  }
  if (replace) {
    for (const r of [...state.records]) await deleteRecord(r.id);
    state.workspaces = [];
  }
  if (data.payees && typeof data.payees === 'object') {
    for (const [wsId, incoming] of Object.entries(data.payees)) {
      if (!Array.isArray(incoming)) continue;           // older/unknown shape
      const book = bookFor(wsId);
      for (const entry of incoming) {
        if (!entry?.merchant) continue;
        const mine = book.find(e => e.merchant.toLowerCase() === entry.merchant.toLowerCase());
        if (!mine) { book.push(entry); continue; }
        mine.keys = [...new Set([...(mine.keys || []), ...(entry.keys || [])])].slice(0, 12);
        mine.tokens = [...new Set([...(mine.tokens || []), ...(entry.tokens || [])])].slice(0, 16);
        mine.count = Math.max(mine.count || 0, entry.count || 0);
        if (!mine.category && entry.category) mine.category = entry.category;
      }
    }
    await put('meta', { key: 'payees', value: state.payees });
  }

  const idMap = new Map();
  for (const ws of data.workspaces) {
    const existing = state.workspaces.find(w => w.id === ws.id);
    if (existing) { idMap.set(ws.id, existing.id); continue; }
    state.workspaces.push(ws);
    idMap.set(ws.id, ws.id);
  }
  await saveWorkspaces();

  let added = 0;
  for (const r of data.records) {
    if (state.records.some(x => x.id === r.id)) continue;
    const rec = normaliseRecord({ ...r, ws: idMap.get(r.ws) || state.workspaces[0].id, fileIds: [] });
    state.records.push(rec);
    await put('records', rec);
    added++;
  }
  if (!state.workspaces.some(w => w.id === state.settings.activeWs)) {
    state.settings.activeWs = state.workspaces[0].id;
    await saveSettings();
  }
  return added;
}

export async function estimateUsage() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
