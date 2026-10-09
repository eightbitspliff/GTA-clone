// ---------------------------------------------------------------------------
// AI manager: population spawning/despawning around the player, pedestrian
// AI (civilians, gang members, cops), lane-following traffic and police
// pursuit driving (BFS flow field + stuck recovery).
// ---------------------------------------------------------------------------

import { CIVILIAN_MODELS, FACTIONS, FactionId, NUM_BLOCKS, POLICE_CARS_PER_STAR, POLICE_FOOT_PER_STAR, Tile, VehicleModelId, CRIME } from '../config';
import type { Game } from '../core/Game';
import { angleDiff, chance, clamp, dist, dist2, pick, rand } from '../core/math';
import { Ped } from '../entities/Ped';
import { Vehicle } from '../entities/Vehicle';
import { DIRS, LaneSpot, isVertical } from '../world/City';

type View = { x0: number; y0: number; x1: number; y1: number };

const CIV_TARGET = 34;
const GANG_TARGET = 11;
const TRAFFIC_TARGET = 18;
const PARKED_TARGET = 6;
const POP_RADIUS = 1500;

export class AIManager {
  private popTimer = 0;
  private flowTimer = 0;
  private policeSpawnTimer = 0;

  constructor(private g: Game) {}

  // --- population ------------------------------------------------------------

  populateInitial() {
    const g = this.g;
    for (let i = 0; i < CIV_TARGET; i++) {
      const p = g.city.randomPointNear(g.playerX, g.playerY, 80, 1100, (t) => g.city.isWalkTile(t));
      if (p) this.spawnCivilian(p.x, p.y);
    }
    for (let i = 0; i < GANG_TARGET; i++) {
      const p = g.city.randomPointNear(g.playerX, g.playerY, 300, 1200, (t) => g.city.isWalkTile(t));
      if (p) this.spawnGang(p.x, p.y, g.city.district(p.x));
    }
    for (let i = 0; i < TRAFFIC_TARGET; i++) {
      const s = g.city.randomLaneSpot(g.playerX, g.playerY, 150, 1200);
      if (s && g.spotFree(s.x, s.y, 70)) this.spawnTraffic(s);
    }
    // guaranteed car right next to the start point
    for (let i = 0; i < PARKED_TARGET; i++) this.spawnParked(i === 0 ? 60 : 200, i === 0 ? 260 : 1000);
  }

  private spawnRing() {
    const v = this.g.camera.view(0);
    const r = Math.hypot(v.x1 - v.x0, v.y1 - v.y0) / 2 + 60;
    return { min: r, max: r + 450 };
  }

  spawnCivilian(x: number, y: number): Ped {
    const p = this.g.spawnPed('civilian', x, y);
    p.hp = p.maxHp = 40;
    return p;
  }

  spawnGang(x: number, y: number, f: FactionId): Ped {
    const p = this.g.spawnPed('gang', x, y);
    p.faction = f;
    p.shirt = FACTIONS[f].color;
    p.hp = p.maxHp = 85;
    p.weapon = chance(0.3) ? 'smg' : 'pistol';
    p.give(p.weapon, 9999);
    return p;
  }

  spawnCop(x: number, y: number): Ped {
    const g = this.g;
    const stars = g.wanted.stars;
    const p = g.spawnPed('cop', x, y);
    const swat = stars >= 4;
    p.shirt = swat ? '#2a2a2a' : '#1f3b8f';
    p.hp = p.maxHp = swat ? 130 : 80;
    p.weapon = stars >= 3 ? 'smg' : 'pistol';
    p.give(p.weapon, 9999);
    p.state = stars > 0 ? 'chase' : 'wander';
    return p;
  }

  spawnTraffic(s: LaneSpot, model?: VehicleModelId): Vehicle {
    const g = this.g;
    const v = g.spawnVehicle(model ?? pick(CIVILIAN_MODELS), s.x, s.y, s.dir * (Math.PI / 2));
    const d = this.spawnCivilian(s.x, s.y);
    d.vehicle = v;
    v.driver = d;
    v.traffic = { dir: s.dir, road: s.road, next: s.next, nextDir: s.dir, turnX: 0, turnY: 0, cruise: rand(150, 200), blockedTime: 0, panic: 0 };
    this.planTurn(v);
    const sp = v.traffic.cruise * 0.7;
    v.vx = DIRS[s.dir].x * sp;
    v.vy = DIRS[s.dir].y * sp;
    v.forwardSpeed = sp;
    return v;
  }

  /** Parked car on a sidewalk next to the road (free to steal). */
  private spawnParked(minD: number, maxD: number) {
    const g = this.g, c = g.city;
    for (let i = 0; i < 20; i++) {
      const p = c.randomPointNear(g.playerX, g.playerY, minD, maxD, (t) => t === Tile.Sidewalk);
      if (!p) continue;
      const tx = Math.floor(p.x / 64), ty = Math.floor(p.y / 64);
      let angle = 0, ox = 0, oy = 0;
      if (c.get(tx - 1, ty) === Tile.Road) { angle = Math.PI / 2; ox = -12; }
      else if (c.get(tx + 1, ty) === Tile.Road) { angle = -Math.PI / 2; ox = 12; }
      else if (c.get(tx, ty - 1) === Tile.Road) { angle = Math.PI; oy = -12; }
      else if (c.get(tx, ty + 1) === Tile.Road) { angle = 0; oy = 12; }
      else continue;
      const x = (tx + 0.5) * 64 + ox, y = (ty + 0.5) * 64 + oy;
      if (!g.spotFree(x, y, 60)) continue;
      g.spawnVehicle(pick(CIVILIAN_MODELS), x, y, angle);
      return;
    }
  }

  private managePopulation() {
    const g = this.g;
    const px = g.playerX, py = g.playerY;
    const R2 = POP_RADIUS * POP_RADIUS;
    let civ = 0, gang = 0, traffic = 0, parked = 0, copFoot = 0, copCars = 0;
    for (const p of g.peds) {
      if (!p.alive || p.vehicle || p.tag) continue;
      if (dist2(p.x, p.y, px, py) > R2) continue;
      if (p.kind === 'civilian') civ++;
      else if (p.kind === 'gang') gang++;
      else if (p.kind === 'cop') copFoot++;
    }
    for (const v of g.vehicles) {
      if (v.destroyed || dist2(v.x, v.y, px, py) > R2) continue;
      if (v.isPolice && v.driver && v.driver.kind === 'cop') copCars++;
      else if (v.traffic) traffic++;
      else if (!v.driver) parked++;
    }

    const ring = this.spawnRing();
    const c = g.city;
    if (civ < CIV_TARGET) {
      for (let i = 0; i < 3; i++) {
        const p = c.randomPointNear(px, py, ring.min, ring.max, (t) => c.isWalkTile(t));
        if (p) this.spawnCivilian(p.x, p.y);
      }
    }
    if (gang < GANG_TARGET) {
      const p = c.randomPointNear(px, py, ring.min, ring.max, (t) => c.isWalkTile(t));
      if (p) {
        // members appear in pairs / small crews
        const f = c.district(p.x);
        this.spawnGang(p.x, p.y, f);
        if (chance(0.6)) this.spawnGang(p.x + rand(-20, 20), p.y + rand(-20, 20), f);
      }
    }
    if (traffic < TRAFFIC_TARGET) {
      for (let i = 0; i < 2; i++) {
        const s = c.randomLaneSpot(px, py, ring.min, ring.max);
        if (s && g.spotFree(s.x, s.y, 80)) {
          // occasional police patrol car in normal traffic
          const v = this.spawnTraffic(s, g.wanted.stars === 0 && chance(0.08) ? 'police' : undefined);
          if (v.isPolice && v.driver) {
            const cop = v.driver;
            cop.kind = 'cop';
            cop.shirt = '#1f3b8f';
            cop.hp = cop.maxHp = 80;
            cop.weapon = 'pistol';
            cop.give('pistol', 9999);
          }
        }
      }
    }
    if (parked < PARKED_TARGET) this.spawnParked(ring.min, ring.max);

    // --- police reinforcements
    const stars = g.wanted.stars;
    if (stars > 0 && this.policeSpawnTimer <= 0) {
      if (copCars < POLICE_CARS_PER_STAR[stars]) {
        const s = c.randomLaneSpot(px, py, ring.min, ring.max + 200);
        if (s && g.spotFree(s.x, s.y, 80)) {
          const v = g.spawnVehicle(stars >= 4 && chance(0.5) ? 'swat' : 'police', s.x, s.y, s.dir * (Math.PI / 2));
          const cop = this.spawnCop(s.x, s.y);
          cop.vehicle = v;
          v.driver = cop;
          v.siren = true;
          this.policeSpawnTimer = 3.2 - stars * 0.4;
        }
      }
      if (copFoot < POLICE_FOOT_PER_STAR[stars]) {
        const p = c.randomPointNear(px, py, ring.min, ring.max, (t) => c.isWalkTile(t));
        if (p) this.spawnCop(p.x, p.y);
      }
    } else if (stars === 0 && copFoot < 2) {
      const p = c.randomPointNear(px, py, ring.min, ring.max, (t) => c.isWalkTile(t));
      if (p) this.spawnCop(p.x, p.y);
    }

    this.despawn();
  }

  private despawn() {
    const g = this.g;
    const px = g.playerX, py = g.playerY;
    const cam = g.camera;
    for (const p of g.peds) {
      if (p === g.player || p.vehicle) continue;
      const d2 = dist2(p.x, p.y, px, py);
      const limit = p.tag ? 3200 : 1800;
      if (d2 > limit * limit || (!p.alive && p.deadTime > 25 && !cam.isVisible(p.x, p.y, 50))) {
        p.alive = false;
        p.deadTime = 999;
      }
    }
    for (const v of g.vehicles) {
      if (v === g.player.vehicle) continue;
      const d2 = dist2(v.x, v.y, px, py);
      const limit = v.tag ? 3500 : v.persistent ? 2600 : 1900;
      let remove = d2 > limit * limit;
      if (!remove && !cam.isVisible(v.x, v.y, 80)) {
        if (v.destroyed && v.wreckTime > 40) remove = true;
        if (v.stuckTimer > 8 && v.traffic) remove = true;
        // pursuit cars without a job anymore
        if (v.isPolice && !v.traffic && g.wanted.stars === 0 && !v.persistent) remove = true;
      }
      if (remove) {
        v.destroyed = true;
        v.wreckTime = -1; // marker for removal
        if (v.driver) {
          v.driver.alive = false;
          v.driver.deadTime = 999;
          v.driver.vehicle = null;
          v.driver = null;
        }
      }
    }
    g.vehicles = g.vehicles.filter((v) => v.wreckTime !== -1);
    g.peds = g.peds.filter((p) => p === g.player || p.alive || p.deadTime < 999);
  }

  clearPolice() {
    const g = this.g;
    for (const p of g.peds) if (p.kind === 'cop' && !p.vehicle) { p.alive = false; p.deadTime = 999; }
    for (const v of g.vehicles) {
      if (v.isPolice && v !== g.player.vehicle) {
        v.wreckTime = -1;
        if (v.driver) { v.driver.alive = false; v.driver.deadTime = 999; v.driver.vehicle = null; v.driver = null; }
      }
    }
    g.vehicles = g.vehicles.filter((v) => v.wreckTime !== -1);
    g.peds = g.peds.filter((p) => p === g.player || p.deadTime < 999);
  }

  // --- main update -------------------------------------------------------------

  update(dt: number) {
    const g = this.g;
    this.policeSpawnTimer -= dt;
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.3;
      g.city.computeFlow(g.playerX, g.playerY);
    }
    this.popTimer -= dt;
    if (this.popTimer <= 0) {
      this.popTimer = 0.5;
      this.managePopulation();
    }

    const stars = g.wanted.stars;
    for (const p of g.peds) {
      if (p === g.player) continue;
      if (!p.alive) {
        p.deadTime += dt;
        continue;
      }
      if (p.vehicle) continue;
      this.updatePed(p, dt);
    }
    for (const v of g.vehicles) {
      const d = v.driver;
      if (!d || d === g.player) continue;
      if (v.destroyed) continue;
      if (v.isPolice && d.kind === 'cop' && stars > 0) {
        v.traffic = null;
        this.updatePoliceCar(v, dt);
      } else if (v.traffic) this.updateTraffic(v, dt);
      else {
        v.throttle = 0;
        v.handbrake = true;
        v.siren = false;
      }
      if (v.speed < 5) v.stuckTimer += dt;
      else v.stuckTimer = 0;
    }
  }

  // --- pedestrians -------------------------------------------------------------

  private moveTo(p: Ped, tx: number, ty: number, speed: number, dt: number) {
    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) {
      p.vx = p.vy = 0;
      return;
    }
    p.vx = (dx / d) * speed;
    p.vy = (dy / d) * speed;
    const ox = p.x, oy = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.g.city.collideCircle(p, p.radius);
    p.angle = Math.atan2(dy, dx);
    p.walkPhase += dt * speed * 0.07;
    // detect being blocked by geometry
    if (Math.hypot(p.x - ox, p.y - oy) < speed * dt * 0.3) p.stateTimer -= dt * 3;
  }

  /** Move toward the player along the BFS field (handles buildings in the way). */
  private chasePlayer(p: Ped, speed: number, dt: number) {
    const g = this.g;
    const px = g.playerX, py = g.playerY;
    if (g.city.lineOfSight(p.x, p.y, px, py)) this.moveTo(p, px, py, speed, dt);
    else {
      const t = g.city.flowTarget(p.x, p.y, 2);
      this.moveTo(p, t.x, t.y, speed, dt);
    }
  }

  private wander(p: Ped, dt: number, speed: number) {
    const g = this.g;
    if (!p.hasGoal || p.stateTimer <= 0 || dist2(p.x, p.y, p.goalX, p.goalY) < 36) {
      const q = g.city.randomPointNear(p.x, p.y, 40, 220, (t) => g.city.isWalkTile(t), 8);
      if (q && g.city.lineOfSight(p.x, p.y, q.x, q.y)) {
        p.goalX = q.x;
        p.goalY = q.y;
        p.hasGoal = true;
        p.stateTimer = rand(3, 8);
      } else {
        p.stateTimer = 0.4;
        p.vx = p.vy = 0;
        return;
      }
    }
    this.moveTo(p, p.goalX, p.goalY, speed, dt);
  }

  private flee(p: Ped, dt: number) {
    const dx = p.x - p.fleeX, dy = p.y - p.fleeY;
    const d = Math.hypot(dx, dy) || 1;
    const wob = Math.sin(this.g.time * 3 + p.id) * 0.5;
    const a = Math.atan2(dy / d, dx / d) + wob;
    this.moveTo(p, p.x + Math.cos(a) * 50, p.y + Math.sin(a) * 50, 150, dt);
    if (p.stateTimer <= 0) {
      p.state = 'wander';
      p.hasGoal = false;
    }
  }

  private scare(p: Ped, x: number, y: number, time: number) {
    p.state = 'flee';
    p.fleeX = x;
    p.fleeY = y;
    p.stateTimer = time;
  }

  private updatePed(p: Ped, dt: number) {
    if (p.stunTimer > 0) {
      p.stunTimer -= dt;
      p.vx = p.vy = 0;
      return;
    }
    p.stateTimer -= dt;
    p.reaction -= dt;
    switch (p.kind) {
      case 'civilian':
        if (p.state === 'flee') this.flee(p, dt);
        else this.wander(p, dt, 50);
        break;
      case 'gang':
        this.gangAI(p, dt);
        break;
      case 'cop':
        this.copAI(p, dt);
        break;
    }
  }

  private validTarget(p: Ped, t: Ped | null): t is Ped {
    if (!t || !t.alive) return false;
    if (t === this.g.player && this.g.state !== 'play') return false;
    const tx = t.vehicle ? t.vehicle.x : t.x, ty = t.vehicle ? t.vehicle.y : t.y;
    return dist2(p.x, p.y, tx, ty) < 700 * 700;
  }

  private gangAI(p: Ped, dt: number) {
    const g = this.g;
    const f = p.faction as FactionId;
    if (!this.validTarget(p, p.target)) {
      p.target = null;
      if (p.warWith >= 0) p.target = this.nearestFaction(p, p.warWith as FactionId, 480);
      if (!p.target && g.factions.isHostile(f) && g.state === 'play') {
        const d = dist(p.x, p.y, g.playerX, g.playerY);
        if (d < 320 && g.city.lineOfSight(p.x, p.y, g.playerX, g.playerY)) {
          p.target = g.player;
          p.reaction = rand(0.3, 0.8);
        }
      }
      // friendly gangs cover the player
      if (!p.target && g.factions.isFriendly(f)) {
        const a = g.player.lastAttacker;
        if (a && a.alive && a !== p && a.faction !== f && dist2(p.x, p.y, a.x, a.y) < 400 * 400) p.target = a;
      }
    }
    if (p.target) this.combatBehaviour(p, p.target, dt, 125, 280);
    else this.wander(p, dt, 45);
  }

  private nearestFaction(p: Ped, f: FactionId, range: number): Ped | null {
    let best: Ped | null = null, bd = range * range;
    for (const o of this.g.peds) {
      if (!o.alive || o.vehicle || o.kind !== 'gang' || o.faction !== f) continue;
      const d = dist2(p.x, p.y, o.x, o.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Approach and shoot at a target. */
  private combatBehaviour(p: Ped, t: Ped, dt: number, speed: number, range: number) {
    const g = this.g;
    const tx = t.vehicle ? t.vehicle.x : t.x, ty = t.vehicle ? t.vehicle.y : t.y;
    const d = dist(p.x, p.y, tx, ty);
    const los = g.city.lineOfSight(p.x, p.y, tx, ty);
    if (!los || d > range) {
      if (t === g.player) this.chasePlayer(p, speed, dt);
      else this.moveTo(p, tx, ty, speed, dt);
      return;
    }
    // in range: strafe slightly and shoot
    const a = Math.atan2(ty - p.y, tx - p.x);
    const side = Math.sin(g.time * 1.3 + p.id) > 0 ? 1 : -1;
    const sx = p.x + Math.cos(a + (Math.PI / 2) * side) * 20, sy = p.y + Math.sin(a + (Math.PI / 2) * side) * 20;
    this.moveTo(p, sx, sy, 40, dt);
    p.angle = a;
    if (p.reaction <= 0) {
      const inacc = p.kind === 'cop' ? 0.1 : 0.14;
      g.combat.fire(p, a + rand(-inacc, inacc));
    }
  }

  private copAI(p: Ped, dt: number) {
    const g = this.g;
    const stars = g.wanted.stars;
    const pl = g.player;
    if (stars === 0 || g.state !== 'play') {
      p.bustTimer = 0;
      if (p.target && p.target !== pl && this.validTarget(p, p.target)) {
        this.combatBehaviour(p, p.target, dt, 120, 260);
        return;
      }
      p.target = null;
      this.wander(p, dt, 55);
      return;
    }
    const px = g.playerX, py = g.playerY;
    const d = dist(p.x, p.y, px, py);
    const hostile = stars >= 2 || p.lastAttacker === pl;

    // Arrest attempt (low wanted levels)
    if (stars <= 2) {
      const pv = pl.vehicle;
      const reach = pv ? pv.model.length / 2 + 16 : 20;
      const canBust = pv ? pv.speed < 20 : true;
      if (d < reach && canBust) {
        p.bustTimer += dt;
        p.vx = p.vy = 0;
        p.angle = Math.atan2(py - p.y, px - p.x);
        if (p.bustTimer > (pv ? 1.4 : 0.8)) g.playerDown('busted');
        return;
      }
      p.bustTimer = 0;
    }
    if (hostile && !(stars <= 2 && d < 90)) this.combatBehaviour(p, pl, dt, 140, stars >= 3 ? 340 : 260);
    else this.chasePlayer(p, 145, dt);
  }

  // --- reactions ---------------------------------------------------------------

  onGunshot(x: number, y: number, shooter: Ped) {
    const g = this.g;
    for (const p of g.peds) {
      if (!p.alive || p === shooter) continue;
      if (p.vehicle) {
        const v = p.vehicle;
        if (!v.traffic || p === g.player) continue;
        const d2 = dist2(v.x, v.y, x, y);
        if (d2 < 320 * 320) {
          v.traffic.panic = 6;
          // some drivers abandon their car in panic
          if (d2 < 150 * 150 && p.kind === 'civilian' && chance(0.12)) this.ejectDriver(v, false, shooter);
        }
        continue;
      }
      if (p.kind === 'civilian' && dist2(p.x, p.y, x, y) < 380 * 380) this.scare(p, x, y, rand(5, 9));
    }
  }

  onPedHurt(p: Ped, attacker: Ped | null) {
    const g = this.g;
    if (p === g.player) return;
    if (p.kind === 'civilian') {
      this.scare(p, attacker ? attacker.x : p.x, attacker ? attacker.y : p.y, 8);
      return;
    }
    if (!attacker || attacker === p) return;
    if (p.kind === 'gang') {
      if (attacker.kind === 'gang' && attacker.faction === p.faction) return;
      p.target = attacker;
      p.reaction = rand(0.1, 0.4);
      // crew solidarity
      for (const o of g.peds) {
        if (o.alive && !o.vehicle && o.kind === 'gang' && o.faction === p.faction && !o.target && dist2(o.x, o.y, p.x, p.y) < 300 * 300) o.target = attacker;
      }
    } else if (p.kind === 'cop') {
      if (attacker === g.player) {
        g.wanted.crime(CRIME.hitPed);
        p.target = attacker;
      } else if (attacker.kind !== 'cop') p.target = attacker;
    }
  }

  onPedKilled(p: Ped, attacker: Ped | null) {
    const g = this.g;
    for (const o of g.peds) {
      if (!o.alive || o.vehicle || o === g.player) continue;
      const d2 = dist2(o.x, o.y, p.x, p.y);
      if (o.kind === 'civilian' && d2 < 260 * 260) this.scare(o, p.x, p.y, rand(6, 10));
      if (attacker && o.kind === 'gang' && o.faction === p.faction && p.kind === 'gang' && d2 < 350 * 350) {
        o.target = attacker;
        o.reaction = rand(0.2, 0.6);
      }
    }
  }

  onCarHit(v: Vehicle) {
    const g = this.g;
    if (v.traffic) {
      v.traffic.panic = 4;
      if (v.hornCooldown <= 0) {
        v.hornCooldown = 2;
        if (dist2(v.x, v.y, g.playerX, g.playerY) < 500 * 500) g.sound.horn();
      }
    }
    const d = v.driver;
    // gang drivers get out and fight
    if (d && d.kind === 'gang' && chance(0.5)) {
      this.ejectDriver(v, false, g.player);
    }
  }

  ejectDriver(v: Vehicle, burning: boolean, jacker?: Ped | null) {
    const g = this.g;
    const d = v.driver;
    if (!d) return;
    v.driver = null;
    d.vehicle = null;
    v.traffic = null;
    v.throttle = 0;
    v.siren = false;
    const off = v.model.width / 2 + 10;
    d.x = v.x + v.fy * off;
    d.y = v.y - v.fx * off;
    g.city.collideCircle(d, d.radius);
    d.hasGoal = false;
    if (d.kind === 'civilian') this.scare(d, jacker ? jacker.x : v.x, jacker ? jacker.y : v.y, burning ? 6 : 9);
    else if (jacker) {
      d.target = jacker;
      d.reaction = 0.6;
    }
    if (d.kind === 'cop' && !d.target) d.state = 'chase';
  }

  // --- traffic -----------------------------------------------------------------

  private nodeOf(v: Vehicle): [number, number] {
    const t = v.traffic!;
    return isVertical(t.dir) ? [t.road, t.next] : [t.next, t.road];
  }

  private planTurn(v: Vehicle) {
    const g = this.g, c = g.city, t = v.traffic!;
    const [i, j] = this.nodeOf(v);
    const valid = (d: number) => (d === 0 ? i < NUM_BLOCKS : d === 2 ? i > 0 : d === 1 ? j < NUM_BLOCKS : j > 0);
    const options: [number, number][] = [
      [t.dir, 0.5],
      [(t.dir + 1) % 4, 0.3],
      [(t.dir + 3) % 4, 0.2],
    ];
    const ok = options.filter(([d]) => valid(d));
    const total = ok.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    let nd = ok[0][0];
    for (const [d, w] of ok) {
      if ((r -= w) <= 0) { nd = d; break; }
    }
    t.nextDir = nd;
    if (nd === t.dir) {
      if (isVertical(t.dir)) { t.turnX = c.laneCoord(t.dir, i); t.turnY = c.nodeCenter(j); }
      else { t.turnX = c.nodeCenter(i); t.turnY = c.laneCoord(t.dir, j); }
    } else if (!isVertical(t.dir)) {
      t.turnX = c.laneCoord(nd, i);
      t.turnY = c.laneCoord(t.dir, j);
    } else {
      t.turnX = c.laneCoord(t.dir, i);
      t.turnY = c.laneCoord(nd, j);
    }
  }

  private commitTurn(v: Vehicle) {
    const t = v.traffic!;
    const [i, j] = this.nodeOf(v);
    const nd = t.nextDir;
    t.dir = nd;
    if (isVertical(nd)) {
      t.road = i;
      t.next = j + (nd === 1 ? 1 : -1);
    } else {
      t.road = j;
      t.next = i + (nd === 0 ? 1 : -1);
    }
    this.planTurn(v);
  }

  private updateTraffic(v: Vehicle, dt: number) {
    const g = this.g, c = g.city, t = v.traffic!;
    let d = DIRS[t.dir];
    let along = (t.turnX - v.x) * d.x + (t.turnY - v.y) * d.y;
    if (along < (t.nextDir === t.dir ? 0 : 5)) {
      this.commitTurn(v);
      d = DIRS[t.dir];
      along = (t.turnX - v.x) * d.x + (t.turnY - v.y) * d.y;
    }
    const nd = DIRS[t.nextDir];
    let tx: number, ty: number;
    const turning = t.nextDir !== t.dir;
    if (turning && along < 36) {
      tx = t.turnX + nd.x * 40;
      ty = t.turnY + nd.y * 40;
    } else if (isVertical(t.dir)) {
      tx = c.laneCoord(t.dir, t.road);
      ty = v.y + d.y * 55;
    } else {
      tx = v.x + d.x * 55;
      ty = c.laneCoord(t.dir, t.road);
    }
    const desired = Math.atan2(ty - v.y, tx - v.x);
    const diff = angleDiff(v.angle, desired);
    v.steer = clamp(diff * 3, -1, 1);

    t.panic -= dt;
    let target = t.cruise * (t.panic > 0 ? 1.6 : 1);
    if (turning && along < 110) target = Math.min(target, 105);
    if (Math.abs(diff) > 0.8) target = Math.min(target, 70);

    // obstacle avoidance: brake for things ahead
    const fx = v.fx, fy = v.fy;
    const look = v.model.length / 2 + 26 + Math.max(0, v.forwardSpeed) * 0.35;
    let blocked = false;
    let blockedByPlayer = false;
    if (t.blockedTime >= 0) {
      for (const o of g.vehicles) {
        if (o === v) continue;
        const rx = o.x - v.x, ry = o.y - v.y;
        const fd = rx * fx + ry * fy;
        if (fd <= 0 || fd > look + o.model.length / 2) continue;
        const ld = Math.abs(-rx * fy + ry * fx);
        if (ld < 16 + o.model.width / 2) {
          blocked = true;
          if (o.driver === g.player) blockedByPlayer = true;
          break;
        }
      }
      if (!blocked) {
        for (const p of g.peds) {
          if (!p.alive || p.vehicle) continue;
          const rx = p.x - v.x, ry = p.y - v.y;
          const fd = rx * fx + ry * fy;
          if (fd <= 0 || fd > look) continue;
          if (Math.abs(-rx * fy + ry * fx) < v.model.width / 2 + 8) {
            blocked = true;
            if (p === g.player) blockedByPlayer = true;
            break;
          }
        }
      }
    }
    if (blocked && t.panic <= 0) {
      target = 0;
      t.blockedTime += dt;
      if (blockedByPlayer && t.blockedTime > 1.5 && v.hornCooldown <= 0) {
        v.hornCooldown = 2.5;
        if (dist2(v.x, v.y, g.playerX, g.playerY) < 400 * 400) g.sound.horn();
      }
      if (t.blockedTime > 5 && !blockedByPlayer) t.blockedTime = -1.5; // creep through deadlocks
    } else if (t.blockedTime < 0) {
      t.blockedTime = Math.min(0, t.blockedTime + dt);
      target = Math.min(target, 60);
    } else t.blockedTime = 0;

    const fs = v.forwardSpeed;
    if (fs < target - 8) v.throttle = clamp((target - fs) / 60, 0.25, 1);
    else if (fs > target + 12) v.throttle = target === 0 ? -1 : -0.5;
    else v.throttle = 0.12;
    v.handbrake = false;
    v.siren = false;
  }

  // --- police driving -------------------------------------------------------------

  private updatePoliceCar(v: Vehicle, dt: number) {
    const g = this.g;
    const pl = g.player;
    v.siren = v.empTimer <= 0;
    const px = g.playerX, py = g.playerY;
    const d = dist(v.x, v.y, px, py);

    // player on foot nearby -> stop and deploy officers
    if (!pl.vehicle && d < 170) {
      v.steer = 0;
      v.throttle = v.forwardSpeed > 20 ? -1 : 0;
      v.handbrake = v.speed > 30;
      if (v.speed < 40) this.deployCops(v);
      return;
    }

    if (v.reverseTimer > 0) {
      v.reverseTimer -= dt;
      v.throttle = -1;
      v.steer = v.reverseSteer;
      v.handbrake = false;
      return;
    }

    let tx: number, ty: number;
    if (d < 300 && g.city.lineOfSight(v.x, v.y, px, py)) {
      const pv = pl.vehicle;
      const lead = 0.45;
      tx = px + (pv ? pv.vx : pl.vx) * lead;
      ty = py + (pv ? pv.vy : pl.vy) * lead;
    } else {
      const t = g.city.flowTarget(v.x, v.y, 3);
      tx = t.x;
      ty = t.y;
    }
    const desired = Math.atan2(ty - v.y, tx - v.x);
    const diff = angleDiff(v.angle, desired);
    v.steer = clamp(diff * 2.5, -1, 1);
    const aggression = 0.75 + g.wanted.stars * 0.05;
    v.throttle = Math.abs(diff) > 1.5 && v.speed > 140 ? 0.2 : aggression;
    v.handbrake = Math.abs(diff) > 1.0 && v.speed > 220;

    if (v.stuckTimer > 1.1) {
      v.reverseTimer = 0.9;
      v.reverseSteer = -(Math.sign(diff) || 1);
      v.stuckTimer = 0;
    }
  }

  private deployCops(v: Vehicle) {
    const g = this.g;
    const d = v.driver;
    if (!d) return;
    this.ejectDriver(v, false, null);
    d.state = 'chase';
    d.target = null;
    if (g.wanted.stars >= 2) {
      const off = v.model.width / 2 + 10;
      const partner = this.spawnCop(v.x - v.fy * off, v.y + v.fx * off);
      g.city.collideCircle(partner, partner.radius);
    }
    v.persistent = false;
  }

  // --- rendering ---------------------------------------------------------------

  drawPeds(ctx: CanvasRenderingContext2D, view: View, living: boolean) {
    const g = this.g;
    for (const p of g.peds) {
      if (p.vehicle || p.alive !== living) continue;
      if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
      if (p.deadTime >= 999) continue;
      drawPed(ctx, p, p === g.player, g.time);
    }
  }
}

function drawPed(ctx: CanvasRenderingContext2D, p: Ped, isPlayer: boolean, time: number) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  if (!p.alive) {
    ctx.fillStyle = p.shirt;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(-9, -6, 16, 12);
    ctx.fillStyle = p.skin;
    ctx.beginPath();
    ctx.arc(9, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-4, -11, 3, 6);
    ctx.fillRect(-4, 5, 3, 6);
    ctx.restore();
    return;
  }
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(2, 2, 7, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // legs
  const moving = Math.hypot(p.vx, p.vy) > 5;
  const sw = moving ? Math.sin(p.walkPhase) * 5 : 0;
  ctx.fillStyle = '#2a2a33';
  ctx.fillRect(-2 + sw, -5, 6, 3.5);
  ctx.fillRect(-2 - sw, 1.5, 6, 3.5);
  // gun
  if (p.weapon !== 'fists') {
    ctx.fillStyle = '#111';
    const len = p.weapon === 'shotgun' ? 14 : p.weapon === 'smg' ? 12 : p.weapon === 'emp' ? 13 : 9;
    ctx.fillRect(3, 1, len, p.weapon === 'emp' ? 4 : 3);
    if (p.weapon === 'emp') {
      ctx.fillStyle = '#6be4ff';
      ctx.fillRect(3 + len - 3, 1, 3, 4);
    }
  }
  // body
  ctx.fillStyle = p.shirt;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5.5, 8.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // arms
  ctx.fillStyle = p.skin;
  if (p.weapon !== 'fists') {
    ctx.fillRect(1, 2, 6, 2.5);
    ctx.fillRect(1, -4, 6, 2.5);
  } else {
    ctx.fillRect(-1 + sw * 0.4, -9, 4, 2.5);
    ctx.fillRect(-1 - sw * 0.4, 6.5, 4, 2.5);
  }
  // head
  ctx.fillStyle = p.skin;
  ctx.beginPath();
  ctx.arc(0.5, 0, 4.2, 0, Math.PI * 2);
  ctx.fill();
  if (p.kind === 'cop') {
    ctx.fillStyle = p.shirt === '#2a2a2a' ? '#111' : '#14265e';
    ctx.beginPath();
    ctx.arc(0, 0, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d4b44a';
    ctx.fillRect(1.5, -1, 2, 2);
  } else if (p.kind === 'gang') {
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-0.5, 0, 4.2, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.fill();
    ctx.fillStyle = p.shirt;
    ctx.fillRect(-1, -4, 1.6, 8);
  } else {
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath();
    ctx.arc(-0.8, 0, 3.8, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.fill();
  }
  ctx.restore();
  if (isPlayer) {
    ctx.strokeStyle = 'rgba(255,212,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (p.stunTimer > 0) {
    ctx.fillStyle = '#7fe9ff';
    for (let i = 0; i < 3; i++) {
      const a = time * 6 + (i * Math.PI * 2) / 3;
      ctx.fillRect(p.x + Math.cos(a) * 10 - 1.5, p.y + Math.sin(a) * 10 - 1.5, 3, 3);
    }
  }
}
