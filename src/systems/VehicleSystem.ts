// ---------------------------------------------------------------------------
// Vehicle system: arcade car physics (accel, steering, drifting, nitro),
// collisions with the city, other cars and pedestrians, damage & rendering.
// ---------------------------------------------------------------------------

import { CRIME, PED_RADIUS } from '../config';
import type { Game } from '../core/Game';
import { clamp, dist2 } from '../core/math';
import { Vehicle } from '../entities/Vehicle';
import { CAR_SCALE, SUN, carShadow, carSprite } from '../render/Textures';

type View = { x0: number; y0: number; x1: number; y1: number };

export class VehicleSystem {
  private ramCooldown = 0;

  constructor(private g: Game) {}

  update(dt: number) {
    const g = this.g;
    this.ramCooldown -= dt;
    for (const v of g.vehicles) {
      if (v.empTimer > 0) v.empTimer -= dt;
      if (v.hornCooldown > 0) v.hornCooldown -= dt;
      this.physics(v, dt);
      this.collideWorld(v);
      this.skids(v);
      if (v.driver) {
        v.driver.x = v.x;
        v.driver.y = v.y;
        v.driver.angle = v.angle;
      }
      if (!v.destroyed) {
        if (v.hp < v.model.hp * 0.35 && Math.random() < dt * 10) g.particles.smoke(v.x + v.fx * v.model.length * 0.35, v.y + v.fy * v.model.length * 0.35, v.hp < v.model.hp * 0.15);
        if (v.burning > 0) {
          v.burning -= dt;
          for (let i = 0; i < 2; i++) g.particles.fire(v.x + v.fx * v.model.length * 0.3, v.y + v.fy * v.model.length * 0.3);
          if (v.burning <= 0) g.combat.explodeVehicle(v);
        }
        if (v.nitroOn && Math.random() < 0.8) {
          const bx = v.x - v.fx * v.model.length / 2, by = v.y - v.fy * v.model.length / 2;
          g.particles.fire(bx, by);
        }
      } else {
        v.wreckTime += dt;
        if (v.wreckTime < 12 && Math.random() < dt * 4) g.particles.smoke(v.x, v.y, true);
      }
    }
    this.collideVehicles();
    this.collidePeds();
    this.playerDrift(dt);
  }

  private physics(v: Vehicle, dt: number) {
    const m = v.model;
    const stalled = v.empTimer > 0 || v.destroyed;
    const throttle = stalled ? 0 : v.throttle;

    // Steering first: turning rotates the heading, the old velocity then shows up as lateral slip.
    const speedFactor = clamp(Math.abs(v.forwardSpeed) / 110, 0, 1);
    const highSpeedDamp = 1 - 0.3 * clamp(Math.abs(v.forwardSpeed) / m.maxSpeed, 0, 1);
    const dirSign = v.forwardSpeed >= 0 ? 1 : -1;
    const steer = stalled ? v.steer * 0.3 : v.steer;
    v.angle += steer * m.turnRate * speedFactor * highSpeedDamp * dirSign * (v.handbrake ? 1.45 : 1) * dt;

    const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
    const rx = -fy, ry = fx;
    let fwd = v.vx * fx + v.vy * fy;
    let lat = v.vx * rx + v.vy * ry;

    if (v.nitroOn) {
      v.nitro -= dt * 0.4;
      if (v.nitro <= 0) {
        v.nitro = 0;
        v.nitroOn = false;
      }
    }
    const maxS = m.maxSpeed * (v.nitroOn ? 1.45 : 1);
    const acc = m.accel * (v.nitroOn ? 1.9 : 1);

    if (throttle > 0) {
      if (fwd < 0) fwd += m.accel * 2.4 * throttle * dt;
      else if (fwd < maxS) fwd = Math.min(maxS, fwd + acc * throttle * dt * (1 - 0.4 * (fwd / maxS)));
    } else if (throttle < 0) {
      if (fwd > 5) fwd = Math.max(0, fwd + throttle * m.accel * 2.6 * dt);
      else fwd = Math.max(-maxS * 0.38, fwd + throttle * m.accel * 0.8 * dt);
    }
    if (fwd > maxS) fwd -= (fwd - maxS) * 2.5 * dt;
    // rolling resistance / drag
    const drag = throttle === 0 ? (v.destroyed ? 2.5 : 0.9) : 0.25;
    fwd -= fwd * drag * dt;
    if (Math.abs(fwd) < 2 && throttle === 0) fwd = 0;
    if (v.handbrake) fwd -= fwd * 1.1 * dt;

    const grip = v.handbrake ? m.grip * 0.16 : m.grip * (v.destroyed ? 0.6 : 1);
    lat *= Math.exp(-grip * dt);

    v.forwardSpeed = fwd;
    v.lateralSpeed = lat;
    v.vx = fx * fwd + rx * lat;
    v.vy = fy * fwd + ry * lat;
    v.x += v.vx * dt;
    v.y += v.vy * dt;
  }

  private collideWorld(v: Vehicle) {
    const g = this.g;
    let hitN: { x: number; y: number } | null = null;
    for (const [cx, cy, r] of v.circles()) {
      const p = { x: cx, y: cy };
      const n = g.city.collideCircle(p, r);
      if (n.x !== 0 || n.y !== 0) {
        v.x += p.x - cx;
        v.y += p.y - cy;
        hitN = n;
      }
    }
    if (!hitN) return;
    const vn = v.vx * hitN.x + v.vy * hitN.y;
    if (vn < 0) {
      v.vx -= 1.3 * vn * hitN.x;
      v.vy -= 1.3 * vn * hitN.y;
      v.vx *= 0.92;
      v.vy *= 0.92;
      const impact = -vn;
      if (impact > 90) {
        g.combat.damageVehicle(v, (impact - 90) * 0.07, null);
        g.particles.spark(v.x + v.fx * v.model.length * 0.4, v.y + v.fy * v.model.length * 0.4, 6);
        if (v.driver === g.player) {
          g.sound.crash(impact / 400);
          g.camera.shake(impact / 50);
          g.input.rumble(Math.min(1, impact / 400), 0.4, 150);
        }
      }
    }
  }

  private skids(v: Vehicle) {
    const sliding = Math.abs(v.lateralSpeed) > 65 || (v.handbrake && v.speed > 60) || (v.throttle < 0 && v.forwardSpeed > 160);
    if (!sliding || v.destroyed) {
      v.lastWheels = null;
      return;
    }
    const back = v.model.length * 0.32, side = v.model.width * 0.38;
    const fx = v.fx, fy = v.fy;
    const bx = v.x - fx * back, by = v.y - fy * back;
    const w = { lx: bx - fy * side, ly: by + fx * side, rx: bx + fy * side, ry: by - fx * side };
    if (v.lastWheels) {
      this.g.particles.skid(v.lastWheels.lx, v.lastWheels.ly, w.lx, w.ly);
      this.g.particles.skid(v.lastWheels.rx, v.lastWheels.ry, w.rx, w.ry);
    }
    v.lastWheels = w;
  }

  private collideVehicles() {
    const g = this.g;
    const vs = g.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        const reach = (a.model.length + b.model.length) / 2 + 4;
        if (dist2(a.x, a.y, b.x, b.y) > reach * reach) continue;
        for (const [ax, ay, ar] of a.circles()) {
          for (const [bx, by, br] of b.circles()) {
            const dx = ax - bx, dy = ay - by;
            const d = Math.hypot(dx, dy);
            const min = ar + br;
            if (d >= min || d === 0) continue;
            const nx = dx / d, ny = dy / d;
            const overlap = min - d;
            const ma = a.model.mass * (a.destroyed ? 1.5 : 1), mb = b.model.mass * (b.destroyed ? 1.5 : 1);
            const ta = mb / (ma + mb), tb = ma / (ma + mb);
            a.x += nx * overlap * ta;
            a.y += ny * overlap * ta;
            b.x -= nx * overlap * tb;
            b.y -= ny * overlap * tb;
            const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if (rv < 0) {
              const jimp = (-(1 + 0.25) * rv) / (1 / ma + 1 / mb);
              a.vx += (jimp / ma) * nx;
              a.vy += (jimp / ma) * ny;
              b.vx -= (jimp / mb) * nx;
              b.vy -= (jimp / mb) * ny;
              const impact = -rv;
              if (impact > 70) {
                const dmg = (impact - 70) * 0.09;
                const pa = a.driver === g.player, pb = b.driver === g.player;
                g.combat.damageVehicle(a, dmg * (mb / ma), pb ? g.player : null);
                g.combat.damageVehicle(b, dmg * (ma / mb), pa ? g.player : null);
                g.particles.spark((ax + bx) / 2, (ay + by) / 2, 8);
                if (pa || pb) {
                  g.sound.crash(impact / 350);
                  g.camera.shake(impact / 40);
                  g.input.rumble(Math.min(1, impact / 300), 0.6, 180);
                  const other = pa ? b : a;
                  if (other.isPolice && other.driver && this.ramCooldown <= 0) {
                    g.wanted.crime(CRIME.ramPolice);
                    this.ramCooldown = 1.5;
                  }
                  if (other.traffic) g.ai.onCarHit(other);
                }
              }
            }
          }
        }
      }
    }
  }

  private collidePeds() {
    const g = this.g;
    for (const v of g.vehicles) {
      const sp = v.speed;
      const hl = v.model.length / 2 + PED_RADIUS, hw = v.model.width / 2 + PED_RADIUS;
      const reach2 = (hl + 4) * (hl + 4);
      for (const p of g.peds) {
        if (!p.alive || p.vehicle) continue;
        if (dist2(p.x, p.y, v.x, v.y) > reach2) continue;
        const dx = p.x - v.x, dy = p.y - v.y;
        const fx = v.fx, fy = v.fy;
        const lx = dx * fx + dy * fy, ly = -dx * fy + dy * fx;
        if (Math.abs(lx) >= hl || Math.abs(ly) >= hw) continue;
        // push ped out along least penetration axis (in car space)
        const px = hl - Math.abs(lx), py = hw - Math.abs(ly);
        let ox = 0, oy = 0;
        if (px < py) ox = Math.sign(lx || 1) * px;
        else oy = Math.sign(ly || 1) * py;
        p.x += ox * fx - oy * fy;
        p.y += ox * fy + oy * fx;
        g.city.collideCircle(p, p.radius);

        if (sp > 70) {
          const attacker = v.driver;
          if (p === g.player) {
            g.combat.damagePed(p, (sp - 70) * 0.22, attacker, 'car');
          } else if (sp > 140) {
            g.combat.damagePed(p, 999, attacker, 'car');
          } else {
            g.combat.damagePed(p, (sp - 70) * 0.5, attacker, 'car');
            p.stunTimer = 0.8;
          }
          g.particles.blood(p.x, p.y, v.vx / (sp || 1), v.vy / (sp || 1), 6);
          v.vx *= 0.93;
          v.vy *= 0.93;
        }
      }
    }
  }

  /** Drift scoring + nitro charging for the player's vehicle. */
  private playerDrift(dt: number) {
    const g = this.g;
    const v = g.player.vehicle;
    if (!v) return;
    const drifting = !v.destroyed && Math.abs(v.lateralSpeed) > 70 && v.speed > 140;
    v.drifting = drifting;
    if (drifting) {
      v.driftTime += dt;
      const combo = 1 + Math.min(4, v.driftTime * 0.6);
      v.driftScore += Math.abs(v.lateralSpeed) * dt * 0.6 * combo;
      v.nitro = Math.min(1, v.nitro + dt * 0.2);
      v.driftGrace = 0.6;
    } else if (v.driftScore > 0) {
      v.driftGrace -= dt;
      if (v.driftGrace <= 0) this.bankDrift(v);
    }
  }

  bankDrift(v: Vehicle) {
    const g = this.g;
    const pts = Math.floor(v.driftScore);
    if (pts >= 40) {
      const cash = Math.floor(pts / 8);
      g.money += cash;
      g.message(`DRIFT ${pts} Punkte  +$${cash}`, '#ff5ad1');
      g.missions.onDrift(pts);
    }
    v.driftScore = 0;
    v.driftTime = 0;
  }

  // --- rendering ---------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, view: View, time: number) {
    for (const v of this.g.vehicles) {
      if (v.x < view.x0 || v.x > view.x1 || v.y < view.y0 || v.y > view.y1) continue;
      this.drawVehicle(ctx, v, time);
    }
  }

  private drawVehicle(ctx: CanvasRenderingContext2D, v: Vehicle, time: number) {
    const L = v.model.length, W = v.model.width;
    // soft shadow, offset along the sun direction
    const sh = carShadow(v.model);
    ctx.save();
    ctx.translate(v.x + SUN.x * 5, v.y + SUN.y * 5);
    ctx.rotate(v.angle);
    ctx.drawImage(sh, -sh.width / 4, -sh.height / 4, sh.width / 2, sh.height / 2);
    ctx.restore();

    const state = v.destroyed ? 'wreck' : v.hp < v.model.hp * 0.45 ? 'damaged' : 'ok';
    const spr = carSprite(v.model, v.color, state);
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);
    ctx.drawImage(spr, -spr.width / CAR_SCALE / 2, -spr.height / CAR_SCALE / 2, spr.width / CAR_SCALE, spr.height / CAR_SCALE);

    if (!v.destroyed) {
      // brake lights
      if (v.throttle < 0 || (v.handbrake && v.speed > 20)) {
        ctx.fillStyle = '#ff2a1a';
        ctx.fillRect(-L / 2 + 0.3, -W / 2 + 1.6, 1.8, 3.6);
        ctx.fillRect(-L / 2 + 0.3, W / 2 - 5.2, 1.8, 3.6);
      }
      if (v.isPolice) {
        // light bar
        const on = v.siren && Math.floor(time * 8) % 2 === 0;
        ctx.fillStyle = '#222';
        ctx.fillRect(-5, -W / 2 + 3, 6, W - 6);
        ctx.fillStyle = v.siren ? (on ? '#ff3030' : '#601010') : '#702020';
        ctx.fillRect(-4.5, -W / 2 + 3.5, 5, W / 2 - 4);
        ctx.fillStyle = v.siren ? (!on ? '#3070ff' : '#102060') : '#203070';
        ctx.fillRect(-4.5, 0.5, 5, W / 2 - 4);
        if (v.siren) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = on ? 'rgba(255,40,40,0.35)' : 'rgba(40,100,255,0.35)';
          ctx.beginPath();
          ctx.arc(-2, on ? -W / 4 : W / 4, 16, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      if (v.empTimer > 0) {
        ctx.strokeStyle = `rgba(120,230,255,${0.5 + 0.5 * Math.sin(time * 40)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = time * 20 + i * 1.7;
          ctx.moveTo(Math.cos(a) * L * 0.4, Math.sin(a) * W * 0.4);
          ctx.lineTo(Math.cos(a + 2) * L * 0.4, Math.sin(a + 2) * W * 0.4);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
