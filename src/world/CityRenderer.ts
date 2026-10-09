// ---------------------------------------------------------------------------
// City rendering: ground tiles + pseudo-3D buildings (GTA2-like perspective:
// roofs are scaled away from the camera centre so walls become visible).
// ---------------------------------------------------------------------------

import { BLOCK, TILE, Tile } from '../config';
import { City } from './City';

type View = { x0: number; y0: number; x1: number; y1: number };

const PERSPECTIVE = 0.085;

export class CityRenderer {
  constructor(private city: City) {}

  drawGround(ctx: CanvasRenderingContext2D, v: View, time: number) {
    const c = this.city;
    const tx0 = Math.max(0, Math.floor(v.x0 / TILE)), ty0 = Math.max(0, Math.floor(v.y0 / TILE));
    const tx1 = Math.min(c.w - 1, Math.floor(v.x1 / TILE)), ty1 = Math.min(c.h - 1, Math.floor(v.y1 / TILE));

    // Outside of the map
    ctx.fillStyle = '#0d1b26';
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = c.get(tx, ty);
        const x = tx * TILE, y = ty * TILE;
        switch (t) {
          case Tile.Road: ctx.fillStyle = '#38393d'; break;
          case Tile.Sidewalk: ctx.fillStyle = (tx + ty) & 1 ? '#8e8c88' : '#878581'; break;
          case Tile.Plaza: ctx.fillStyle = (tx + ty) & 1 ? '#a69c8b' : '#9e9483'; break;
          case Tile.Grass:
          case Tile.Tree: ctx.fillStyle = (tx * 7 + ty * 3) % 5 === 0 ? '#3d7537' : '#427d3b'; break;
          default: ctx.fillStyle = '#26262a';
        }
        ctx.fillRect(x, y, TILE + 0.5, TILE + 0.5);
      }
    }

    // Kerbs: thin dark line between sidewalk and road
    ctx.fillStyle = '#5f5d59';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (c.get(tx, ty) !== Tile.Sidewalk) continue;
        const x = tx * TILE, y = ty * TILE;
        if (c.get(tx - 1, ty) === Tile.Road) ctx.fillRect(x, y, 3, TILE);
        if (c.get(tx + 1, ty) === Tile.Road) ctx.fillRect(x + TILE - 3, y, 3, TILE);
        if (c.get(tx, ty - 1) === Tile.Road) ctx.fillRect(x, y, TILE, 3);
        if (c.get(tx, ty + 1) === Tile.Road) ctx.fillRect(x, y + TILE - 3, TILE, 3);
      }
    }

    // Lane markings & zebra crossings
    ctx.fillStyle = '#d8c34a';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const mx = tx % BLOCK, my = ty % BLOCK;
        const x = tx * TILE, y = ty * TILE;
        if (mx === 0 && my >= 3 && my < BLOCK) {
          ctx.fillRect(x + TILE - 1.5, y + 8, 3, 22);
          ctx.fillRect(x + TILE - 1.5, y + 40, 3, 16);
        }
        if (my === 0 && mx >= 3 && mx < BLOCK) {
          ctx.fillRect(x + 8, y + TILE - 1.5, 22, 3);
          ctx.fillRect(x + 40, y + TILE - 1.5, 16, 3);
        }
      }
    }
    ctx.fillStyle = 'rgba(235,235,235,0.75)';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const mx = tx % BLOCK, my = ty % BLOCK;
        const x = tx * TILE, y = ty * TILE;
        if (mx < 2 && (my === 2 || my === BLOCK - 1)) {
          for (let i = 0; i < 5; i++) ctx.fillRect(x + 4 + i * 12, y + (my === 2 ? 6 : 34), 7, 24);
        }
        if (my < 2 && (mx === 2 || mx === BLOCK - 1)) {
          for (let i = 0; i < 5; i++) ctx.fillRect(x + (mx === 2 ? 6 : 34), y + 4 + i * 12, 24, 7);
        }
      }
    }

    // Tree trunks
    ctx.fillStyle = '#4a321e';
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++)
        if (c.get(tx, ty) === Tile.Tree) {
          ctx.beginPath();
          ctx.arc(tx * TILE + 32, ty * TILE + 32, 7, 0, Math.PI * 2);
          ctx.fill();
        }

    // Special locations: hospital & police station markers
    this.drawMarker(ctx, c.hospital.x, c.hospital.y, '#ff4d4d', '+', time);
    this.drawMarker(ctx, c.policeStation.x, c.policeStation.y, '#4d8bff', '★', time);
  }

  private drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, time: number) {
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(time * 3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 1);
    ctx.restore();
  }

  drawBuildings(ctx: CanvasRenderingContext2D, v: View, camX: number, camY: number) {
    const c = this.city;
    const margin = 260;
    for (const b of c.buildings) {
      const x0 = b.x * TILE, y0 = b.y * TILE, x1 = (b.x + b.w) * TILE, y1 = (b.y + b.h) * TILE;
      if (x1 < v.x0 - margin || x0 > v.x1 + margin || y1 < v.y0 - margin || y0 > v.y1 + margin) continue;
      const s = 1 + b.height * PERSPECTIVE;
      const rx = (x: number) => camX + (x - camX) * s;
      const ry = (y: number) => camY + (y - camY) * s;
      const X0 = rx(x0), Y0 = ry(y0), X1 = rx(x1), Y1 = ry(y1);

      if (b.kind === 'fountain') {
        ctx.fillStyle = '#c9c1b0';
        ctx.fillRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
        ctx.fillStyle = b.color;
        ctx.fillRect(x0 + 4, y0 + 4, x1 - x0 - 8, y1 - y0 - 8);
        ctx.fillStyle = b.roof;
        ctx.beginPath();
        ctx.arc((x0 + x1) / 2, (y0 + y1) / 2, 16, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      // walls (near sides become visible, far sides are hidden under the roof)
      const wall = (ax: number, ay: number, bx: number, by: number, AX: number, AY: number, BX: number, BY: number, shade: number) => {
        ctx.fillStyle = shadeColor(b.color, shade);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.lineTo(BX, BY);
        ctx.lineTo(AX, AY);
        ctx.closePath();
        ctx.fill();
      };
      wall(x0, y0, x1, y0, X0, Y0, X1, Y0, -0.05); // north
      wall(x0, y1, x1, y1, X0, Y1, X1, Y1, -0.35); // south
      wall(x0, y0, x0, y1, X0, Y0, X0, Y1, -0.2); // west
      wall(x1, y0, x1, y1, X1, Y0, X1, Y1, -0.25); // east

      // window stripes on walls facing camera
      ctx.fillStyle = 'rgba(255,230,140,0.13)';
      if (Y1 > y1) for (let i = 0; i < b.w * 2; i++) {
        const fx = x0 + (i + 0.5) * (TILE / 2);
        const FX = rx(fx);
        ctx.beginPath();
        ctx.moveTo(fx - 5, y1);
        ctx.lineTo(fx + 5, y1);
        ctx.lineTo(FX + 5 * s, Y1);
        ctx.lineTo(FX - 5 * s, Y1);
        ctx.fill();
      }

      // roof
      ctx.fillStyle = b.roof;
      ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
      ctx.strokeStyle = shadeColor(b.roof, -0.3);
      ctx.lineWidth = 3;
      ctx.strokeRect(X0 + 1.5, Y0 + 1.5, X1 - X0 - 3, Y1 - Y0 - 3);

      // roof details (AC units, vents) – deterministic per building
      let sd = b.seed;
      const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      const n = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const w = 10 + rnd() * 18, h = 10 + rnd() * 18;
        const px = X0 + 8 + rnd() * Math.max(1, X1 - X0 - w - 16), py = Y0 + 8 + rnd() * Math.max(1, Y1 - Y0 - h - 16);
        ctx.fillStyle = shadeColor(b.roof, -0.18);
        ctx.fillRect(px, py, w, h);
        ctx.fillStyle = shadeColor(b.roof, 0.12);
        ctx.fillRect(px + 2, py + 2, w - 4, h - 4);
      }
    }

    // Tree canopies (slightly elevated)
    const tx0 = Math.max(0, Math.floor(v.x0 / TILE)), ty0 = Math.max(0, Math.floor(v.y0 / TILE));
    const tx1 = Math.min(c.w - 1, Math.floor(v.x1 / TILE)), ty1 = Math.min(c.h - 1, Math.floor(v.y1 / TILE));
    const s = 1 + 0.5 * PERSPECTIVE;
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        if (c.get(tx, ty) !== Tile.Tree) continue;
        const cx = camX + (tx * TILE + 32 - camX) * s, cy = camY + (ty * TILE + 32 - camY) * s;
        ctx.fillStyle = '#245c25';
        ctx.beginPath();
        ctx.arc(cx, cy, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2f7a2f';
        ctx.beginPath();
        ctx.arc(cx - 6, cy - 6, 19, 0, Math.PI * 2);
        ctx.fill();
      }
  }
}

const shadeCache = new Map<string, string>();
export function shadeColor(hex: string, amt: number): string {
  const key = hex + amt;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  } else {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  }
  const out = `rgb(${r | 0},${g | 0},${b | 0})`;
  shadeCache.set(key, out);
  return out;
}
