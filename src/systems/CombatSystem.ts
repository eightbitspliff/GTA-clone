// ---------------------------------------------------------------------------
// Combat: weapons, projectiles, melee, damage/death handling (blame tracking),
// explosions, EMP blasts and pickups.
// ---------------------------------------------------------------------------

import { CRIME, WEAPONS, WeaponId } from '../config';
import type { Game } from '../core/Game';
import { clamp, dist, dist2, rand } from '../core/math';
import { Ped } from '../entities/Ped';
import { Pickup } from '../entities/Pickup';
import { Vehicle } from '../entities/Vehicle';

type View = { x0: number; y0: number; x1: number; y1: number };
export type DamageCause = 'bullet' | 'melee' | 'car' | 'explosion';

const PICKUP_ROTATION: { kind: Pickup['kind']; weapon?: WeaponId; amount: number }[] = [
  { kind: 'weapon', weapon: 'pistol', amount: 24 },
  { kind: 'weapon', weapon: 'smg', amount: 90 },
  { kind: 'health', amount: 50 },
  { kind: 'weapon', weapon: 'shotgun', amount: 14 },
  { kind: 'armor', amount: 50 },
  { kind: 'weapon', weapon: 'emp', amount: 2 },
  { kind: 'weapon', weapon: 'smg', amount: 60 },
  { kind: 'cash', amount: 150 },
];

export class CombatSystem {
  constructor(private g: Game) {}

  /** Attempt to fire `shooter`'s current weapon in direction `angle`. */
  fire(shooter: Ped, angle: number, origin?: { x: number; y: number }, vehicle?: Vehicle | null): boolean {
    const g = this.g;
    if (shooter.cooldown > 0 || !shooter.alive || shooter.stunTimer > 0) return false;
    const w = WEAPONS[shooter.weapon];
    if (!shooter.hasAmmo()) return false;
    // NPCs fire slower than the player so firefights stay readable
    shooter.cooldown = (1 / w.rate) * (shooter.kind === 'player' ? 1 : shooter.kind === 'cop' ? 3 : 2.4);

    if (w.id === 'fists') {
      if (vehicle) return false;
      this.melee(shooter, angle);
      return true;
    }
    if (shooter.kind === 'player') shooter.ammo[w.id]--;

    const ox = origin ? origin.x : shooter.x + Math.cos(angle) * 12;
    const oy = origin ? origin.y : shooter.y + Math.sin(angle) * 12;
    for (let i = 0; i < w.pellets; i++) {
      const a = angle + (Math.random() - 0.5) * 2 * w.spread;
      const sp = w.speed * (w.pellets > 1 ? rand(0.85, 1.1) : 1);
      g.projectiles.push({
        x: ox, y: oy, px: ox, py: oy,
        vx: Math.cos(a) * sp + (vehicle ? vehicle.vx : 0),
        vy: Math.sin(a) * sp + (vehicle ? vehicle.vy : 0),
        life: w.range / w.speed, damage: w.damage, weapon: w.id,
        owner: shooter, ownerVehicle: vehicle ?? null, dead: false,
      });
    }
    g.particles.muzzle(ox, oy, angle, w.id === 'emp' ? '#8ff' : '#fff2a8');
    const d = dist(ox, oy, g.playerX, g.playerY);
    g.sound.shot(w.id, clamp(1 - d / 900, 0, 1));
    g.ai.onGunshot(ox, oy, shooter);
    if (shooter === g.player) {
      g.wanted.onPlayerShot(ox, oy);
      if (w.id === 'shotgun') {
        g.camera.shake(3);
        g.input.rumble(0.7, 0.3, 90);
      } else g.input.rumble(0.15, 0.25, 40);
    }
    return true;
  }

  private melee(shooter: Ped, angle: number) {
    const g = this.g;
    const hx = shooter.x + Math.cos(angle) * 14, hy = shooter.y + Math.sin(angle) * 14;
    for (const p of g.peds) {
      if (p === shooter || !p.alive || p.vehicle) continue;
      if (dist2(p.x, p.y, hx, hy) < 16 * 16) {
        this.damagePed(p, WEAPONS.fists.damage, shooter, 'melee');
        p.x += Math.cos(angle) * 6;
        p.y += Math.sin(angle) * 6;
        g.sound.punch();
        return;
      }
    }
  }

  update(dt: number) {
    const g = this.g;
    for (const p of g.peds) {
      if (p.cooldown > 0) p.cooldown -= dt;
    }
    this.updateProjectiles(dt);
    this.updatePickups(dt);
  }

  private updateProjectiles(dt: number) {
    const g = this.g;
    for (const pr of g.projectiles) {
      pr.px = pr.x;
      pr.py = pr.y;
      const len = Math.hypot(pr.vx, pr.vy) * dt;
      const steps = Math.max(1, Math.ceil(len / 8));
      const sx = (pr.vx * dt) / steps, sy = (pr.vy * dt) / steps;
      for (let s = 0; s < steps && !pr.dead; s++) {
        pr.x += sx;
        pr.y += sy;
        if (g.city.isSolidAt(pr.x, pr.y)) {
          pr.dead = true;
          if (pr.weapon === 'emp') this.emp(pr.x - sx, pr.y - sy, pr.owner);
          else g.particles.spark(pr.x - sx, pr.y - sy, 4);
          break;
        }
        for (const v of g.vehicles) {
          if (v === pr.ownerVehicle) continue;
          const r = v.model.length / 2 + 2;
          if (dist2(v.x, v.y, pr.x, pr.y) > r * r || !v.contains(pr.x, pr.y)) continue;
          pr.dead = true;
          if (pr.weapon === 'emp') this.emp(pr.x, pr.y, pr.owner);
          else {
            this.damageVehicle(v, pr.damage * 0.55, pr.owner);
            g.particles.spark(pr.x, pr.y, 5, '#fff');
          }
          break;
        }
        if (pr.dead) break;
        for (const p of g.peds) {
          if (!p.alive || p.vehicle || p === pr.owner) continue;
          const r = p.radius + 2;
          if (dist2(p.x, p.y, pr.x, pr.y) > r * r) continue;
          pr.dead = true;
          if (pr.weapon === 'emp') this.emp(pr.x, pr.y, pr.owner);
          else {
            const n = Math.hypot(pr.vx, pr.vy) || 1;
            g.particles.blood(pr.x, pr.y, pr.vx / n, pr.vy / n, 5);
            this.damagePed(p, pr.damage, pr.owner, 'bullet');
          }
          break;
        }
      }
      pr.life -= dt;
      if (pr.life <= 0 && !pr.dead) {
        pr.dead = true;
        if (pr.weapon === 'emp') this.emp(pr.x, pr.y, pr.owner);
      }
    }
    g.projectiles = g.projectiles.filter((p) => !p.dead);
  }

  // --- damage -----------------------------------------------------------------

  damagePed(p: Ped, amount: number, attacker: Ped | null, cause: DamageCause) {
    const g = this.g;
    if (!p.alive) return;
    if (p === g.player) {
      if (g.state !== 'play') return;
      // NPC gunfire is toned down against the player
      if (cause === 'bullet' && attacker && attacker !== p) amount *= attacker.kind === 'cop' ? 0.45 : 0.55;
      p.lastHurt = g.time;
      const absorbed = Math.min(p.armor, amount * 0.7);
      p.armor -= absorbed;
      amount -= absorbed;
      g.camera.shake(2 + amount * 0.1);
      g.input.rumble(0.5, 0.5, 120);
    }
    p.hp -= amount;
    if (attacker) p.lastAttacker = attacker;
    if (attacker === g.player && p !== g.player) {
      if (p.kind === 'cop' && cause === 'melee') g.wanted.crime(CRIME.punchCop);
      if (cause === 'car' && p.hp > 0) g.wanted.crime(CRIME.hitPed);
    }
    if (p.hp <= 0) this.killPed(p, attacker, cause);
    else g.ai.onPedHurt(p, attacker);
  }

  killPed(p: Ped, attacker: Ped | null, cause: DamageCause) {
    const g = this.g;
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.deadTime = 0;
    p.vx = p.vy = 0;
    g.particles.addDecal('blood', p.x + rand(-3, 3), p.y + rand(-3, 3), rand(9, 14));
    if (p === g.player) {
      g.playerDown('wasted');
      return;
    }
    if (attacker === g.player) {
      if (p.kind === 'civilian') g.wanted.crime(CRIME.killCivilian);
      else if (p.kind === 'cop') g.wanted.crime(CRIME.killCop);
      else if (p.kind === 'gang') g.wanted.crime(CRIME.killGang);
      g.factions.onPlayerKill(p);
      if (cause === 'car') g.message('Überfahren!', '#ccc');
    }
    g.missions.onKill(p);
    // loot drops
    if ((p.kind === 'gang' || p.kind === 'cop') && Math.random() < 0.55) {
      const w = p.weapon === 'fists' ? 'pistol' : p.weapon;
      this.dropPickup('weapon', p.x + rand(-8, 8), p.y + rand(-8, 8), w === 'smg' ? 30 : 12, w);
    } else if (Math.random() < 0.35) {
      this.dropPickup('cash', p.x + rand(-8, 8), p.y + rand(-8, 8), 10 + Math.floor(Math.random() * 40));
    }
    g.ai.onPedKilled(p, attacker);
  }

  damageVehicle(v: Vehicle, amount: number, attacker: Ped | null) {
    const g = this.g;
    if (v.destroyed || amount <= 0) return;
    v.hp -= amount;
    if (attacker) v.lastAttacker = attacker;
    if (v.hp <= 0 && v.burning <= 0) {
      v.hp = 0;
      v.burning = 3.5;
      if (v.driver && v.driver !== g.player) g.ai.ejectDriver(v, true);
      if (v.driver === g.player) g.message('Dein Wagen brennt – raus da!', '#ff7a1a');
    }
    if (attacker === g.player && v.driver && v.driver !== g.player) g.ai.onCarHit(v);
  }

  explodeVehicle(v: Vehicle) {
    const g = this.g;
    if (v.destroyed) return;
    v.destroyed = true;
    v.burning = 0;
    v.hp = 0;
    v.siren = false;
    v.wreckTime = 0;
    v.traffic = null;
    v.throttle = 0;
    const attacker = v.lastAttacker;
    const driver = v.driver;
    if (driver) {
      v.driver = null;
      driver.vehicle = null;
      driver.x = v.x;
      driver.y = v.y;
      this.killPed(driver, driver === g.player ? attacker : attacker, 'explosion');
    }
    if (attacker === g.player) {
      g.wanted.crime(v.isPolice ? CRIME.destroyPolice : CRIME.destroyCar);
      g.missions.onVehicleDestroyed(v);
    }
    this.explosion(v.x, v.y, 115, 110, attacker);
    if (v.tag === 'cashtruck') {
      for (let i = 0; i < 8; i++) this.dropPickup('cash', v.x + rand(-40, 40), v.y + rand(-40, 40), 250);
      g.message('Der Geldtransporter ist geknackt! Schnapp dir die Kohle!', '#7dff7d');
      if (attacker === g.player) g.wanted.crime(CRIME.bigHeist);
    }
  }

  explosion(x: number, y: number, radius: number, damage: number, attacker: Ped | null) {
    const g = this.g;
    g.particles.explosion(x, y, radius / 110);
    const d = dist(x, y, g.playerX, g.playerY);
    g.sound.explosion(clamp(1.2 - d / 1000, 0.1, 1));
    g.camera.shake(clamp(30 - d / 25, 0, 26));
    if (d < 600) g.input.rumble(1, 1, 400);
    for (const p of g.peds) {
      if (!p.alive || p.vehicle) continue;
      const pd = dist(x, y, p.x, p.y);
      if (pd < radius) {
        const f = 1 - pd / radius;
        this.damagePed(p, damage * f + 10, attacker, 'explosion');
        if (pd > 0) {
          p.x += ((p.x - x) / pd) * 20 * f;
          p.y += ((p.y - y) / pd) * 20 * f;
        }
      }
    }
    for (const v of g.vehicles) {
      if (v.destroyed) continue;
      const vd = dist(x, y, v.x, v.y);
      if (vd < radius && vd > 0) {
        const f = 1 - vd / radius;
        this.damageVehicle(v, damage * f * 1.3, attacker);
        v.vx += ((v.x - x) / vd) * 380 * f / v.model.mass;
        v.vy += ((v.y - y) / vd) * 380 * f / v.model.mass;
      }
    }
  }

  /** Creative weapon: EMP blast stalls engines and stuns people. */
  emp(x: number, y: number, attacker: Ped | null) {
    const g = this.g;
    g.particles.empBlast(x, y, 110);
    g.sound.shot('emp', 1);
    g.camera.shake(6);
    let cars = 0;
    for (const v of g.vehicles) {
      if (v.destroyed || dist2(v.x, v.y, x, y) > 120 * 120) continue;
      v.empTimer = 5;
      v.siren = false;
      cars++;
    }
    for (const p of g.peds) {
      if (!p.alive || p.vehicle || p === attacker || p === g.player) continue;
      if (dist2(p.x, p.y, x, y) < 90 * 90) p.stunTimer = 2.5;
    }
    if (attacker === g.player && cars > 0) g.message(`EMP: ${cars} Fahrzeug(e) lahmgelegt`, '#7fe9ff');
  }

  // --- pickups ----------------------------------------------------------------

  spawnWorldPickups() {
    const spots = this.g.city.pickupSpots;
    spots.forEach((s, i) => {
      const def = PICKUP_ROTATION[i % PICKUP_ROTATION.length];
      this.g.pickups.push({ kind: def.kind, weapon: def.weapon, amount: def.amount, x: s.x, y: s.y, respawn: 0, respawnDelay: 30, active: true, bob: Math.random() * 6 });
    });
  }

  dropPickup(kind: Pickup['kind'], x: number, y: number, amount: number, weapon?: WeaponId) {
    if (this.g.city.isSolidAt(x, y)) return;
    this.g.pickups.push({ kind, weapon, amount, x, y, respawn: 0, respawnDelay: 0, active: true, bob: Math.random() * 6 });
  }

  private updatePickups(dt: number) {
    const g = this.g;
    const p = g.player;
    const alive = p.alive && g.state === 'play';
    for (const pk of g.pickups) {
      if (!pk.active) {
        pk.respawn -= dt;
        if (pk.respawn <= 0) pk.active = true;
        continue;
      }
      if (!alive) continue;
      const touching = p.vehicle ? p.vehicle.contains(pk.x, pk.y, 6) : dist2(p.x, p.y, pk.x, pk.y) < 22 * 22;
      if (!touching) continue;
      if (!this.collect(pk)) continue;
      g.sound.pickup();
      if (pk.respawnDelay > 0) {
        pk.active = false;
        pk.respawn = pk.respawnDelay;
      } else pk.amount = -1; // mark for removal
    }
    g.pickups = g.pickups.filter((pk) => pk.amount >= 0);
  }

  private collect(pk: Pickup): boolean {
    const g = this.g;
    const p = g.player;
    switch (pk.kind) {
      case 'weapon': {
        const w = WEAPONS[pk.weapon!];
        if (p.ammo[w.id] >= w.maxAmmo) return false;
        const had = p.ammo[w.id] > 0;
        p.ammo[w.id] = Math.min(w.maxAmmo, p.ammo[w.id] + pk.amount);
        if (!had && (p.weapon === 'fists' || WEAPONS[p.weapon].slot < w.slot)) p.weapon = w.id;
        g.message(`${w.name} +${pk.amount}`, w.color);
        return true;
      }
      case 'health':
        if (p.hp >= p.maxHp) return false;
        p.hp = Math.min(p.maxHp, p.hp + pk.amount);
        g.message(`Gesundheit +${pk.amount}`, '#7dff7d');
        return true;
      case 'armor':
        if (p.armor >= 100) return false;
        p.armor = Math.min(100, p.armor + pk.amount);
        g.message(`Panzerung +${pk.amount}`, '#7db8ff');
        return true;
      case 'cash':
        g.money += pk.amount;
        g.message(`+$${pk.amount}`, '#7dff7d');
        return true;
    }
  }

  drawPickups(ctx: CanvasRenderingContext2D, v: View, time: number) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const pk of this.g.pickups) {
      if (!pk.active || pk.x < v.x0 || pk.x > v.x1 || pk.y < v.y0 || pk.y > v.y1) continue;
      const s = 1 + 0.12 * Math.sin(time * 4 + pk.bob);
      let color = '#fff', label = '?';
      if (pk.kind === 'weapon') {
        color = WEAPONS[pk.weapon!].color;
        label = { fists: 'F', pistol: 'P', smg: 'MP', shotgun: 'SG', emp: 'E' }[pk.weapon!];
      } else if (pk.kind === 'health') { color = '#4dff6a'; label = '+'; }
      else if (pk.kind === 'armor') { color = '#4da6ff'; label = 'A'; }
      else { color = '#9cff4d'; label = '$'; }
      ctx.save();
      ctx.translate(pk.x, pk.y);
      ctx.scale(s, s);
      ctx.rotate(Math.sin(time * 2 + pk.bob) * 0.3);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = color + '33';
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#151515';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.fillRect(-10, -10, 20, 20);
      ctx.strokeRect(-10, -10, 20, 20);
      ctx.fillStyle = color;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(label, 0, 1);
      ctx.restore();
    }
  }

  drawProjectiles(ctx: CanvasRenderingContext2D) {
    ctx.lineCap = 'round';
    for (const p of this.g.projectiles) {
      if (p.weapon === 'emp') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(110,230,255,0.4)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#dff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      ctx.strokeStyle = WEAPONS[p.weapon].color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }
}
