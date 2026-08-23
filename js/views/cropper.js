'use strict';

import { h, $, $$, openSheet, toast, haptic } from '../util.js';
import { state, saveSettings } from '../store.js';
import {
  loadImage, toCanvas, detectDocument, warpToDocument, enhanceScan,
  canvasToBlob, fullFrameCorners, CLEANUP_LEVELS, cleanupStrength,
} from '../scan.js';

/**
 * The scan step, in two phases inside one sheet:
 *
 *   crop     — the photo with the detected receipt outlined and draggable
 *   preview  — the flattened result, with the clean-up dialled up or down
 *
 * Preview can always go back to crop with the corners intact, so nothing is
 * committed until the result has actually been seen.
 */

const HANDLE_HIT = 34;        // px radius that counts as grabbing a corner
const LOUPE = 104;            // magnifier diameter

export function openCropper({ file, onDone, onCancel } = {}) {
  let bitmap = null;
  let working = null;         // full-size canvas at the current rotation
  let warped = null;          // flattened result, cached across level changes
  let previewCanvas = null;   // what the preview is currently showing
  let corners = fullFrameCorners();
  let rotation = 0;
  let level = state.settings.scanCleanup || 'strong';
  let dragging = -1;
  let settled = false;

  const body = h(`<div class="cropper">
    <div class="crop-frame" id="crop-frame">
      <img id="crop-img" alt="Photographed receipt" />
      <svg id="crop-svg" aria-hidden="true"></svg>
      <canvas id="crop-loupe" class="crop-loupe" width="${LOUPE}" height="${LOUPE}" hidden></canvas>
      <img id="preview-img" class="preview-img" alt="Flattened receipt" hidden />
      <div class="crop-busy" id="crop-busy">Finding the edges…</div>
    </div>

    <!-- crop phase -->
    <div id="phase-crop">
      <p class="crop-hint" id="crop-hint">Drag the corners to the edges of the receipt.</p>
      <div class="crop-tools">
        <button class="crop-tool" data-tool="rotate" type="button">↻<span>Rotate</span></button>
        <button class="crop-tool" data-tool="auto" type="button">✨<span>Auto</span></button>
        <button class="crop-tool" data-tool="full" type="button">⛶<span>Whole photo</span></button>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-ghost" id="crop-cancel" type="button">Cancel</button>
        <button class="btn btn-primary" id="crop-next" type="button">Preview</button>
      </div>
    </div>

    <!-- preview phase -->
    <div id="phase-preview" hidden>
      <p class="crop-hint">How should it be cleaned up?</p>
      <div class="segmented" id="level-seg">
        ${CLEANUP_LEVELS.map(l => `<button type="button" data-level="${l.key}"
          aria-selected="${l.key === level}">${l.label}</button>`).join('')}
      </div>
      <p class="crop-hint" id="level-note"></p>
      <div class="sheet-actions">
        <button class="btn btn-ghost" id="preview-back" type="button">‹ Back to crop</button>
        <button class="btn btn-primary" id="preview-save" type="button">Use this</button>
      </div>
    </div>
  </div>`);

  const sheet = openSheet({
    title: 'Scan the receipt',
    body,
    size: 'full',
    onClose: () => { if (!settled) onCancel?.(); },
  });

  const img = $('#crop-img', body);
  const previewImg = $('#preview-img', body);
  const svg = $('#crop-svg', body);
  const frame = $('#crop-frame', body);
  const loupe = $('#crop-loupe', body);
  const busy = $('#crop-busy', body);
  const title = $('.sheet-title', sheet.el);

  const LEVEL_NOTE = {
    off: 'Exactly as photographed, just straightened.',
    light: 'Evens out the lighting but keeps the paper as it looks.',
    strong: 'Full scan look — white paper, dark print.',
  };

  // ── Geometry between the displayed image and normalised corners ──
  let box = { left: 0, top: 0, width: 1, height: 1 };
  function measure() {
    const f = frame.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    box = { left: i.left - f.left, top: i.top - f.top, width: i.width, height: i.height };
    svg.style.left = `${box.left}px`;
    svg.style.top = `${box.top}px`;
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  }
  const toScreen = c => ({ x: c.x * box.width, y: c.y * box.height });
  const toNorm = (x, y) => ({
    x: Math.min(1, Math.max(0, x / box.width)),
    y: Math.min(1, Math.max(0, y / box.height)),
  });

  function draw() {
    const pts = corners.map(toScreen);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
    svg.innerHTML = `
      <defs>
        <mask id="crop-mask">
          <rect width="100%" height="100%" fill="#fff"/>
          <path d="${d}" fill="#000"/>
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(8,12,20,.55)" mask="url(#crop-mask)"/>
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5"
            stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      ${pts.map((p, i) => `
        <g class="crop-handle${dragging === i ? ' active' : ''}">
          <circle cx="${p.x}" cy="${p.y}" r="15" fill="var(--accent)" fill-opacity=".22"/>
          <circle cx="${p.x}" cy="${p.y}" r="7" fill="#fff" stroke="var(--accent)" stroke-width="3"/>
        </g>`).join('')}`;
  }

  // ── Magnifier, so a fingertip does not hide the corner it is placing ──
  function showLoupe(index) {
    if (!working) return;
    const c = corners[index];
    const ctx = loupe.getContext('2d');
    const srcSize = LOUPE / 2.6 * (working.width / box.width);
    const cx = c.x * working.width, cy = c.y * working.height;

    ctx.clearRect(0, 0, LOUPE, LOUPE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(LOUPE / 2, LOUPE / 2, LOUPE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    ctx.drawImage(working, cx - srcSize / 2, cy - srcSize / 2, srcSize, srcSize, 0, 0, LOUPE, LOUPE);
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2, LOUPE / 2 - 12); ctx.lineTo(LOUPE / 2, LOUPE / 2 + 12);
    ctx.moveTo(LOUPE / 2 - 12, LOUPE / 2); ctx.lineTo(LOUPE / 2 + 12, LOUPE / 2);
    ctx.stroke();
    ctx.restore();

    const p = toScreen(c);
    loupe.style.left = `${Math.min(box.width - LOUPE, Math.max(0, p.x - LOUPE / 2)) + box.left}px`;
    loupe.style.top = `${Math.max(0, p.y - LOUPE - 26) + box.top}px`;
    loupe.hidden = false;
  }

  // ── Pointer handling ──
  const pointAt = e => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  svg.addEventListener('pointerdown', e => {
    const p = pointAt(e);
    let best = -1, bestDist = HANDLE_HIT;
    corners.forEach((c, i) => {
      const s = toScreen(c);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    if (best < 0) return;
    dragging = best;
    svg.setPointerCapture(e.pointerId);
    haptic();
    draw();
    showLoupe(best);
  });

  svg.addEventListener('pointermove', e => {
    if (dragging < 0) return;
    e.preventDefault();
    const p = pointAt(e);
    corners[dragging] = toNorm(p.x, p.y);
    draw();
    showLoupe(dragging);
  });

  const endDrag = () => {
    if (dragging < 0) return;
    dragging = -1;
    loupe.hidden = true;
    draw();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  new ResizeObserver(() => { if (!$('#phase-crop', body).hidden) { measure(); draw(); } }).observe(frame);

  // ── Phases ──
  function showCrop() {
    title.textContent = 'Crop the receipt';
    $('#phase-crop', body).hidden = false;
    $('#phase-preview', body).hidden = true;
    previewImg.hidden = true;
    img.hidden = false;
    svg.style.display = '';
    requestAnimationFrame(() => { measure(); draw(); });
  }

  async function showPreview() {
    title.textContent = 'Check the scan';
    $('#phase-crop', body).hidden = true;
    $('#phase-preview', body).hidden = false;
    img.hidden = true;
    svg.style.display = 'none';
    loupe.hidden = true;
    previewImg.hidden = false;
    await renderLevel();
  }

  /** Re-applies the chosen clean-up to the cached flattened image. */
  async function renderLevel() {
    busy.hidden = false;
    busy.textContent = 'Applying…';
    await new Promise(r => setTimeout(r, 16));

    const c = document.createElement('canvas');
    c.width = warped.width;
    c.height = warped.height;
    c.getContext('2d').drawImage(warped, 0, 0);
    const strength = cleanupStrength(level);
    if (strength > 0) enhanceScan(c, { strength });

    previewCanvas = c;
    previewImg.src = c.toDataURL('image/jpeg', 0.85);
    $('#level-note', body).textContent = LEVEL_NOTE[level] || '';
    busy.hidden = true;
  }

  // ── Loading, rotation, detection ──
  async function rebuild({ redetect = true } = {}) {
    busy.hidden = false;
    busy.textContent = 'Finding the edges…';
    working = toCanvas(bitmap, { rotation });
    img.src = working.toDataURL('image/jpeg', 0.85);
    await new Promise(res => { img.onload = res; img.onerror = res; });
    measure();

    if (redetect) {
      // Yield first so the photo paints before detection blocks the thread.
      await new Promise(r => setTimeout(r, 16));
      const result = detectDocument(working);
      corners = result.corners;
      $('#crop-hint', body).textContent = result.confidence >= 0.4
        ? 'Found the edges — drag a corner if it needs nudging.'
        : 'Drag the corners to the edges of the receipt.';
    }
    busy.hidden = true;
    draw();
  }

  (async () => {
    try {
      bitmap = await loadImage(file);
      showCrop();
      await rebuild();
    } catch {
      toast('Could not open that image', { tone: 'danger' });
      settled = true;
      sheet.close();
      onCancel?.();
    }
  })();

  // ── Controls ──
  body.addEventListener('click', async e => {
    const tool = e.target.closest('[data-tool]')?.dataset.tool;
    if (tool) {
      haptic();
      if (tool === 'rotate') { rotation = (rotation + 90) % 360; await rebuild(); }
      if (tool === 'auto') await rebuild();
      if (tool === 'full') { corners = fullFrameCorners(0); draw(); }
      return;
    }

    const chosen = e.target.closest('[data-level]')?.dataset.level;
    if (chosen && chosen !== level) {
      level = chosen;
      haptic();
      $$('#level-seg button', body).forEach(b => b.setAttribute('aria-selected', String(b.dataset.level === level)));
      state.settings.scanCleanup = level;
      saveSettings();
      await renderLevel();
    }
  });

  $('#crop-cancel', body).addEventListener('click', () => sheet.close());
  $('#preview-back', body).addEventListener('click', () => { haptic(); showCrop(); });

  $('#crop-next', body).addEventListener('click', async () => {
    const btn = $('#crop-next', body);
    btn.disabled = true;
    busy.hidden = false;
    busy.textContent = 'Flattening…';
    await new Promise(r => setTimeout(r, 16));
    try {
      warped = warpToDocument(working, corners);
      await showPreview();
    } catch (err) {
      console.error(err);
      toast('Could not flatten that one — using the photo as it is', { tone: 'danger' });
      settled = true;
      sheet.close();
      onDone(file);
    } finally {
      btn.disabled = false;
      busy.hidden = true;
    }
  });

  $('#preview-save', body).addEventListener('click', async () => {
    const btn = $('#preview-save', body);
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const blob = await canvasToBlob(previewCanvas);
    settled = true;
    sheet.close();
    onDone(blob || file);
  });

  return sheet;
}
