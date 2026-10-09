// ---------------------------------------------------------------------------
// Day/night cycle + light map.
// The scene is multiplied with a light map that holds the ambient colour of
// the current time of day plus additive lights (street lamps, headlights,
// sirens, fires, explosions, muzzle flashes). A vignette finishes the frame.
// ---------------------------------------------------------------------------

import type { Game } from '../core/Game';
import { clamp } from '../core/math';
import { coneSprite, lightSprite, makeCanvas } from './Textures';

type RGB = [number, number, number];

/** Ambient colour keyframes by hour of day. */
const KEYS: [number, RGB][] = [
  [0, [46, 56, 100]],
  [4.5, [50, 60, 102]],
  [6, [190, 150, 160]],
  [7.2, [255, 250, 242]],
  [16.5, [255, 250, 240]],
  [18.3, [255, 196, 140]],
  [19.6, [130, 112, 150]],
  [20.8, [52, 62, 104]],
  [24, [46, 56, 100]],
];

/** Real seconds for one full in-game day. */
const DAY_SECONDS = 720;

export class Lighting {
  hour = 16.2;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private vignette: HTMLCanvasElement | null = null;
  private vw = 0;
  private vh = 0;

  constructor() {
    [this.canvas, this.ctx] = makeCanvas(4, 4);
  }

  update(dt: number) {
    this.hour = (this.hour + (dt * 24) / DAY_SECONDS) % 24;
  }

  ambient(): RGB {
    const h = this.hour;
    for (let i = 0; i < KEYS.length - 1; i++) {
      const [h0, c0] = KEYS[i], [h1, c1] = KEYS[i + 1];
      if (h >= h0 && h <= h1) {
        const t = (h - h0) / (h1 - h0);
        return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
      }
    }
    return KEYS[0][1];
  }

  /** 0 = full daylight, 1 = deep night. */
  get night(): number {
    const a = this.ambient();
    const lum = (a[0] + a[1] + a[2]) / 3 / 255;
    return clamp((0.93 - lum) / 0.62, 0, 1);
  }

  clock(): string {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private getVignette(w: number, h: number): HTMLCanvasElement {
    if (!this.vignette || this.vw !== w || this.vh !== h) {
      this.vw = w;
      this.vh = h;
      const [vc, vctx] = makeCanvas(w, h);
      const gr = vctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,0.42)');
      vctx.fillStyle = gr;
      vctx.fillRect(0, 0, w, h);
      this.vignette = vc;
    }
    return this.vignette;
  }

  /** Render the light map (half resolution, incl. vignette) and multiply it onto the frame. */
  apply(ctx: CanvasRenderingContext2D, g: Game) {
    const W = g.width, H = g.height;
    const high = g.quality === 'high';
    const night = this.night;
    const amb = this.ambient();
    const ambLum = (amb[0] + amb[1] + amb[2]) / 3;
    const dark = ambLum < 252;
    if (!dark) {
      // daytime: only the vignette, drawn 1:1 at device resolution (cheap)
      if (high) ctx.drawImage(this.getVignette(Math.round(W * g.dpr), Math.round(H * g.dpr)), 0, 0, W, H);
      return;
    }

    const LS = 0.5;
    const lw = Math.max(1, Math.round(W * LS)), lh = Math.max(1, Math.round(H * LS));
    if (this.canvas.width !== lw || this.canvas.height !== lh) {
      this.canvas.width = lw;
      this.canvas.height = lh;
    }
    const l = this.ctx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.globalAlpha = 1;
    l.fillStyle = `rgb(${amb[0] | 0},${amb[1] | 0},${amb[2] | 0})`;
    l.fillRect(0, 0, lw, lh);

    if (dark) {
      const cam = g.camera;
      const z = cam.zoom * LS;
      l.setTransform(z, 0, 0, z, lw / 2 - (cam.x + cam.shakeX) * z, lh / 2 - (cam.y + cam.shakeY) * z);
      l.globalCompositeOperation = 'lighter';
      const v = cam.view(200);
      const inView = (x: number, y: number) => x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1;

      if (night > 0.15) {
        const lamp = lightSprite(255, 196, 120);
        l.globalAlpha = clamp((night - 0.15) * 1.6, 0, 1) * 0.85;
        for (const lp of g.city.lamps) {
          if (!inView(lp.lx, lp.ly)) continue;
          l.drawImage(lamp, lp.lx - 105, lp.ly - 105, 210, 210);
        }
        const neon = lightSprite(255, 140, 40);
        for (const s of g.city.sprayShops) if (inView(s.x, s.y)) l.drawImage(neon, s.x - 80, s.y - 80, 160, 160);
        const red = lightSprite(255, 70, 70), blue = lightSprite(80, 130, 255);
        l.drawImage(red, g.city.hospital.x - 70, g.city.hospital.y - 70, 140, 140);
        l.drawImage(blue, g.city.policeStation.x - 70, g.city.policeStation.y - 70, 140, 140);
        // faint light around the player so they never vanish in the dark
        l.drawImage(lightSprite(150, 160, 190), g.playerX - 90, g.playerY - 90, 180, 180);
        l.globalAlpha = 1;
      }

      const cone = coneSprite();
      const tail = lightSprite(255, 30, 20);
      const fire = lightSprite(255, 140, 50);
      const sirenR = lightSprite(255, 40, 40), sirenB = lightSprite(50, 90, 255);
      const blink = Math.floor(g.time * 8) % 2 === 0;
      for (const veh of g.vehicles) {
        if (!inView(veh.x, veh.y)) continue;
        if (veh.burning > 0 || (veh.destroyed && veh.wreckTime < 10)) {
          const f = 0.8 + Math.random() * 0.4;
          const r = veh.burning > 0 ? 150 : 70;
          l.drawImage(fire, veh.x - r * f, veh.y - r * f, r * 2 * f, r * 2 * f);
        }
        if (night > 0.2 && veh.driver && !veh.destroyed && veh.empTimer <= 0) {
          l.save();
          l.translate(veh.x, veh.y);
          l.rotate(veh.angle);
          l.globalAlpha = clamp(night * 1.2, 0, 0.9);
          const fx = veh.model.length / 2 - 2;
          l.drawImage(cone, fx, -veh.model.width / 2 + 4 - 72, 230, 144);
          l.drawImage(cone, fx, veh.model.width / 2 - 4 - 72, 230, 144);
          l.globalAlpha = clamp(night, 0, 0.8) * (veh.throttle < 0 ? 1 : 0.5);
          l.drawImage(tail, -veh.model.length / 2 - 22, -22, 44, 44);
          l.restore();
        }
        if (veh.siren) {
          l.globalAlpha = 0.35 + night * 0.6;
          l.drawImage(blink ? sirenR : sirenB, veh.x - 110, veh.y - 110, 220, 220);
          l.globalAlpha = 1;
        }
      }
      // transient lights (explosions, muzzle flashes, EMP)
      for (const lt of g.particles.lights) {
        l.globalAlpha = clamp(lt.life / lt.max, 0, 1);
        l.drawImage(lightSprite(lt.r, lt.g, lt.b), lt.x - lt.radius, lt.y - lt.radius, lt.radius * 2, lt.radius * 2);
      }
      l.globalAlpha = 1;
    }

    // vignette baked into the light map
    if (high) {
      l.setTransform(1, 0, 0, 1, 0, 0);
      l.globalCompositeOperation = 'source-over';
      l.drawImage(this.getVignette(lw, lh), 0, 0);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = false; // smoothing the upscale is very expensive; lights are soft anyway
    ctx.drawImage(this.canvas, 0, 0, W, H);
    ctx.restore();

    // bloom-ish halos for lamp heads at night
    if (high && night > 0.3) {
      const cam = g.camera;
      const v = cam.view(40);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (night - 0.3) * 0.5;
      const halo = lightSprite(255, 210, 150);
      const r = 16 * cam.zoom;
      for (const lp of g.city.lamps) {
        const hx = lp.x + (lp.lx - lp.x) * 0.45, hy = lp.y + (lp.ly - lp.y) * 0.45;
        if (hx < v.x0 || hx > v.x1 || hy < v.y0 || hy > v.y1) continue;
        const p = cam.worldToScreen(hx, hy);
        ctx.drawImage(halo, p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }
}
