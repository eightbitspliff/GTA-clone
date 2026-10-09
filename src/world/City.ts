// ---------------------------------------------------------------------------
// City / tilemap manager: procedural grid city, tile queries, collision,
// traffic lane geometry and a shared BFS flow field for pursuit AI.
// ---------------------------------------------------------------------------

import { BLOCK, FactionId, MAP_TILES, NUM_BLOCKS, TILE, Tile } from '../config';
import { Vec, clamp, seededRng } from '../core/math';

export interface Building {
  x: number; // tiles
  y: number;
  w: number;
  h: number;
  height: number;
  color: string;
  roof: string;
  kind: 'house' | 'fountain';
  seed: number;
}

/** Cardinal directions: 0=E, 1=S, 2=W, 3=N */
export const DIRS: readonly Vec[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
export const isVertical = (d: number) => d === 1 || d === 3;

export interface LaneSpot {
  x: number;
  y: number;
  dir: number;
  road: number;
  next: number;
}

export interface SpecialPoint {
  x: number;
  y: number;
}

const BUILDING_COLORS = [
  ['#5a5550', '#7d766e'], ['#4b5560', '#6f7c8a'], ['#5e4b45', '#86685e'], ['#4e5a4a', '#6f8068'],
  ['#625a6e', '#857a96'], ['#3f4a55', '#5d6d7c'], ['#6b5b44', '#94805f'], ['#474747', '#686868'],
];

export class City {
  readonly w = MAP_TILES;
  readonly h = MAP_TILES;
  tiles: Uint8Array;
  buildings: Building[] = [];
  payphones: (SpecialPoint & { faction: FactionId })[] = [];
  hospital: SpecialPoint = { x: 0, y: 0 };
  policeStation: SpecialPoint = { x: 0, y: 0 };
  pickupSpots: SpecialPoint[] = [];
  /** Street lamps: position of the pole and the lit spot over the road. */
  lamps: { x: number; y: number; lx: number; ly: number }[] = [];
  /** Spray shops: drive in to lose the cops and repair the car. */
  sprayShops: SpecialPoint[] = [];

  private flow: Int32Array;
  private queue: Int32Array;
  flowTx = -1;
  flowTy = -1;

  constructor(seed = 1337) {
    this.tiles = new Uint8Array(this.w * this.h);
    this.flow = new Int32Array(this.w * this.h);
    this.queue = new Int32Array(this.w * this.h);
    this.generate(seededRng(seed));
  }

  // --- generation -----------------------------------------------------------

  private generate(rng: () => number) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const mx = x % BLOCK, my = y % BLOCK;
        let t: Tile;
        if (mx < 2 || my < 2) t = Tile.Road;
        else if (mx === 2 || mx === BLOCK - 1 || my === 2 || my === BLOCK - 1) t = Tile.Sidewalk;
        else t = Tile.Grass;
        this.tiles[y * this.w + x] = t;
      }
    }

    for (let by = 0; by < NUM_BLOCKS; by++) {
      for (let bx = 0; bx < NUM_BLOCKS; bx++) {
        const x0 = bx * BLOCK + 3, y0 = by * BLOCK + 3, size = BLOCK - 4;
        const r = rng();
        if (r < 0.1) {
          // Park with trees
          for (let i = 0; i < 9; i++) {
            const tx = x0 + 1 + Math.floor(rng() * (size - 2)), ty = y0 + 1 + Math.floor(rng() * (size - 2));
            this.set(tx, ty, Tile.Tree);
          }
        } else if (r < 0.18) {
          // Plaza with fountain
          this.fill(x0, y0, size, size, Tile.Plaza);
          this.addBuilding(x0 + 4, y0 + 4, 2, 2, 0.12, ['#2c6e9e', '#5fb7e8'], 'fountain', rng);
        } else {
          this.split(x0, y0, size, size, 0, rng);
        }
      }
    }
    // Draw tall buildings last so their roofs overlap lower neighbours.
    this.buildings.sort((a, b) => a.height - b.height);

    // Special locations
    const third = this.w / 3;
    for (let f = 0; f < 3; f++) {
      const p = this.findTileNear((f + 0.5) * third * TILE, (this.h * 0.5 + (f - 1) * 8) * TILE, Tile.Sidewalk);
      this.payphones.push({ ...p, faction: f as FactionId });
    }
    this.hospital = this.findTileNear(this.w * 0.5 * TILE, this.h * 0.25 * TILE, Tile.Sidewalk);
    this.policeStation = this.findTileNear(this.w * 0.5 * TILE, this.h * 0.8 * TILE, Tile.Sidewalk);

    // Street lamps on sidewalks next to roads
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        if (this.get(tx, ty) !== Tile.Sidewalk || (tx + ty) % 3 !== 0) continue;
        const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
        const n = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) => this.get(tx + dx, ty + dy) === Tile.Road);
        if (!n) continue;
        this.lamps.push({ x: cx + n[0] * 24, y: cy + n[1] * 24, lx: cx + n[0] * 58, ly: cy + n[1] * 58 });
      }
    }

    // Spray shops (one per district, plus one central)
    const shopAt = [[0.17, 0.75], [0.5, 0.55], [0.83, 0.3], [0.5, 0.08]];
    for (const [fx, fy] of shopAt) this.sprayShops.push(this.findTileNear(fx * this.w * TILE, fy * this.h * TILE, Tile.Sidewalk));

    for (let i = 0; i < 400 && this.pickupSpots.length < 34; i++) {
      const tx = Math.floor(rng() * this.w), ty = Math.floor(rng() * this.h);
      const t = this.get(tx, ty);
      if (t === Tile.Sidewalk || t === Tile.Plaza || t === Tile.Grass) {
        const p = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
        if (this.pickupSpots.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 500)) this.pickupSpots.push(p);
      }
    }
  }

  private split(x: number, y: number, w: number, h: number, depth: number, rng: () => number) {
    if (depth < 3 && (w >= 7 || h >= 7) && rng() < 0.85) {
      if (w >= h) {
        const s = 3 + Math.floor(rng() * (w - 6));
        this.fill(x + s, y, 1, h, Tile.Plaza);
        this.split(x, y, s, h, depth + 1, rng);
        this.split(x + s + 1, y, w - s - 1, h, depth + 1, rng);
      } else {
        const s = 3 + Math.floor(rng() * (h - 6));
        this.fill(x, y + s, w, 1, Tile.Plaza);
        this.split(x, y, w, s, depth + 1, rng);
        this.split(x, y + s + 1, w, h - s - 1, depth + 1, rng);
      }
      return;
    }
    const c = BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)];
    this.addBuilding(x, y, w, h, 0.55 + rng() * 1.25, c, 'house', rng);
  }

  private addBuilding(x: number, y: number, w: number, h: number, height: number, c: string[], kind: Building['kind'], rng: () => number) {
    this.fill(x, y, w, h, Tile.Building);
    this.buildings.push({ x, y, w, h, height, color: c[0], roof: c[1], kind, seed: Math.floor(rng() * 1e9) });
  }

  private fill(x: number, y: number, w: number, h: number, t: Tile) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, t);
  }

  private set(tx: number, ty: number, t: Tile) {
    if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.tiles[ty * this.w + tx] = t;
  }

  private findTileNear(px: number, py: number, type: Tile): SpecialPoint {
    const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
    for (let r = 0; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.get(cx + dx, cy + dy) === type) return { x: (cx + dx + 0.5) * TILE, y: (cy + dy + 0.5) * TILE };
        }
      }
    }
    return { x: px, y: py };
  }

  // --- queries --------------------------------------------------------------

  get(tx: number, ty: number): Tile {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return Tile.Building;
    return this.tiles[ty * this.w + tx];
  }

  tileAt(px: number, py: number): Tile {
    return this.get(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  isSolidTile(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    return t === Tile.Building || t === Tile.Tree;
  }

  isSolidAt(px: number, py: number): boolean {
    return this.isSolidTile(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  isWalkTile(t: Tile) {
    return t === Tile.Sidewalk || t === Tile.Plaza || t === Tile.Grass;
  }

  district(px: number): FactionId {
    return clamp(Math.floor((px / TILE / this.w) * 3), 0, 2) as FactionId;
  }

  /** Push a circle out of solid tiles. Returns the accumulated contact normal (0,0 if no hit). */
  collideCircle(p: Vec, r: number): Vec {
    let nx = 0, ny = 0;
    const minTx = Math.floor((p.x - r) / TILE), maxTx = Math.floor((p.x + r) / TILE);
    const minTy = Math.floor((p.y - r) / TILE), maxTy = Math.floor((p.y + r) / TILE);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (!this.isSolidTile(tx, ty)) continue;
        const x0 = tx * TILE, y0 = ty * TILE;
        const cx = clamp(p.x, x0, x0 + TILE), cy = clamp(p.y, y0, y0 + TILE);
        const dx = p.x - cx, dy = p.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = r - d;
          p.x += (dx / d) * push;
          p.y += (dy / d) * push;
          nx += dx / d;
          ny += dy / d;
        } else {
          // Center inside tile: push out along the axis of least penetration.
          const l = p.x - x0, rr = x0 + TILE - p.x, t = p.y - y0, b = y0 + TILE - p.y;
          const m = Math.min(l, rr, t, b);
          if (m === l) { p.x = x0 - r; nx -= 1; }
          else if (m === rr) { p.x = x0 + TILE + r; nx += 1; }
          else if (m === t) { p.y = y0 - r; ny -= 1; }
          else { p.y = y0 + TILE + r; ny += 1; }
        }
      }
    }
    const l = Math.hypot(nx, ny);
    return l > 0 ? { x: nx / l, y: ny / l } : { x: 0, y: 0 };
  }

  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / 12);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isSolidAt(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }

  randomPointNear(px: number, py: number, minD: number, maxD: number, pred: (t: Tile) => boolean, tries = 40): Vec | null {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = px + Math.cos(a) * d, y = py + Math.sin(a) * d;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      if (pred(this.get(tx, ty))) return { x: (tx + 0.2 + Math.random() * 0.6) * TILE, y: (ty + 0.2 + Math.random() * 0.6) * TILE };
    }
    return null;
  }

  // --- traffic lanes -------------------------------------------------------

  /** Fixed coordinate of the lane that runs in direction `dir` on road number `road` (right-hand traffic). */
  laneCoord(dir: number, road: number): number {
    const base = road * BLOCK;
    switch (dir) {
      case 1: return (base + 0.5) * TILE; // S -> x
      case 3: return (base + 1.5) * TILE; // N -> x
      case 2: return (base + 0.5) * TILE; // W -> y
      default: return (base + 1.5) * TILE; // E -> y
    }
  }

  nodeCenter(i: number) {
    return (i * BLOCK + 1) * TILE;
  }

  /** Random spot on a lane segment (not inside an intersection) in the distance ring around a point. */
  randomLaneSpot(px: number, py: number, minD: number, maxD: number, tries = 30): LaneSpot | null {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = px + Math.cos(a) * d, y = py + Math.sin(a) * d;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      const mx = tx % BLOCK, my = ty % BLOCK;
      const vert = mx < 2, horiz = my < 2;
      if (vert === horiz) continue; // not road or intersection
      if (vert) {
        const road = Math.floor(tx / BLOCK);
        const dir = mx === 0 ? 1 : 3;
        const j0 = Math.floor(ty / BLOCK);
        const yy = clamp(y, (j0 * BLOCK + 2.6) * TILE, (j0 * BLOCK + BLOCK - 0.6) * TILE);
        return { x: this.laneCoord(dir, road), y: yy, dir, road, next: dir === 1 ? j0 + 1 : j0 };
      } else {
        const road = Math.floor(ty / BLOCK);
        const dir = my === 0 ? 2 : 0;
        const i0 = Math.floor(tx / BLOCK);
        const xx = clamp(x, (i0 * BLOCK + 2.6) * TILE, (i0 * BLOCK + BLOCK - 0.6) * TILE);
        return { x: xx, y: this.laneCoord(dir, road), dir, road, next: dir === 0 ? i0 + 1 : i0 };
      }
    }
    return null;
  }

  // --- flow field (BFS) -----------------------------------------------------

  /** Recompute distance field towards the given world position over non-solid tiles. */
  computeFlow(px: number, py: number) {
    const tx = clamp(Math.floor(px / TILE), 0, this.w - 1), ty = clamp(Math.floor(py / TILE), 0, this.h - 1);
    if (tx === this.flowTx && ty === this.flowTy) return;
    this.flowTx = tx;
    this.flowTy = ty;
    const f = this.flow, q = this.queue, W = this.w, H = this.h;
    f.fill(1 << 29);
    let head = 0, tail = 0;
    const start = ty * W + tx;
    f[start] = 0;
    q[tail++] = start;
    const tiles = this.tiles;
    while (head < tail) {
      const idx = q[head++];
      const x = idx % W, y = (idx / W) | 0;
      const nd = f[idx] + 1;
      for (let n = 0; n < 4; n++) {
        let ni: number;
        if (n === 0) { if (x === 0) continue; ni = idx - 1; }
        else if (n === 1) { if (x === W - 1) continue; ni = idx + 1; }
        else if (n === 2) { if (y === 0) continue; ni = idx - W; }
        else { if (y === H - 1) continue; ni = idx + W; }
        const t = tiles[ni];
        if (t === Tile.Building || t === Tile.Tree || f[ni] <= nd) continue;
        f[ni] = nd;
        q[tail++] = ni;
      }
    }
  }

  flowDist(px: number, py: number): number {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 1 << 29;
    return this.flow[ty * this.w + tx];
  }

  /** Follow the flow field `steps` tiles downhill from a world position; returns world target. */
  flowTarget(px: number, py: number, steps: number): Vec {
    let tx = clamp(Math.floor(px / TILE), 0, this.w - 1), ty = clamp(Math.floor(py / TILE), 0, this.h - 1);
    for (let s = 0; s < steps; s++) {
      const cur = this.flow[ty * this.w + tx];
      if (cur === 0) break;
      let best = cur, bx = tx, by = ty;
      const cand = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of cand) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        const v = this.flow[ny * this.w + nx];
        if (v < best) { best = v; bx = nx; by = ny; }
      }
      if (bx === tx && by === ty) break;
      tx = bx;
      ty = by;
    }
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }
}
