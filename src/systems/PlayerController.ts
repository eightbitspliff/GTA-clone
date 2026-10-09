// ---------------------------------------------------------------------------
// Player controller: on-foot movement & aiming (mouse or right stick with
// light aim-assist), shooting, weapon switching, entering/leaving and
// driving vehicles (incl. drive-by and nitro).
// ---------------------------------------------------------------------------

import { CRIME, PLAYER_RUN, PLAYER_WALK, WEAPONS, WEAPON_ORDER } from '../config';
import type { Game } from '../core/Game';
import type { Controls } from '../core/Input';
import { angleDiff, clamp, dist, dist2 } from '../core/math';
import { Vehicle } from '../entities/Vehicle';

export class PlayerController {
  constructor(private g: Game) {}

  update(dt: number) {
    const g = this.g, p = g.player, c = g.controls;
    if (!p.alive) return;
    this.switchWeapons(c);
    if (c.interact) this.interact();
    if (p.vehicle) this.drive(c);
    else this.walk(dt, c);
  }

  private switchWeapons(c: Controls) {
    const p = this.g.player;
    const owned = WEAPON_ORDER.filter((w) => p.hasAmmo(w));
    let idx = owned.indexOf(p.weapon);
    if (idx < 0) idx = 0;
    if (c.weaponNext) p.weapon = owned[(idx + 1) % owned.length];
    if (c.weaponPrev) p.weapon = owned[(idx - 1 + owned.length) % owned.length];
    if (c.weaponSlot > 0) {
      const w = WEAPON_ORDER.find((id) => WEAPONS[id].slot === c.weaponSlot);
      if (w && p.hasAmmo(w)) p.weapon = w;
    }
    if (!p.hasAmmo()) {
      // auto-switch to the best weapon that still has ammo
      p.weapon = [...owned].reverse()[0] ?? 'fists';
    }
  }

  private aimAngle(c: Controls, fromX: number, fromY: number, fallback: number): number {
    const g = this.g;
    if (c.device === 'kbm') {
      const w = g.camera.screenToWorld(c.mouseX, c.mouseY);
      return Math.atan2(w.y - fromY, w.x - fromX);
    }
    const base = c.padAim ?? fallback;
    return this.aimAssist(fromX, fromY, base);
  }

  /** Controller aim assist: snap to the nearest threat inside a small cone. */
  private aimAssist(x: number, y: number, angle: number): number {
    const g = this.g;
    let best = 0.28, result = angle;
    for (const t of g.peds) {
      if (t === g.player || !t.alive || t.kind === 'civilian') continue;
      const d2 = dist2(x, y, t.x, t.y);
      if (d2 > 420 * 420) continue;
      const a = Math.atan2(t.y - y, t.x - x);
      const diff = Math.abs(angleDiff(angle, a));
      if (diff < best && g.city.lineOfSight(x, y, t.x, t.y)) {
        best = diff;
        result = a;
      }
    }
    return result;
  }

  private walk(dt: number, c: Controls) {
    const g = this.g, p = g.player;
    let mx = c.moveX, my = c.moveY;
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    const speed = p.stunTimer > 0 ? 0 : c.sprint ? PLAYER_RUN : PLAYER_WALK;
    if (p.stunTimer > 0) p.stunTimer -= dt;
    p.vx = mx * speed;
    p.vy = my * speed;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    g.city.collideCircle(p, p.radius);
    if (m > 0.1) p.walkPhase += dt * speed * 0.07;

    const moveAngle = m > 0.2 ? Math.atan2(my, mx) : p.angle;
    p.angle = this.aimAngle(c, p.x, p.y, moveAngle);

    if (c.fire) g.combat.fire(p, p.angle);
  }

  private drive(c: Controls) {
    const g = this.g, p = g.player, v = p.vehicle!;
    v.throttle = clamp(c.throttle - c.brake, -1, 1);
    v.steer = clamp(c.steer, -1, 1);
    v.handbrake = c.handbrake;
    if (c.nitro && v.nitro > 0.05 && !v.nitroOn && v.usable && v.empTimer <= 0) {
      v.nitroOn = true;
      g.sound.nitro();
      g.input.rumble(0.6, 0.2, 300);
    }
    if (!c.nitro) v.nitroOn = false;

    if (c.carFire && p.weapon !== 'fists') {
      const fallback = v.angle;
      const a = c.device === 'kbm' || c.padAim !== null ? this.aimAngle(c, v.x, v.y, fallback) : fallback;
      const off = v.model.length / 2 + 6;
      g.combat.fire(p, a, { x: v.x + Math.cos(a) * off, y: v.y + Math.sin(a) * off }, v);
    }
  }

  private interact() {
    const g = this.g, p = g.player;
    if (p.vehicle) {
      this.exitVehicle(false);
      return;
    }
    const phone = g.missions.phoneNear(p.x, p.y);
    if (phone) {
      g.missions.usePhone(phone);
      return;
    }
    let best: Vehicle | null = null, bestD = Infinity;
    for (const v of g.vehicles) {
      if (!v.usable) continue;
      const d = dist(p.x, p.y, v.x, v.y);
      if (d < v.model.length / 2 + 30 && d < bestD) {
        best = v;
        bestD = d;
      }
    }
    if (best) this.enterVehicle(best);
  }

  enterVehicle(v: Vehicle) {
    const g = this.g, p = g.player;
    if (v.driver && v.driver !== p) {
      const wasCop = v.driver.kind === 'cop';
      g.ai.ejectDriver(v, false, p);
      g.wanted.crime(wasCop ? CRIME.carjackCop : CRIME.carjack);
      g.message(wasCop ? 'Streifenwagen geklaut!' : 'Carjacking!', '#ffb347');
    }
    v.driver = p;
    v.traffic = null;
    v.siren = false;
    v.persistent = true;
    v.handbrake = false;
    p.vehicle = v;
    p.vx = p.vy = 0;
    g.message(`${v.model.name}`, '#ddd');
    g.missions.onEnterVehicle(v);
  }

  exitVehicle(force: boolean) {
    const g = this.g, p = g.player, v = p.vehicle;
    if (!v) return;
    if (!force && v.speed > 160) {
      g.message('Zu schnell zum Aussteigen!', '#ccc');
      return;
    }
    if (v.driftScore > 0) g.vehicleSys.bankDrift(v);
    const fx = v.fx, fy = v.fy;
    const sideOff = v.model.width / 2 + 12, longOff = v.model.length / 2 + 12;
    const candidates = [
      { x: v.x + fy * sideOff, y: v.y - fx * sideOff }, // left
      { x: v.x - fy * sideOff, y: v.y + fx * sideOff }, // right
      { x: v.x - fx * longOff, y: v.y - fy * longOff },
      { x: v.x + fx * longOff, y: v.y + fy * longOff },
    ];
    let spot = candidates.find((c) => !g.city.isSolidAt(c.x, c.y) && !g.vehicles.some((o) => o !== v && o.contains(c.x, c.y, 6)));
    if (!spot) spot = { x: v.x, y: v.y };
    p.x = spot.x;
    p.y = spot.y;
    g.city.collideCircle(p, p.radius);
    p.vehicle = null;
    v.driver = null;
    v.throttle = 0;
    v.steer = 0;
    v.nitroOn = false;
    v.handbrake = false;
  }
}
