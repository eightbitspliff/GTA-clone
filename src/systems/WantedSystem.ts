// ---------------------------------------------------------------------------
// Wanted system: crimes add "heat", heat maps to 0..5 stars. Staying out of
// police sight lets the level drop star by star (stars flash meanwhile).
// ---------------------------------------------------------------------------

import { CRIME, WANTED_MAX_HEAT, WANTED_THRESHOLDS } from '../config';
import type { Game } from '../core/Game';
import { dist2 } from '../core/math';

export class WantedSystem {
  heat = 0;
  unseen = 0;
  seen = false;
  private checkTimer = 0;
  private lastStars = 0;

  constructor(private g: Game) {}

  get stars(): number {
    let s = 0;
    for (let i = 1; i < WANTED_THRESHOLDS.length; i++) if (this.heat >= WANTED_THRESHOLDS[i]) s = i;
    return s;
  }

  get flashing() {
    return this.stars > 0 && this.unseen > 2;
  }

  /** Seconds out of sight needed to lose one star. */
  get escapeTime() {
    return 7 + this.stars * 2.5;
  }

  crime(amount: number) {
    if (this.g.state !== 'play') return;
    this.heat = Math.min(WANTED_MAX_HEAT, this.heat + amount);
    this.unseen = 0;
    const s = this.stars;
    if (s > this.lastStars) {
      this.g.message(`Fahndungslevel ${'★'.repeat(s)}`, '#ff5050');
      this.g.input.rumble(0.3, 0.6, 200);
    }
    this.lastStars = s;
  }

  onPlayerShot(x: number, y: number) {
    let copNear = false;
    for (const p of this.g.peds) {
      if (p.kind === 'cop' && p.alive && dist2(p.x, p.y, x, y) < 650 * 650) {
        copNear = true;
        break;
      }
    }
    this.crime(copNear ? CRIME.shot : CRIME.shot * 0.4);
  }

  clear() {
    this.heat = 0;
    this.unseen = 0;
    this.lastStars = 0;
  }

  update(dt: number) {
    const g = this.g;
    const stars = this.stars;
    this.lastStars = stars;
    if (stars === 0) {
      this.heat = Math.max(0, this.heat - dt * 3);
      this.unseen = 0;
      g.sound.setSiren(0);
      return;
    }

    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.25;
      this.seen = this.policeSeesPlayer();
    }
    if (this.seen) this.unseen = 0;
    else {
      this.unseen += dt;
      if (this.unseen > this.escapeTime) {
        this.heat = WANTED_THRESHOLDS[stars] - 1;
        this.unseen = 0;
        this.lastStars = this.stars;
        g.message(this.stars === 0 ? 'Die Polizei hat deine Spur verloren' : 'Fahndungslevel gesunken', '#9fd4ff');
      }
    }

    // Siren volume: nearest police car with siren
    let best = Infinity;
    for (const v of g.vehicles) if (v.siren) best = Math.min(best, dist2(v.x, v.y, g.playerX, g.playerY));
    g.sound.setSiren(best < Infinity ? Math.max(0, 1 - Math.sqrt(best) / 900) : 0);
  }

  private policeSeesPlayer(): boolean {
    const g = this.g;
    const px = g.playerX, py = g.playerY;
    for (const p of g.peds) {
      if (p.kind !== 'cop' || !p.alive) continue;
      const range = p.vehicle ? 620 : 480;
      if (dist2(p.x, p.y, px, py) > range * range) continue;
      if (g.city.lineOfSight(p.x, p.y, px, py)) return true;
    }
    return false;
  }
}
