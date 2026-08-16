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
async function put(storeName, value) {
  const t = tx(storeName, 'readwrite');
  const p = reqP(t.objectStore(storeName).put(value));
  await p;
  return new Promise(res => { t.oncomplete = () => res(value); });
}
async function del(storeName, key) {
  const t = tx(storeName, 'readwrite');
  await reqP(t.objectStore(storeName).delete(key));
  return new Promise(res => { t.oncomplete = res; });
}

// ── Boot ────────────────────────────────────────────────────
export async function init() {
  db = await open();

  const metaRows = await getAll('meta');
  const meta = Object.fromEntries(metaRows.map(r => [r.key, r.value]));

  state.workspaces = meta.workspaces || [];
  state.settings = Object.assign({
    activeWs: null,
    dateOrder: 'dmy',        // how ambiguous scanned dates like 04/03/26 are read
    theme: 'system',
    autoSaveHighConfidence: false,
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
    tax: r.tax == null ? null : Number(r.tax),
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
  if (idx === -1) state.records.push(rec);
  else {
    rec.createdAt = state.records[idx].createdAt;
    state.records[idx] = rec;
  }
  await put('records', rec);

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
