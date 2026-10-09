// ---------------------------------------------------------------------------
// Particles (sparks, smoke, fire, blood, flashes) and persistent ground decals
// (skid marks, blood pools, scorch marks).
// ---------------------------------------------------------------------------

import { rand } from '../core/math';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; grow: number;
  color: string; drag: number; high: boolean; glow: boolean;
}

interface Decal { kind: 'blood' | 'scorch' | 'oil'; x: number; y: number; r: number; a: number }
interface Skid { x1: number; y1: number; x2: number; y2: number; a: number }

const MAX_PARTICLES = 1400;
const MAX_SKIDS = 1500;
const MAX_DECALS = 120;

export class Particles {
  private list: Particle[] = [];
  private skids: Skid[] = [];
  private skidHead = 0;
  private decals: Decal[] = [];

  private add(p: Partial<Particle> & { x: number; y: number }) {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    const life = p.life ?? 0.5;
    this.list.push({ vx: 0, vy: 0, size: 3, grow: 0, color: '#fff', drag: 2, high: false, glow: false, ...p, life, max: life });
  }

  spark(x: number, y: number, n = 6, color = '#ffd27a') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(60, 260);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.1, 0.3), size: rand(1, 2.5), color, drag: 4, glow: true });
    }
  }

  blood(x: number, y: number, dirX = 0, dirY = 0, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(20, 120);
      this.add({ x, y, vx: Math.cos(a) * s + dirX * 120, vy: Math.sin(a) * s + dirY * 120, life: rand(0.2, 0.5), size: rand(1.5, 3), color: '#a01010', drag: 6 });
    }
  }

  smoke(x: number, y: number, dark = false) {
    this.add({ x: x + rand(-4, 4), y: y + rand(-4, 4), vx: rand(-15, 15), vy: rand(-25, -5), life: rand(0.8, 1.6), size: rand(5, 8), grow: 14, color: dark ? 'rgba(30,30,30,0.55)' : 'rgba(150,150,150,0.4)', drag: 0.5, high: true });
  }

  fire(x: number, y: number) {
    this.add({ x: x + rand(-6, 6), y: y + rand(-6, 6), vx: rand(-20, 20), vy: rand(-40, -10), life: rand(0.25, 0.5), size: rand(4, 8), grow: -6, color: Math.random() < 0.5 ? '#ff7a1a' : '#ffd23a', drag: 1, high: true, glow: true });
  }

  muzzle(x: number, y: number, angle: number, color = '#fff2a8') {
    this.add({ x: x + Math.cos(angle) * 4, y: y + Math.sin(angle) * 4, life: 0.06, size: 6, color, glow: true });
  }

  empBlast(x: number, y: number, r: number) {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      this.add({ x, y, vx: Math.cos(a) * r * 2.5, vy: Math.sin(a) * r * 2.5, life: 0.4, size: 3, color: '#7fe9ff', drag: 3, glow: true, high: true });
    }
    this.add({ x, y, life: 0.25, size: r * 0.6, grow: r * 2, color: 'rgba(120,230,255,0.35)', high: true, glow: true });
  }

  explosion(x: number, y: number, size = 1) {
    for (let i = 0; i < 26 * size; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(40, 280) * size;
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.8), size: rand(6, 14) * size, grow: -8, color: pick3('#ffef8a', '#ff9a1a', '#ff4d1a'), drag: 3, high: true, glow: true });
    }
    for (let i = 0; i < 16 * size; i++) this.smoke(x + rand(-20, 20), y + rand(-20, 20), true);
    this.spark(x, y, 20, '#ffcf5a');
    this.add({ x, y, life: 0.15, size: 60 * size, color: 'rgba(255,240,200,0.8)', high: true, glow: true });
    this.addDecal('scorch', x, y, 34 * size);
  }

  addDecal(kind: Decal['kind'], x: number, y: number, r: number) {
    if (this.decals.length >= MAX_DECALS) this.decals.shift();
    this.decals.push({ kind, x, y, r, a: 1 });
  }

  skid(x1: number, y1: number, x2: number, y2: number, a = 0.35) {
    const s = { x1, y1, x2, y2, a };
    if (this.skids.length < MAX_SKIDS) this.skids.push(s);
    else {
      this.skids[this.skidHead] = s;
      this.skidHead = (this.skidHead + 1) % MAX_SKIDS;
    }
  }

  update(dt: number) {
    for (const p of this.list) {
      p.life -= dt;
      const f = Math.max(0, 1 - p.drag * dt);
      p.vx *= f;
      p.vy *= f;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size = Math.max(0.1, p.size + p.grow * dt);
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  drawDecals(ctx: CanvasRenderingContext2D, v: { x0: number; y0: number; x1: number; y1: number }) {
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(15,15,15,0.35)';
    ctx.beginPath();
    for (const s of this.skids) {
      if (s.x1 < v.x0 || s.x1 > v.x1 || s.y1 < v.y0 || s.y1 > v.y1) continue;
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();
    for (const d of this.decals) {
      if (d.x < v.x0 - d.r || d.x > v.x1 + d.r || d.y < v.y0 - d.r || d.y > v.y1 + d.r) continue;
      if (d.kind === 'blood') ctx.fillStyle = 'rgba(110,0,0,0.75)';
      else if (d.kind === 'scorch') ctx.fillStyle = 'rgba(10,10,10,0.55)';
      else ctx.fillStyle = 'rgba(20,20,30,0.5)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r, d.r * 0.8, (d.x * 13) % 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw(ctx: CanvasRenderingContext2D, high: boolean) {
    for (const p of this.list) {
      if (p.high !== high) continue;
      const t = p.life / p.max;
      ctx.globalAlpha = Math.min(1, t * 1.5);
      if (p.glow) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }
}

function pick3(a: string, b: string, c: string) {
  const r = Math.random();
  return r < 0.33 ? a : r < 0.66 ? b : c;
}
