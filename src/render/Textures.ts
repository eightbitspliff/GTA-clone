// ---------------------------------------------------------------------------
// Procedural textures & sprites (no external assets):
// seamless ground textures, roof gravel, soft particle / light sprites,
// headlight cones, blood splats, detailed vehicle sprites and shadows.
// Everything is generated once and cached.
// ---------------------------------------------------------------------------

import { VehicleModel } from '../config';

/** Direction shadows are cast in (sun from top-left). */
export const SUN = { x: 0.62, y: 0.78 };

/** Textures are generated at 2x and scaled down for crisp rendering. */
const TS = 2;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d')!];
}

// --- noise ---------------------------------------------------------------------

export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable value noise with lattice period `p`. */
function vnoise(x: number, y: number, p: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const m = (v: number) => ((v % p) + p) % p;
  const a = hash(m(xi), m(yi), seed), b = hash(m(xi + 1), m(yi), seed);
  const c = hash(m(xi), m(yi + 1), seed), d = hash(m(xi + 1), m(yi + 1), seed);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise over a texture of `size` pixels, seamless. */
function fbm(px: number, py: number, size: number, baseCells: number, oct: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, cells = baseCells;
  for (let o = 0; o < oct; o++) {
    sum += vnoise((px / size) * cells, (py / size) * cells, cells, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    cells *= 2;
  }
  return sum / norm;
}

type RGB = [number, number, number];

function pixelTexture(size: number, fn: (x: number, y: number) => RGB | [number, number, number, number]): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fn(x, y);
      const i = (y * size + x) * 4;
      d[i] = v[0];
      d[i + 1] = v[1];
      d[i + 2] = v[2];
      d[i + 3] = v.length === 4 ? v[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// --- ground textures (world size given; generated at TS scale) ---------------

const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, make: () => HTMLCanvasElement) {
  let c = cache.get(key);
  if (!c) {
    c = make();
    cache.set(key, c);
  }
  return c;
}

export function asphaltTexture(): HTMLCanvasElement {
  return cached('asphalt', () => {
    const S = 256 * TS;
    return pixelTexture(S, (x, y) => {
      const large = fbm(x, y, S, 4, 4, 11) - 0.5;
      const fine = Math.random() - 0.5;
      const speck = Math.random() < 0.02 ? 22 : 0;
      const v = 60 + large * 22 + fine * 16 + speck;
      return [clamp255(v), clamp255(v + 1), clamp255(v + 5)];
    });
  });
}

export function sidewalkTexture(): HTMLCanvasElement {
  return cached('sidewalk', () => {
    const S = 128 * TS, slab = 32 * TS;
    return pixelTexture(S, (x, y) => {
      const sx = Math.floor(x / slab), sy = Math.floor(y / slab);
      const tone = (hash(sx, sy, 3) - 0.5) * 14;
      const n = (fbm(x, y, S, 8, 3, 5) - 0.5) * 18 + (Math.random() - 0.5) * 12;
      const lx = x % slab, ly = y % slab;
      const joint = lx < 2 || ly < 2 ? -38 : lx < 3 || ly < 3 ? -12 : 0;
      const stain = fbm(x, y, S, 3, 2, 9) > 0.68 ? -12 : 0;
      const v = 150 + tone + n + joint + stain;
      return [clamp255(v), clamp255(v - 2), clamp255(v - 6)];
    });
  });
}

export function plazaTexture(): HTMLCanvasElement {
  return cached('plaza', () => {
    const S = 128 * TS, bw = 16 * TS, bh = 8 * TS;
    return pixelTexture(S, (x, y) => {
      const row = Math.floor(y / bh);
      const off = row % 2 ? bw / 2 : 0;
      const bx = Math.floor((x + off) / bw) % (S / bw);
      const tone = (hash(bx, row, 7) - 0.5) * 30;
      const lx = (x + off) % bw, ly = y % bh;
      const mortar = lx < 2 || ly < 2;
      const n = (Math.random() - 0.5) * 14;
      if (mortar) return [88 + n, 82 + n, 74 + n];
      const edge = lx < 4 || ly < 4 ? 10 : 0;
      return [clamp255(158 + tone + n + edge), clamp255(132 + tone * 0.8 + n + edge), clamp255(108 + tone * 0.6 + n + edge)];
    });
  });
}

export function grassTexture(): HTMLCanvasElement {
  return cached('grass', () => {
    const S = 256 * TS;
    return pixelTexture(S, (x, y) => {
      const large = fbm(x, y, S, 4, 4, 21);
      const blade = Math.random();
      const dry = fbm(x, y, S, 6, 3, 33) > 0.66 ? 18 : 0;
      const v = (large - 0.5) * 40 + (blade - 0.5) * 30;
      return [clamp255(62 + v * 0.6 + dry), clamp255(108 + v + dry * 0.6), clamp255(48 + v * 0.4)];
    });
  });
}

/** Semi-transparent speckles drawn over any roof colour. */
export function gravelTexture(): HTMLCanvasElement {
  return cached('gravel', () => {
    const S = 128 * TS;
    return pixelTexture(S, (x, y) => {
      const r = Math.random();
      const large = fbm(x, y, S, 4, 3, 41);
      if (r < 0.45) return [0, 0, 0, Math.floor(30 + large * 50)];
      if (r < 0.75) return [255, 255, 255, Math.floor(18 + large * 30)];
      return [0, 0, 0, 0];
    });
  });
}

/** World-aligned pattern for a texture generated at TS scale. */
export function worldPattern(ctx: CanvasRenderingContext2D, tex: HTMLCanvasElement): CanvasPattern {
  const p = ctx.createPattern(tex, 'repeat')!;
  p.setTransform(new DOMMatrix().scaleSelf(1 / TS, 1 / TS));
  return p;
}

// --- soft sprites ----------------------------------------------------------------

/** Radial gradient blob (for particles / smoke). */
export function softSprite(color: string): HTMLCanvasElement {
  return cached('soft:' + color, () => {
    const [c, ctx] = makeCanvas(64, 64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    // fade colour stop to transparent version of itself
    ctx.globalCompositeOperation = 'destination-in';
    const a = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    a.addColorStop(0, 'rgba(0,0,0,1)');
    a.addColorStop(0.5, 'rgba(0,0,0,0.7)');
    a.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 64, 64);
    return c;
  });
}

/** Light sprite with quadratic-ish falloff (used additively on the light map). */
export function lightSprite(r: number, g: number, b: number): HTMLCanvasElement {
  return cached(`light:${r},${g},${b}`, () => {
    const [c, ctx] = makeCanvas(128, 128);
    const gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(0.25, `rgba(${r},${g},${b},0.7)`);
    gr.addColorStop(0.6, `rgba(${r},${g},${b},0.22)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 128, 128);
    return c;
  });
}

/** Headlight cone pointing to +x, origin at (0, h/2). */
export function coneSprite(): HTMLCanvasElement {
  return cached('cone', () => {
    const W = 256, H = 160;
    const [c, ctx] = makeCanvas(W, H);
    ctx.filter = 'blur(6px)';
    const g = ctx.createRadialGradient(0, H / 2, 0, 0, H / 2, W);
    g.addColorStop(0, 'rgba(255,245,220,0.95)');
    g.addColorStop(0.5, 'rgba(255,240,210,0.45)');
    g.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(6, H / 2 - 6);
    ctx.lineTo(W - 10, 12);
    ctx.quadraticCurveTo(W, H / 2, W - 10, H - 12);
    ctx.lineTo(6, H / 2 + 6);
    ctx.closePath();
    ctx.fill();
    return c;
  });
}

export function splatSprite(i: number): HTMLCanvasElement {
  return cached('splat' + (i % 4), () => {
    const [c, ctx] = makeCanvas(64, 64);
    let s = i * 977 + 13;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    ctx.fillStyle = 'rgba(95,8,8,0.85)';
    ctx.beginPath();
    ctx.arc(32, 32, 12, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2, d = 8 + rnd() * 18, r = 1.5 + rnd() * 5;
      ctx.beginPath();
      ctx.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(160,30,30,0.35)';
    ctx.beginPath();
    ctx.arc(29, 29, 6, 0, Math.PI * 2);
    ctx.fill();
    return c;
  });
}

// --- color helpers -------------------------------------------------------------------

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  } else {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// --- vehicles --------------------------------------------------------------------------

/** Pixels per world unit for vehicle sprites. */
export const CAR_SCALE = 3;
const PAD = 4;

export type CarState = 'ok' | 'damaged' | 'wreck';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Detailed top-down car sprite, drawn with length along +x, centred. */
export function carSprite(m: VehicleModel, color: string, state: CarState): HTMLCanvasElement {
  return cached(`car:${m.id}:${color}:${state}`, () => {
    const L = m.length, W = m.width, K = CAR_SCALE;
    const [c, ctx] = makeCanvas((L + PAD * 2) * K, (W + PAD * 2) * K);
    ctx.scale(K, K);
    ctx.translate(L / 2 + PAD, W / 2 + PAD);
    const wreck = state === 'wreck';
    const base = wreck ? '#2c2723' : color;
    const id = m.id;

    // wheels (peek out a little)
    ctx.fillStyle = '#111';
    const wl = L * 0.17, ww = 3.4;
    for (const sx of [L * 0.3, -L * 0.3]) {
      for (const sy of [-1, 1]) {
        rr(ctx, sx - wl / 2, sy * (W / 2) - ww / 2 - sy * 0.6, wl, ww, 1.2);
        ctx.fill();
      }
    }

    // body with cross-gradient (curvature)
    const body = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
    body.addColorStop(0, shade(base, -0.45));
    body.addColorStop(0.18, shade(base, -0.05));
    body.addColorStop(0.42, shade(base, 0.18));
    body.addColorStop(0.7, shade(base, -0.02));
    body.addColorStop(1, shade(base, -0.5));
    ctx.fillStyle = body;
    const radius = id === 'truck' || id === 'armored' || id === 'swat' || id === 'van' ? W * 0.18 : W * 0.32;
    rr(ctx, -L / 2, -W / 2, L, W, radius);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    const glass = (x0: number, x1: number, wTop: number, wBot: number) => {
      // trapezoid from x0 (width wBot) to x1 (width wTop)
      const g = ctx.createLinearGradient(x0, -W / 2, x1, W / 2);
      g.addColorStop(0, wreck ? '#0c0c0c' : '#16222e');
      g.addColorStop(0.55, wreck ? '#141414' : '#2c4256');
      g.addColorStop(1, wreck ? '#0c0c0c' : '#121a22');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, -wBot / 2);
      ctx.lineTo(x1, -wTop / 2);
      ctx.lineTo(x1, wTop / 2);
      ctx.lineTo(x0, wBot / 2);
      ctx.closePath();
      ctx.fill();
      if (!wreck) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x0 + (x1 - x0) * 0.2, -wBot * 0.35);
        ctx.lineTo(x0 + (x1 - x0) * 0.75, wTop * 0.05);
        ctx.stroke();
      }
    };

    if (id === 'truck') {
      // cab
      ctx.fillStyle = shade(base, 0.08);
      rr(ctx, L * 0.12, -W / 2 + 1, L * 0.36, W - 2, 2);
      ctx.fill();
      glass(L * 0.3, L * 0.42, W * 0.78, W * 0.86);
      // cargo box
      const box = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
      box.addColorStop(0, '#9a9a96');
      box.addColorStop(0.4, '#d8d8d2');
      box.addColorStop(1, '#8a8a86');
      ctx.fillStyle = wreck ? '#262320' : box;
      rr(ctx, -L / 2 + 0.5, -W / 2 + 0.5, L * 0.6, W - 1, 1.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 8; i++) {
        const x = -L / 2 + (L * 0.6 * i) / 8;
        ctx.beginPath();
        ctx.moveTo(x, -W / 2 + 1.5);
        ctx.lineTo(x, W / 2 - 1.5);
        ctx.stroke();
      }
    } else if (id === 'van' || id === 'swat' || id === 'armored') {
      glass(L * 0.24, L * 0.36, W * 0.8, W * 0.88);
      const roof = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
      roof.addColorStop(0, shade(base, -0.15));
      roof.addColorStop(0.45, shade(base, 0.12));
      roof.addColorStop(1, shade(base, -0.2));
      ctx.fillStyle = roof;
      rr(ctx, -L * 0.47, -W * 0.42, L * 0.7, W * 0.84, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      if (id === 'armored') {
        ctx.fillStyle = '#c9a63c';
        ctx.fillRect(-L * 0.42, -1.2, L * 0.6, 2.4);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let i = 0; i < 4; i++) ctx.fillRect(-L * 0.38 + i * 7, -W * 0.32, 3, 3);
      }
      if (id === 'swat') {
        ctx.fillStyle = '#333';
        ctx.fillRect(-L * 0.3, -W * 0.3, 8, W * 0.6);
      }
    } else {
      const sporty = id === 'sports';
      const wsStart = sporty ? L * 0.02 : L * 0.08, wsEnd = sporty ? L * 0.2 : L * 0.25;
      glass(wsStart, wsEnd, W * 0.74, W * 0.86);
      // roof
      const roofCol = id === 'police' ? '#f0f0f0' : base;
      const roof = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
      roof.addColorStop(0, shade(roofCol, -0.2));
      roof.addColorStop(0.45, shade(roofCol, 0.15));
      roof.addColorStop(1, shade(roofCol, -0.25));
      ctx.fillStyle = roof;
      const roofX0 = sporty ? -L * 0.2 : -L * 0.24;
      rr(ctx, roofX0, -W * 0.39, wsStart - roofX0, W * 0.78, 2);
      ctx.fill();
      // rear window
      glass(-L * 0.36, roofX0, W * 0.72, W * 0.64);
      // side windows
      ctx.fillStyle = wreck ? '#111' : '#1c2a36';
      ctx.fillRect(roofX0, -W * 0.45, wsStart - roofX0, W * 0.06);
      ctx.fillRect(roofX0, W * 0.39, wsStart - roofX0, W * 0.06);
      // hood crease + panel lines
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(wsEnd + 1, -W * 0.2);
      ctx.lineTo(L / 2 - 2, -W * 0.16);
      ctx.moveTo(wsEnd + 1, W * 0.2);
      ctx.lineTo(L / 2 - 2, W * 0.16);
      ctx.moveTo(-L * 0.38, -W * 0.38);
      ctx.lineTo(-L * 0.38, W * 0.38);
      ctx.stroke();
      if (id === 'police' && !wreck) {
        // black/white livery
        ctx.fillStyle = 'rgba(240,240,240,0.95)';
        ctx.fillRect(roofX0 - 1, -W / 2 + 0.6, wsStart - roofX0 + 2, 2.2);
        ctx.fillRect(roofX0 - 1, W / 2 - 2.8, wsStart - roofX0 + 2, 2.2);
      }
      if (id === 'taxi' && !wreck) {
        ctx.fillStyle = '#222';
        rr(ctx, -L * 0.1, -3, 6, 6, 1);
        ctx.fill();
        ctx.fillStyle = '#ffeb7a';
        ctx.fillRect(-L * 0.1 + 1, -2, 4, 4);
        ctx.fillStyle = '#111';
        for (let i = 0; i < 6; i++) ctx.fillRect(-L / 2 + 3 + i * 3, i % 2 ? W / 2 - 1.6 : W / 2 - 3, 3, 1.4);
      }
      if (sporty && !wreck) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(-L / 2 + 1, -2.4, L - 2, 1.4);
        ctx.fillRect(-L / 2 + 1, 1, L - 2, 1.4);
        ctx.fillStyle = '#111';
        ctx.fillRect(-L / 2 + 0.5, -W * 0.38, 2.4, W * 0.76); // spoiler
      }
    }

    // mirrors
    ctx.fillStyle = shade(base, -0.3);
    const mx = id === 'truck' ? L * 0.38 : L * 0.16;
    ctx.fillRect(mx, -W / 2 - 1.6, 2.2, 1.8);
    ctx.fillRect(mx, W / 2 - 0.2, 2.2, 1.8);

    // lights
    if (!wreck) {
      ctx.fillStyle = '#fffbe6';
      rr(ctx, L / 2 - 2.4, -W / 2 + 1.6, 2, 4, 0.8);
      ctx.fill();
      rr(ctx, L / 2 - 2.4, W / 2 - 5.6, 2, 4, 0.8);
      ctx.fill();
      ctx.fillStyle = '#9a1010';
      ctx.fillRect(-L / 2 + 0.3, -W / 2 + 1.6, 1.6, 3.6);
      ctx.fillRect(-L / 2 + 0.3, W / 2 - 5.2, 1.6, 3.6);
    }

    // top-left specular highlight
    if (!wreck) {
      const hl = ctx.createLinearGradient(-L / 2, -W / 2, L / 2, W / 2);
      hl.addColorStop(0, 'rgba(255,255,255,0.18)');
      hl.addColorStop(0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      rr(ctx, -L / 2, -W / 2, L, W, radius);
      ctx.fill();
    }

    // damage: scratches & soot
    if (state !== 'ok') {
      let s = L * 31 + W;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      ctx.save();
      rr(ctx, -L / 2, -W / 2, L, W, radius);
      ctx.clip();
      const n = wreck ? 16 : 7;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgba(0,0,0,${wreck ? 0.45 : 0.28})`;
        ctx.beginPath();
        ctx.ellipse((rnd() - 0.5) * L, (rnd() - 0.5) * W, 2 + rnd() * 5, 1 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(220,220,220,0.35)';
      ctx.lineWidth = 0.4;
      for (let i = 0; i < 6; i++) {
        const x = (rnd() - 0.5) * L, y = (rnd() - 0.5) * W;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rnd() - 0.5) * 10, y + (rnd() - 0.5) * 4);
        ctx.stroke();
      }
      ctx.restore();
    }
    return c;
  });
}

/** Soft blurred shadow for a vehicle footprint (drawn rotated with the car). */
export function carShadow(m: VehicleModel): HTMLCanvasElement {
  return cached('carshadow:' + m.id, () => {
    const K = 2, P = 10;
    const [c, ctx] = makeCanvas((m.length + P * 2) * K, (m.width + P * 2) * K);
    ctx.scale(K, K);
    ctx.filter = 'blur(3px)';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    rr(ctx, P, P, m.length, m.width, m.width * 0.3);
    ctx.fill();
    return c;
  });
}

/** Tree canopy sprite (several lobes with shading). */
export function treeSprite(variant: number): HTMLCanvasElement {
  return cached('tree' + (variant % 3), () => {
    const S = 80, K = 2;
    const [c, ctx] = makeCanvas(S * K, S * K);
    ctx.scale(K, K);
    let s = variant * 101 + 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const lobes: [number, number, number][] = [];
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 14;
      lobes.push([40 + Math.cos(a) * d, 40 + Math.sin(a) * d, 13 + rnd() * 8]);
    }
    for (const [x, y, r] of lobes) {
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, '#5f9a45');
      g.addColorStop(0.6, '#3a7330');
      g.addColorStop(1, '#1f4a1f');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // leaf speckle
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 26;
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,170,80,0.35)' : 'rgba(10,40,10,0.3)';
      ctx.fillRect(40 + Math.cos(a) * d, 40 + Math.sin(a) * d, 1.5, 1.5);
    }
    return c;
  });
}
