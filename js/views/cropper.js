'use strict';

import { h, $, openSheet, toast, haptic } from '../util.js';
import {
  loadImage, toCanvas, detectDocument, warpToDocument, enhanceScan,
  canvasToBlob, fullFrameCorners,
} from '../scan.js';

/**
 * The crop step: shows the photo with the detected receipt outlined, lets the
 * corners be dragged, then flattens the selection into a clean rectangle.
 *
 * Corners are kept normalised (0..1) throughout, so they survive rotation,
 * resizing and the jump between the on-screen preview and the full-size image.
 */

const HANDLE_HIT = 34;        // px radius that counts as grabbing a corner
const LOUPE = 104;            // magnifier diameter

export function openCropper({ file, enhance = true, onDone, onCancel } = {}) {
  let bitmap = null;
  let working = null;         // full-size canvas at the current rotation
  let corners = fullFrameCorners();
  let rotation = 0;
  let useEnhance = enhance;
  let dragging = -1;
  let settled = false;

  const body = h(`<div class="cropper">
    <div class="crop-frame" id="crop-frame">
      <img id="crop-img" alt="Photographed receipt" />
      <svg id="crop-svg" aria-hidden="true"></svg>
      <canvas id="crop-loupe" class="crop-loupe" width="${LOUPE}" height="${LOUPE}" hidden></canvas>
      <div class="crop-busy" id="crop-busy">Finding the edges…</div>
    </div>

    <p class="crop-hint" id="crop-hint">Drag the corners to the edges of the receipt.</p>

    <div class="crop-tools">
      <button class="crop-tool" data-tool="rotate" type="button">↻<span>Rotate</span></button>
      <button class="crop-tool" data-tool="auto" type="button">✨<span>Auto</span></button>
      <button class="crop-tool" data-tool="full" type="button">⛶<span>Whole photo</span></button>
    </div>

    <div class="switch-row">
      <div class="switch-text">
        <b>Clean up</b>
        <small>Flatten the lighting so the paper reads white</small>
      </div>
      <input type="checkbox" class="switch" id="crop-enhance" ${useEnhance ? 'checked' : ''} />
    </div>

    <div class="sheet-actions">
      <button class="btn btn-ghost" id="crop-cancel" type="button">Cancel</button>
      <button class="btn btn-primary" id="crop-go" type="button">Use photo</button>
    </div>
  </div>`);

  const sheet = openSheet({
    title: 'Crop the receipt',
    body,
    size: 'full',
    onClose: () => { if (!settled) onCancel?.(); },
  });

  const img = $('#crop-img', body);
  const svg = $('#crop-svg', body);
  const frame = $('#crop-frame', body);
  const loupe = $('#crop-loupe', body);
  const busy = $('#crop-busy', body);

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
    const zoom = 2.6;
    const srcSize = LOUPE / zoom * (working.width / box.width);
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
    // Keep the loupe on screen, and out from under the finger.
    const left = Math.min(box.width - LOUPE, Math.max(0, p.x - LOUPE / 2)) + box.left;
    const top = Math.max(0, p.y - LOUPE - 26) + box.top;
    loupe.style.left = `${left}px`;
    loupe.style.top = `${top}px`;
    loupe.hidden = false;
  }

  // ── Pointer handling ──
  function pointAt(e) {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

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

  new ResizeObserver(() => { measure(); draw(); }).observe(frame);

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
      await rebuild();
    } catch {
      toast('Could not open that image', { tone: 'danger' });
      settled = true;
      sheet.close();
      onCancel?.();
    }
  })();

  // ── Tools ──
  body.addEventListener('click', async e => {
    const tool = e.target.closest('[data-tool]')?.dataset.tool;
    if (!tool) return;
    haptic();
    if (tool === 'rotate') { rotation = (rotation + 90) % 360; await rebuild(); }
    if (tool === 'auto') await rebuild();
    if (tool === 'full') { corners = fullFrameCorners(0); draw(); }
  });

  $('#crop-enhance', body).addEventListener('change', function () { useEnhance = this.checked; });
  $('#crop-cancel', body).addEventListener('click', () => sheet.close());

  $('#crop-go', body).addEventListener('click', async () => {
    const btn = $('#crop-go', body);
    btn.disabled = true;
    btn.textContent = 'Flattening…';
    busy.hidden = false;
    busy.textContent = 'Flattening…';
    await new Promise(r => setTimeout(r, 16));

    try {
      let out = warpToDocument(working, corners);
      if (useEnhance) out = enhanceScan(out);
      const blob = await canvasToBlob(out);
      settled = true;
      sheet.close();
      onDone(blob || file);
    } catch (err) {
      console.error(err);
      toast('Could not crop that one — using the original', { tone: 'danger' });
      settled = true;
      sheet.close();
      onDone(file);
    }
  });

  return sheet;
}
