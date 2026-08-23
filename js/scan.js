'use strict';

/**
 * Document scanning: find the receipt in a photo, flatten it, clean it up.
 *
 *   photo → detectDocument() → four corners
 *         → warpToDocument()  → perspective-corrected rectangle
 *         → enhanceScan()     → even lighting, white paper
 *
 * All of it runs on canvas pixel data with no dependencies. Detection works on
 * a small copy for speed; the warp reads from the full-size image so nothing
 * is thrown away.
 */

const DETECT_EDGE = 480;      // long edge used for edge finding
const SOURCE_EDGE = 2400;     // cap on the working image, to bound memory
const OUTPUT_EDGE = 1600;     // cap on the flattened result

// ── Canvas helpers ──────────────────────────────────────────
export async function loadImage(source) {
  if (typeof source === 'string') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = source; });
    return img;
  }
  if (window.createImageBitmap) {
    try { return await createImageBitmap(source); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 10000); }
}

/**
 * Draws the source into a canvas at a bounded size, applying a quarter-turn
 * rotation if asked. Everything downstream works from this one canvas.
 */
export function toCanvas(bitmap, { maxEdge = SOURCE_EDGE, rotation = 0 } = {}) {
  const swap = rotation === 90 || rotation === 270;
  const sw = bitmap.width, sh = bitmap.height;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  ctx.restore();
  return canvas;
}

function downscale(canvas, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0, w, h);
  return out;
}

// ── Detection ───────────────────────────────────────────────
function luminance(imageData) {
  const { data, width, height } = imageData;
  const grey = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    grey[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return grey;
}

/** 3x3 box blur — knocks out sensor noise and receipt print before thresholding. */
function blur3(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += src[yy * w + xx]; n++;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

/** Otsu's method: the threshold that best splits the histogram in two. */
function otsu(grey) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++;
  const total = grey.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

/** Largest 4-connected run of above-threshold pixels — normally the paper. */
function largestBrightBlob(grey, w, h, threshold) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = null, label = 0;

  for (let start = 0; start < grey.length; start++) {
    if (labels[start] || grey[start] < threshold) continue;
    label++;
    let top = 0, area = 0;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    const pixels = [];
    stack[top++] = start;
    labels[start] = label;

    while (top) {
      const p = stack[--top];
      const x = p % w, y = (p / w) | 0;
      area++;
      pixels.push(p);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0     && !labels[p - 1] && grey[p - 1] >= threshold) { labels[p - 1] = label; stack[top++] = p - 1; }
      if (x < w - 1 && !labels[p + 1] && grey[p + 1] >= threshold) { labels[p + 1] = label; stack[top++] = p + 1; }
      if (y > 0     && !labels[p - w] && grey[p - w] >= threshold) { labels[p - w] = label; stack[top++] = p - w; }
      if (y < h - 1 && !labels[p + w] && grey[p + w] >= threshold) { labels[p + w] = label; stack[top++] = p + w; }
    }
    if (!best || area > best.area) best = { area, pixels, minX, maxX, minY, maxY };
  }
  return best;
}

/**
 * Corners of a rotated rectangle come out of the extremes of x+y and x-y,
 * which is far more stable on a noisy blob than trying to fit lines.
 */
function cornersOfBlob(blob, w) {
  let tl = null, tr = null, br = null, bl = null;
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;

  for (const p of blob.pixels) {
    const x = p % w, y = (p / w) | 0;
    const sum = x + y, diff = x - y;
    if (sum < minSum) { minSum = sum; tl = { x, y }; }
    if (sum > maxSum) { maxSum = sum; br = { x, y }; }
    if (diff > maxDiff) { maxDiff = diff; tr = { x, y }; }
    if (diff < minDiff) { minDiff = diff; bl = { x, y }; }
  }
  return [tl, tr, br, bl];
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function quadArea(c) {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = c[i], q = c[(i + 1) % 4];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

export function fullFrameCorners(inset = 0.04) {
  const a = inset, b = 1 - inset;
  return [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];
}

/**
 * Finds the document in `canvas`. Corners come back normalised to 0..1 in
 * clockwise order from the top-left, with a confidence caller can act on.
 */
export function detectDocument(canvas) {
  const small = downscale(canvas, DETECT_EDGE);
  const w = small.width, h = small.height;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  const grey = blur3(luminance(ctx.getImageData(0, 0, w, h)), w, h);

  const threshold = otsu(grey);
  const blob = largestBrightBlob(grey, w, h, threshold);
  const frameArea = w * h;

  if (!blob || blob.area < frameArea * 0.10) {
    return { corners: fullFrameCorners(), confidence: 0 };
  }

  const corners = cornersOfBlob(blob, w);
  const area = quadArea(corners);

  // Too small to be the subject, or so large there was nothing to separate it
  // from — either way the user is better off positioning it themselves.
  if (area < frameArea * 0.12) return { corners: fullFrameCorners(), confidence: 0 };
  if (area > frameArea * 0.97) return { corners: fullFrameCorners(0.02), confidence: 0.15 };

  // A document has four sides of sensible length and roughly parallel edges.
  const sides = [
    dist(corners[0], corners[1]), dist(corners[1], corners[2]),
    dist(corners[2], corners[3]), dist(corners[3], corners[0]),
  ];
  const minSide = Math.min(...sides);
  if (minSide < Math.min(w, h) * 0.12) return { corners: fullFrameCorners(), confidence: 0 };

  const topBottom = Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]);
  const leftRight = Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3]);
  const fill = area / blob.area;         // how rectangular the blob actually is

  let confidence = 0.35;
  if (topBottom > 0.75 && leftRight > 0.75) confidence += 0.3;
  if (fill > 0.85) confidence += 0.25;
  if (area > frameArea * 0.3) confidence += 0.1;

  return {
    corners: corners.map(c => ({ x: c.x / w, y: c.y / h })),
    confidence: Math.min(0.95, confidence),
  };
}

// ── Perspective warp ────────────────────────────────────────
/** Solves an 8x8 system by Gaussian elimination with partial pivoting. */
function solve8(A, b) {
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < 1e-10) return null;
    if (pivot !== col) {
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      if (!f) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < n; c++) sum -= A[r][c] * x[c];
    x[r] = sum / A[r][r];
  }
  return x;
}

/**
 * Homography mapping destination coordinates back to source coordinates —
 * the direction needed to fill every output pixel exactly once.
 */
function inverseHomography(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i];
    const { x: u, y: v } = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve8(A, b);
}

/**
 * Flattens the quad in `canvas` (corners normalised 0..1) into a rectangle,
 * sampling bilinearly so text stays legible.
 */
export function warpToDocument(canvas, cornersNorm, { maxEdge = OUTPUT_EDGE } = {}) {
  const sw = canvas.width, sh = canvas.height;
  const src = cornersNorm.map(c => ({
    x: Math.min(sw - 1, Math.max(0, c.x * sw)),
    y: Math.min(sh - 1, Math.max(0, c.y * sh)),
  }));

  // Output size from the longer of each pair of opposite edges, so nothing
  // gets squashed by the perspective.
  const wOut = Math.max(dist(src[0], src[1]), dist(src[3], src[2]));
  const hOut = Math.max(dist(src[0], src[3]), dist(src[1], src[2]));
  const scale = Math.min(1, maxEdge / Math.max(wOut, hOut));
  const W = Math.max(8, Math.round(wOut * scale));
  const H = Math.max(8, Math.round(hOut * scale));

  const dst = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const h = inverseHomography(dst, src);
  if (!h) return canvas;   // degenerate selection — leave the photo as it is

  const srcData = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const outCtx = out.getContext('2d');
  const outImg = outCtx.createImageData(W, H);
  const o = outImg.data;

  const [h0, h1, h2, h3, h4, h5, h6, h7] = h;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = h6 * x + h7 * y + 1;
      const u = (h0 * x + h1 * y + h2) / den;
      const v = (h3 * x + h4 * y + h5) / den;
      const o4 = (y * W + x) * 4;

      if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) {
        o[o4] = o[o4 + 1] = o[o4 + 2] = 255;
        o[o4 + 3] = 255;
        continue;
      }
      const x0 = u | 0, y0 = v | 0;
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = u - x0, fy = v - y0;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy, w11 = fx * fy;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;

      for (let c = 0; c < 3; c++) {
        o[o4 + c] = srcData[i00 + c] * w00 + srcData[i10 + c] * w10
                  + srcData[i01 + c] * w01 + srcData[i11 + c] * w11;
      }
      o[o4 + 3] = 255;
    }
  }
  outCtx.putImageData(outImg, 0, 0);
  return out;
}

// ── Enhancement ─────────────────────────────────────────────
/**
 * Divides out uneven lighting so paper reads as white and print as black —
 * the flat, evenly-lit look a scanner produces. The illumination estimate is
 * built from a heavily blurred small copy, then sampled back up.
 */
export function enhanceScan(canvas, { strength = 1 } = {}) {
  const mix = Math.max(0, Math.min(1, strength));
  if (mix === 0) return canvas;

  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  // Illumination map: luma at 1/8 scale, box-blurred wide.
  const bw = Math.max(1, Math.round(w / 8));
  const bh = Math.max(1, Math.round(h / 8));
  const small = document.createElement('canvas');
  small.width = bw; small.height = bh;
  small.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0, bw, bh);
  const sGrey = luminance(small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, bw, bh));
  const bg = boxBlur(sGrey, bw, bh, Math.max(2, Math.round(Math.max(bw, bh) / 12)));

  // Pass 1: how dark is each pixel relative to the paper right behind it?
  // Judging ink against its local background rather than an absolute curve is
  // what keeps faint thermal print from being flattened into the paper.
  const RATIO_MAX = 1.2;
  const ratios = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  const luma = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const by = Math.min(bh - 1, (y * bh / h) | 0);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      luma[p] = l;
      const local = Math.max(40, bg[by * bw + Math.min(bw - 1, (x * bw / w) | 0)]);
      const r = Math.min(RATIO_MAX, l / local);
      ratios[p] = r;
      hist[Math.max(0, Math.min(255, Math.round((r / RATIO_MAX) * 255)))]++;
    }
  }

  // The darkest 2% of the page is the real ink, whatever shade it happens to
  // be. Anchoring the black point there rescales a faded receipt without
  // crushing one that was already high-contrast.
  const total = w * h;
  let acc = 0, blackPoint = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= total * 0.02) { blackPoint = (i / 255) * RATIO_MAX; break; }
  }
  const lo = Math.max(0.35, Math.min(0.92, blackPoint));
  const span = Math.max(0.08, 1 - lo);

  // Pass 2: stretch that range across the full scale, keeping the colour.
  for (let p = 0; p < total; p++) {
    const t = Math.max(0, Math.min(1, (ratios[p] - lo) / span));
    const target = 255 * Math.pow(t, 0.85);      // slight lift off pure black
    const l = Math.max(1, luma[p]);
    const gain = target / l;
    const i = p * 4;
    for (let c = 0; c < 3; c++) {
      const original = data[i + c];
      const full = Math.max(0, Math.min(255, original * gain));
      data[i + c] = original + (full - original) * mix;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Separable box blur over a greyscale plane. */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / (2 * r + 1);
      const add = src[y * w + Math.min(w - 1, x + r + 1)];
      const sub = src[y * w + Math.max(0, x - r)];
      sum += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      sum += add - sub;
    }
  }
  return out;
}

/** Clean-up levels offered in the preview, and what they mean numerically. */
export const CLEANUP_LEVELS = [
  { key: 'off', label: 'Original', strength: 0 },
  { key: 'light', label: 'Light', strength: 0.5 },
  { key: 'strong', label: 'Strong', strength: 1 },
];
export function cleanupStrength(key) {
  return (CLEANUP_LEVELS.find(l => l.key === key) || CLEANUP_LEVELS[2]).strength;
}

export function canvasToBlob(canvas, quality = 0.85) {
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
}

/** One-shot: photo in, flattened and cleaned receipt out. */
export async function autoScan(file, { strength = 1 } = {}) {
  const bitmap = await loadImage(file);
  const canvas = toCanvas(bitmap);
  bitmap.close?.();
  const { corners, confidence } = detectDocument(canvas);
  if (confidence < 0.4) return { blob: file, applied: false };
  let out = warpToDocument(canvas, corners);
  if (strength > 0) out = enhanceScan(out, { strength });
  return { blob: await canvasToBlob(out), applied: true };
}
