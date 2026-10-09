import { clamp, lerp } from './math';

/** Smooth top-down follow camera with speed-dependent zoom and screen shake. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  private targetZoom = 1;
  private shakeAmt = 0;
  shakeX = 0;
  shakeY = 0;
  width = 1;
  height = 1;
  /** Base zoom depends on screen size so the visible area feels similar on all displays. */
  baseZoom = 1;

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.baseZoom = clamp(Math.min(w / 1280, h / 760), 0.6, 1.6);
  }

  snap(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /** Follow target position with velocity look-ahead; zoom out with speed (GTA2 style). */
  follow(tx: number, ty: number, vx: number, vy: number, speed01: number, dt: number) {
    const look = 0.45;
    const gx = tx + vx * look, gy = ty + vy * look;
    const k = 1 - Math.exp(-dt * 5);
    this.x = lerp(this.x, gx, k);
    this.y = lerp(this.y, gy, k);
    this.targetZoom = this.baseZoom * (1 - 0.32 * clamp(speed01, 0, 1));
    this.zoom = lerp(this.zoom, this.targetZoom, 1 - Math.exp(-dt * 2));

    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 30);
    this.shakeX = (Math.random() - 0.5) * this.shakeAmt;
    this.shakeY = (Math.random() - 0.5) * this.shakeAmt;
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(28, this.shakeAmt + amount);
  }

  apply(ctx: CanvasRenderingContext2D) {
    const z = this.zoom;
    ctx.setTransform(z, 0, 0, z, this.width / 2 - (this.x + this.shakeX) * z, this.height / 2 - (this.y + this.shakeY) * z);
  }

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.width / 2) / this.zoom + this.x, y: (sy - this.height / 2) / this.zoom + this.y };
  }

  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.zoom + this.width / 2, y: (wy - this.y) * this.zoom + this.height / 2 };
  }

  /** Visible world rect (with margin). */
  view(margin = 0) {
    const hw = this.width / 2 / this.zoom + margin, hh = this.height / 2 / this.zoom + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  isVisible(x: number, y: number, margin = 0) {
    const v = this.view(margin);
    return x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1;
  }
}
