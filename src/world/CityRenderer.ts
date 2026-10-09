// ---------------------------------------------------------------------------
// City rendering.
//  * Ground is rendered into cached chunks (textures, road wear, markings,
//    kerbs, props, ambient occlusion and baked building/tree shadows).
//  * Buildings use a GTA2-like perspective: roofs are scaled away from the
//    camera centre so facades become visible; facades get window rows that
//    light up at night, roofs get gravel, parapets and rooftop equipment.
// ---------------------------------------------------------------------------

import { BLOCK, TILE, Tile } from '../config';
import {
  SUN, asphaltTexture, grassTexture, gravelTexture, hash, makeCanvas, plazaTexture, shade, sidewalkTexture, treeSprite, worldPattern,
} from '../render/Textures';
import { Building, City } from './City';

type View = { x0: number; y0: number; x1: number; y1: number };

const PERSPECTIVE = 0.085;
const CHUNK_TILES = 8;
const CHUNK_PX = CHUNK_TILES * TILE;
const RS = 1.5; // chunk render scale (pixels per world unit)
const MAX_CHUNKS = 56;
const SHADOW_LEN = 70; // world px of shadow per unit of building height

interface Chunk { canvas: HTMLCanvasElement; used: number }

const ROOF_RS = 1.25;
const MAX_ROOFS = 70;

export class CityRenderer {
  private chunks = new Map<number, Chunk>();
  private frame = 0;
  private gravel: CanvasPattern | null = null;
  private roofs = new Map<Building, Chunk>();

  constructor(private city: City) {}

  // --- ground -------------------------------------------------------------------

  drawGround(ctx: CanvasRenderingContext2D, v: View, time: number) {
    this.frame++;
    const mapPx = this.city.w * TILE;
    if (v.x0 < 0 || v.y0 < 0 || v.x1 > mapPx || v.y1 > mapPx) {
      ctx.fillStyle = '#0b1218';
      ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    }
    const maxC = Math.ceil(this.city.w / CHUNK_TILES);
    const cx0 = Math.max(0, Math.floor(v.x0 / CHUNK_PX)), cy0 = Math.max(0, Math.floor(v.y0 / CHUNK_PX));
    const cx1 = Math.min(maxC - 1, Math.floor(v.x1 / CHUNK_PX)), cy1 = Math.min(maxC - 1, Math.floor(v.y1 / CHUNK_PX));
    let built = 0;
    // unsmoothed blits are several times cheaper and the textures are noisy anyway
    ctx.imageSmoothingEnabled = false;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * 1000 + cx;
        let ch = this.chunks.get(key);
        if (!ch && built < 4) {
          ch = { canvas: this.renderChunk(cx, cy), used: 0 };
          this.chunks.set(key, ch);
          built++;
        }
        if (ch) {
          ch.used = this.frame;
          ctx.drawImage(ch.canvas, cx * CHUNK_PX, cy * CHUNK_PX, CHUNK_PX, CHUNK_PX);
        } else {
          ctx.fillStyle = '#3a3b3e';
          ctx.fillRect(cx * CHUNK_PX, cy * CHUNK_PX, CHUNK_PX, CHUNK_PX);
        }
      }
    }
    ctx.imageSmoothingEnabled = true;
    if (this.chunks.size > MAX_CHUNKS) {
      const sorted = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < sorted.length - MAX_CHUNKS; i++) this.chunks.delete(sorted[i][0]);
    }

    this.drawSprayShops(ctx, v, time);
    this.drawMarker(ctx, this.city.hospital.x, this.city.hospital.y, '#ff4d4d', '+', time);
    this.drawMarker(ctx, this.city.policeStation.x, this.city.policeStation.y, '#4d8bff', '★', time);
  }

  /** Pre-build chunks around a point (avoids pop-in on start / respawn). */
  prewarm(x: number, y: number, radius: number) {
    const maxC = Math.ceil(this.city.w / CHUNK_TILES);
    const c0x = Math.max(0, Math.floor((x - radius) / CHUNK_PX)), c1x = Math.min(maxC - 1, Math.floor((x + radius) / CHUNK_PX));
    const c0y = Math.max(0, Math.floor((y - radius) / CHUNK_PX)), c1y = Math.min(maxC - 1, Math.floor((y + radius) / CHUNK_PX));
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const key = cy * 1000 + cx;
        if (!this.chunks.has(key)) this.chunks.set(key, { canvas: this.renderChunk(cx, cy), used: this.frame });
      }
  }

  private renderChunk(cx: number, cy: number): HTMLCanvasElement {
    const c = this.city;
    const [canvas, ctx] = makeCanvas(CHUNK_PX * RS, CHUNK_PX * RS);
    const ox = cx * CHUNK_PX, oy = cy * CHUNK_PX;
    ctx.setTransform(RS, 0, 0, RS, -ox * RS, -oy * RS);

    const pats = {
      [Tile.Road]: worldPattern(ctx, asphaltTexture()),
      [Tile.Sidewalk]: worldPattern(ctx, sidewalkTexture()),
      [Tile.Plaza]: worldPattern(ctx, plazaTexture()),
      [Tile.Grass]: worldPattern(ctx, grassTexture()),
    } as Record<number, CanvasPattern>;

    const tx0 = cx * CHUNK_TILES, ty0 = cy * CHUNK_TILES;
    const tx1 = tx0 + CHUNK_TILES - 1, ty1 = ty0 + CHUNK_TILES - 1;

    // 1. base tiles
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = c.get(tx, ty);
        const x = tx * TILE, y = ty * TILE;
        if (tx >= c.w || ty >= c.h) {
          ctx.fillStyle = '#0b1218';
        } else if (t === Tile.Building) ctx.fillStyle = '#1c1c1e';
        else ctx.fillStyle = pats[t === Tile.Tree ? Tile.Grass : t];
        ctx.fillRect(x, y, TILE, TILE);
      }
    }

    // 2. road wear: patches, cracks, oil, manholes
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (c.get(tx, ty) !== Tile.Road) continue;
        const x = tx * TILE, y = ty * TILE;
        const r = (k: number) => hash(tx, ty, k);
        if (r(1) < 0.12) {
          ctx.fillStyle = `rgba(${r(2) < 0.5 ? '0,0,0' : '255,255,255'},0.05)`;
          ctx.fillRect(x + r(3) * 30, y + r(4) * 30, 20 + r(5) * 30, 16 + r(6) * 30);
        }
        if (r(7) < 0.35) {
          ctx.fillStyle = 'rgba(10,10,12,0.22)';
          ctx.beginPath();
          ctx.ellipse(x + 32 + (r(8) - 0.5) * 20, y + 32 + (r(9) - 0.5) * 20, 6 + r(10) * 9, 4 + r(11) * 6, r(12) * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (r(13) < 0.3) {
          ctx.strokeStyle = 'rgba(15,15,15,0.45)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          let px = x + r(14) * TILE, py = y + r(15) * TILE;
          ctx.moveTo(px, py);
          for (let k = 0; k < 6; k++) {
            px += (hash(tx, ty, 20 + k) - 0.5) * 16;
            py += (hash(tx, ty, 30 + k) - 0.5) * 16;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        if (r(40) < 0.035) {
          const mx = x + 20 + r(41) * 24, my = y + 20 + r(42) * 24;
          ctx.fillStyle = '#2a2a2c';
          ctx.beginPath();
          ctx.arc(mx, my, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#4a4a4c';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 0.6;
          for (let k = -6; k <= 6; k += 3) {
            ctx.beginPath();
            ctx.moveTo(mx - 6, my + k);
            ctx.lineTo(mx + 6, my + k);
            ctx.stroke();
          }
        }
      }
    }

    // 3. lane markings, stop lines, zebra crossings (slightly worn)
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (c.get(tx, ty) !== Tile.Road) continue;
        const mx = tx % BLOCK, my = ty % BLOCK;
        const x = tx * TILE, y = ty * TILE;
        const wear = 0.65 + hash(tx, ty, 50) * 0.3;
        ctx.fillStyle = `rgba(222,190,70,${wear})`;
        if (mx === 0 && my >= 3) {
          ctx.fillRect(x + TILE - 1.5, y + 6, 3, 24);
          ctx.fillRect(x + TILE - 1.5, y + 38, 3, 20);
        }
        if (my === 0 && mx >= 3) {
          ctx.fillRect(x + 6, y + TILE - 1.5, 24, 3);
          ctx.fillRect(x + 38, y + TILE - 1.5, 20, 3);
        }
        ctx.fillStyle = `rgba(235,235,230,${wear})`;
        if (mx < 2 && (my === 2 || my === BLOCK - 1)) {
          for (let i = 0; i < 6; i++) ctx.fillRect(x + 3 + i * 10.5, y + (my === 2 ? 8 : 30), 6, 26);
          // stop line on the approaching lane
          if (my === 2 && mx === 1) ctx.fillRect(x + 2, y + 38, TILE - 4, 3);
          if (my === BLOCK - 1 && mx === 0) ctx.fillRect(x + 2, y + 23, TILE - 4, 3);
        }
        if (my < 2 && (mx === 2 || mx === BLOCK - 1)) {
          for (let i = 0; i < 6; i++) ctx.fillRect(x + (mx === 2 ? 8 : 30), y + 3 + i * 10.5, 26, 6);
          if (mx === 2 && my === 0) ctx.fillRect(x + 38, y + 2, 3, TILE - 4);
          if (mx === BLOCK - 1 && my === 1) ctx.fillRect(x + 23, y + 2, 3, TILE - 4);
        }
      }
    }

    // 4. kerbs + gutters + drains
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = c.get(tx, ty);
        if (t !== Tile.Sidewalk && t !== Tile.Plaza) continue;
        const x = tx * TILE, y = ty * TILE;
        const edges: [number, number, number, number, number, number][] = [];
        if (c.get(tx - 1, ty) === Tile.Road) edges.push([x, y, 4, TILE, -1, 0]);
        if (c.get(tx + 1, ty) === Tile.Road) edges.push([x + TILE - 4, y, 4, TILE, 1, 0]);
        if (c.get(tx, ty - 1) === Tile.Road) edges.push([x, y, TILE, 4, 0, -1]);
        if (c.get(tx, ty + 1) === Tile.Road) edges.push([x, y + TILE - 4, TILE, 4, 0, 1]);
        for (const [ex, ey, ew, eh, nx, ny] of edges) {
          ctx.fillStyle = '#b4b1aa';
          ctx.fillRect(ex, ey, ew, eh);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(ex + (nx > 0 ? ew : nx < 0 ? -2 : 0), ey + (ny > 0 ? eh : ny < 0 ? -2 : 0), nx ? 2 : ew, ny ? 2 : eh);
          if (hash(tx, ty, 60) < 0.18) {
            const gx = nx ? ex + (nx > 0 ? ew + 1 : -9) : x + 24, gy = ny ? ey + (ny > 0 ? eh + 1 : -9) : y + 24;
            ctx.fillStyle = '#1e1e20';
            ctx.fillRect(gx, gy, nx ? 8 : 16, ny ? 8 : 16);
          }
        }
        if (t === Tile.Sidewalk && hash(tx, ty, 61) < 0.03) {
          ctx.fillStyle = '#b82020';
          ctx.beginPath();
          ctx.arc(x + 32, y + 32, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (t === Tile.Plaza && hash(tx, ty, 62) < 0.12) {
          ctx.fillStyle = '#6b4a2a';
          ctx.fillRect(x + 18, y + 26, 28, 9);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(x + 18, y + 35, 28, 2);
        }
      }
    }

    // 5. grass details: darker fringe, flowers
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = c.get(tx, ty);
        if (t !== Tile.Grass && t !== Tile.Tree) continue;
        const x = tx * TILE, y = ty * TILE;
        for (let k = 0; k < 5; k++) {
          if (hash(tx, ty, 70 + k) < 0.5) continue;
          ctx.fillStyle = ['#e8d84a', '#e86a8a', '#f0f0f0', '#9a7ad8'][k % 4];
          ctx.fillRect(x + hash(tx, ty, 80 + k) * 60, y + hash(tx, ty, 90 + k) * 60, 2, 2);
        }
      }
    }

    // 6. street lamp poles
    for (const l of c.lamps) {
      if (l.x < ox - 40 || l.x > ox + CHUNK_PX + 40 || l.y < oy - 40 || l.y > oy + CHUNK_PX + 40) continue;
      ctx.strokeStyle = '#2b2d30';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(l.x + (l.lx - l.x) * 0.45, l.y + (l.ly - l.y) * 0.45);
      ctx.stroke();
      ctx.fillStyle = '#3a3c40';
      ctx.beginPath();
      ctx.arc(l.x, l.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d8d4c0';
      ctx.fillRect(l.x + (l.lx - l.x) * 0.45 - 2.5, l.y + (l.ly - l.y) * 0.45 - 2.5, 5, 5);
    }

    // 7. ambient occlusion around building bases
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 14 * RS;
    ctx.fillStyle = '#1c1c1e';
    for (const b of c.buildings) {
      if (!this.overlaps(b, ox - 30, oy - 30, CHUNK_PX + 60)) continue;
      ctx.fillRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
    }
    ctx.restore();

    // 8. baked shadows (buildings, trees, lamps)
    const [sc, sctx] = makeCanvas(canvas.width, canvas.height);
    sctx.setTransform(RS, 0, 0, RS, -ox * RS, -oy * RS);
    sctx.filter = `blur(${3 * RS}px)`;
    sctx.fillStyle = '#000';
    for (const b of c.buildings) {
      const len = b.height * SHADOW_LEN;
      if (!this.overlaps(b, ox - len - 20, oy - len - 20, CHUNK_PX + len * 2 + 40)) continue;
      const x0 = b.x * TILE, y0 = b.y * TILE, x1 = (b.x + b.w) * TILE, y1 = (b.y + b.h) * TILE;
      const sx = SUN.x * len, sy = SUN.y * len;
      sctx.beginPath();
      sctx.moveTo(x0, y0);
      sctx.lineTo(x1, y0);
      sctx.lineTo(x1 + sx, y0 + sy);
      sctx.lineTo(x1 + sx, y1 + sy);
      sctx.lineTo(x0 + sx, y1 + sy);
      sctx.lineTo(x0, y1);
      sctx.closePath();
      sctx.fill();
    }
    for (let ty = ty0 - 2; ty <= ty1 + 1; ty++)
      for (let tx = tx0 - 2; tx <= tx1 + 1; tx++)
        if (c.get(tx, ty) === Tile.Tree) {
          sctx.beginPath();
          sctx.arc(tx * TILE + 32 + SUN.x * 22, ty * TILE + 32 + SUN.y * 22, 28, 0, Math.PI * 2);
          sctx.fill();
        }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.42;
    ctx.drawImage(sc, 0, 0);
    ctx.globalAlpha = 1;
    return canvas;
  }

  private overlaps(b: Building, x: number, y: number, size: number) {
    const bx0 = b.x * TILE, by0 = b.y * TILE, bx1 = (b.x + b.w) * TILE, by1 = (b.y + b.h) * TILE;
    return bx1 > x && bx0 < x + size && by1 > y && by0 < y + size;
  }

  private drawSprayShops(ctx: CanvasRenderingContext2D, v: View, time: number) {
    for (const s of this.city.sprayShops) {
      if (s.x < v.x0 || s.x > v.x1 || s.y < v.y0 || s.y > v.y1) continue;
      ctx.save();
      ctx.fillStyle = 'rgba(20,20,22,0.85)';
      ctx.fillRect(s.x - 34, s.y - 34, 68, 68);
      ctx.strokeStyle = '#ff9a1a';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -time * 20;
      ctx.strokeRect(s.x - 30, s.y - 30, 60, 60);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff9a1a';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SPRAY', s.x, s.y - 6);
      ctx.fillText('$200', s.x, s.y + 8);
      ctx.restore();
    }
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

  // --- buildings --------------------------------------------------------------------

  drawBuildings(ctx: CanvasRenderingContext2D, v: View, camX: number, camY: number, time: number, night: number, detail = true) {
    const c = this.city;
    const margin = 260;

    for (const b of c.buildings) {
      const x0 = b.x * TILE, y0 = b.y * TILE, x1 = (b.x + b.w) * TILE, y1 = (b.y + b.h) * TILE;
      if (x1 < v.x0 - margin || x0 > v.x1 + margin || y1 < v.y0 - margin || y0 > v.y1 + margin) continue;
      if (b.kind === 'fountain') {
        this.drawFountain(ctx, x0, y0, x1, y1, time);
        continue;
      }
      const s = 1 + b.height * PERSPECTIVE;
      const X0 = camX + (x0 - camX) * s, Y0 = camY + (y0 - camY) * s;
      const X1 = camX + (x1 - camX) * s, Y1 = camY + (y1 - camY) * s;
      const floors = Math.max(2, Math.round(b.height * 5));

      // facades (only those facing the camera are visible; the far ones are under the roof)
      const fl = detail ? floors : 0;
      if (Y0 < y0) this.facade(ctx, b, x0, y0, x1, y0, X0, Y0, X1, Y0, -0.02, fl, night);
      if (Y1 > y1) this.facade(ctx, b, x0, y1, x1, y1, X0, Y1, X1, Y1, -0.3, fl, night);
      if (X0 < x0) this.facade(ctx, b, x0, y0, x0, y1, X0, Y0, X0, Y1, -0.12, fl, night);
      if (X1 > x1) this.facade(ctx, b, x1, y0, x1, y1, X1, Y0, X1, Y1, -0.22, fl, night);

      // roof (cached per building, scaled by perspective)
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.roofCanvas(b), X0, Y0, X1 - X0, Y1 - Y0);
      ctx.imageSmoothingEnabled = true;
    }
    if (this.roofs.size > MAX_ROOFS) {
      const sorted = [...this.roofs.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < sorted.length - MAX_ROOFS; i++) this.roofs.delete(sorted[i][0]);
    }

    // tree canopies (slightly elevated)
    const tx0 = Math.max(0, Math.floor(v.x0 / TILE)), ty0 = Math.max(0, Math.floor(v.y0 / TILE));
    const tx1 = Math.min(c.w - 1, Math.floor(v.x1 / TILE)), ty1 = Math.min(c.h - 1, Math.floor(v.y1 / TILE));
    const s = 1 + 0.45 * PERSPECTIVE;
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        if (c.get(tx, ty) !== Tile.Tree) continue;
        const cx = camX + (tx * TILE + 32 - camX) * s, cy = camY + (ty * TILE + 32 - camY) * s;
        const spr = treeSprite(tx * 7 + ty * 13);
        const sway = Math.sin(time * 0.8 + tx + ty) * 0.03;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(sway);
        ctx.drawImage(spr, -40, -40, 80, 80);
        ctx.restore();
      }
  }

  private facade(
    ctx: CanvasRenderingContext2D, b: Building,
    ax: number, ay: number, bx: number, by: number, AX: number, AY: number, BX: number, BY: number,
    tone: number, floors: number, night: number,
  ) {
    // wall with vertical gradient: dark at street level, lighter towards the top
    const g = ctx.createLinearGradient((ax + bx) / 2, (ay + by) / 2, (AX + BX) / 2, (AY + BY) / 2);
    g.addColorStop(0, shade(b.color, tone - 0.22));
    g.addColorStop(1, shade(b.color, tone + 0.1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(BX, BY);
    ctx.lineTo(AX, AY);
    ctx.closePath();
    ctx.fill();

    // window rows (dashed lines interpolated between base and roof edge)
    const depth = Math.hypot((AX + BX) / 2 - (ax + bx) / 2, (AY + BY) / 2 - (ay + by) / 2);
    if (depth < 8 || floors === 0) return;
    const lw = Math.min(6, (depth / floors) * 0.45);
    const wallLen = Math.hypot(bx - ax, by - ay);
    ctx.lineWidth = lw;
    for (let f = 0; f < floors; f++) {
      const t = (f + 0.55) / floors;
      const sx = ax + (AX - ax) * t, sy = ay + (AY - ay) * t;
      const ex = bx + (BX - bx) * t, ey = by + (BY - by) * t;
      const scale = Math.hypot(ex - sx, ey - sy) / wallLen;
      ctx.setLineDash([7 * scale, 7 * scale]);
      ctx.lineDashOffset = -3 * scale;
      ctx.strokeStyle = 'rgba(25,38,52,0.85)';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      if (night > 0.05) {
        // some windows lit at night
        const k = Math.floor(hash(b.seed & 1023, f, 3) * 5) + 2;
        ctx.setLineDash([7 * scale, 7 * scale + 14 * k * scale]);
        ctx.lineDashOffset = -3 * scale - 14 * scale * (b.seed % k);
        ctx.strokeStyle = `rgba(255,214,130,${0.85 * night})`;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // edge lines
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(AX, AY);
    ctx.moveTo(bx, by);
    ctx.lineTo(BX, BY);
    ctx.stroke();
  }

  private roofCanvas(b: Building): HTMLCanvasElement {
    let r = this.roofs.get(b);
    if (!r) {
      const w = b.w * TILE, h = b.h * TILE;
      const [canvas, ctx] = makeCanvas(w * ROOF_RS, h * ROOF_RS);
      ctx.scale(ROOF_RS, ROOF_RS);
      this.roof(ctx, b, w, h);
      r = { canvas, used: 0 };
      this.roofs.set(b, r);
    }
    r.used = this.frame;
    return r.canvas;
  }

  private roof(ctx: CanvasRenderingContext2D, b: Building, w: number, h: number) {
    ctx.fillStyle = b.roof;
    ctx.fillRect(0, 0, w, h);
    if (!this.gravel) this.gravel = ctx.createPattern(gravelTexture(), 'repeat')!;
    this.gravel.setTransform(new DOMMatrix().scaleSelf(0.5, 0.5));
    ctx.fillStyle = this.gravel;
    ctx.fillRect(0, 0, w, h);
    // subtle light falloff (sun from top-left)
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // parapet
    ctx.strokeStyle = shade(b.roof, 0.22);
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, w - 5, h - 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, w - 12, h - 12);

    // rooftop equipment
    let sd = b.seed;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const items = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < items; i++) {
      const kind = rnd();
      const iw = 12 + rnd() * 20, ih = 12 + rnd() * 20;
      const px = 10 + rnd() * Math.max(1, w - iw - 20), py = 10 + rnd() * Math.max(1, h - ih - 20);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      if (kind < 0.35) {
        // AC unit with fan
        ctx.fillRect(px + 4, py + 5, iw, ih);
        const ag = ctx.createLinearGradient(px, py, px + iw, py + ih);
        ag.addColorStop(0, '#c9ccd0');
        ag.addColorStop(1, '#7d8186');
        ctx.fillStyle = ag;
        ctx.fillRect(px, py, iw, ih);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, iw - 1, ih - 1);
        ctx.fillStyle = '#3a3d40';
        ctx.beginPath();
        ctx.arc(px + iw / 2, py + ih / 2, Math.min(iw, ih) * 0.32, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind < 0.55) {
        // water tank
        const r = Math.min(iw, ih) * 0.6;
        ctx.beginPath();
        ctx.arc(px + r + 5, py + r + 6, r, 0, Math.PI * 2);
        ctx.fill();
        const tg = ctx.createRadialGradient(px + r * 0.7, py + r * 0.7, 1, px + r, py + r, r);
        tg.addColorStop(0, '#a3866a');
        tg.addColorStop(1, '#5a4330');
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.arc(px + r, py + r, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind < 0.75) {
        // skylight
        ctx.fillRect(px + 2, py + 3, iw, ih);
        const sg = ctx.createLinearGradient(px, py, px + iw, py + ih);
        sg.addColorStop(0, '#9ec3dc');
        sg.addColorStop(0.5, '#4a6f8a');
        sg.addColorStop(1, '#2a4256');
        ctx.fillStyle = sg;
        ctx.fillRect(px, py, iw, ih);
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, iw, ih);
        ctx.beginPath();
        ctx.moveTo(px + iw / 2, py);
        ctx.lineTo(px + iw / 2, py + ih);
        ctx.stroke();
      } else {
        // stair hut
        ctx.fillRect(px + 6, py + 7, iw, ih);
        ctx.fillStyle = shade(b.roof, -0.15);
        ctx.fillRect(px, py, iw, ih);
        ctx.fillStyle = shade(b.roof, 0.1);
        ctx.fillRect(px + 2, py + 2, iw - 4, ih - 4);
      }
    }
    // vents
    for (let i = 0; i < 3; i++) {
      const vx = 12 + rnd() * (w - 24), vy = 12 + rnd() * (h - 24);
      ctx.fillStyle = '#555a5e';
      ctx.beginPath();
      ctx.arc(vx, vy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(vx, vy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFountain(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, time: number) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = (x1 - x0) / 2;
    ctx.fillStyle = '#b8b0a0';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.fill();
    const wg = ctx.createRadialGradient(cx - 10, cy - 10, 4, cx, cy, r);
    wg.addColorStop(0, '#6fc0e8');
    wg.addColorStop(1, '#1f5f8a');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const rr = ((time * 18 + i * 18) % 54) + 6;
      ctx.globalAlpha = 1 - rr / 60;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#d8d0c0';
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}
