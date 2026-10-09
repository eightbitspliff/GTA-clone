// ---------------------------------------------------------------------------
// Missions & dynamic city events (creative extension):
//  * Payphone jobs from the three gangs: Hit, Delivery, Drift Show.
//  * Random city events: Turf War between two gangs, Armored Cash Truck.
// ---------------------------------------------------------------------------

import { FACTIONS, FactionId, RESPECT_HOSTILE } from '../config';
import type { Game } from '../core/Game';
import { chance, dist, dist2, pick, rand } from '../core/math';
import { Ped } from '../entities/Ped';
import { Vehicle } from '../entities/Vehicle';

type MissionType = 'hit' | 'delivery' | 'drift';

interface Mission {
  type: MissionType;
  giver: FactionId;
  title: string;
  timeLeft: number;
  progress: number;
  goal: number;
  targets: Ped[];
  dropX: number;
  dropY: number;
  reward: number;
}

interface CityEvent {
  type: 'turf' | 'cashtruck';
  title: string;
  x: number;
  y: number;
  timeLeft: number;
  peds: Ped[];
  vehicle: Vehicle | null;
  factions: [FactionId, FactionId];
}

export interface Objective {
  x: number;
  y: number;
  color: string;
}

export class MissionSystem {
  active: Mission | null = null;
  event: CityEvent | null = null;
  private eventTimer = rand(35, 55);
  private lastType: MissionType | null = null;

  constructor(private g: Game) {}

  phoneNear(x: number, y: number) {
    return this.g.city.payphones.find((p) => dist2(p.x, p.y, x, y) < 36 * 36) ?? null;
  }

  usePhone(phone: { faction: FactionId }) {
    const g = this.g;
    const f = FACTIONS[phone.faction];
    if (g.factions.respect[phone.faction] <= RESPECT_HOSTILE) {
      g.message(`☎ "Die ${f.name} reden nicht mit Verrätern."`, f.color);
      return;
    }
    if (this.active) {
      g.message('☎ Du hast schon einen Job.', '#ccc');
      return;
    }
    const types: MissionType[] = ['hit', 'delivery', 'drift'];
    const type = pick(types.filter((t) => t !== this.lastType));
    this.lastType = type;
    const m: Mission = { type, giver: phone.faction, title: '', timeLeft: 0, progress: 0, goal: 1, targets: [], dropX: 0, dropY: 0, reward: 0 };

    if (type === 'hit') {
      const enemy = f.hates;
      const ef = FACTIONS[enemy];
      const third = g.city.w * 64 / 3;
      const cx = (enemy + 0.5) * third, cy = g.city.h * 64 / 2;
      const spot = g.city.randomPointNear(cx, cy, 0, 1100, (t) => g.city.isWalkTile(t), 80) ?? { x: cx, y: cy };
      for (let i = 0; i < 4; i++) {
        const p = g.ai.spawnGang(spot.x + rand(-40, 40), spot.y + rand(-40, 40), enemy);
        g.city.collideCircle(p, p.radius);
        p.tag = 'mission';
        p.marked = true;
        p.hp = p.maxHp = 90;
        m.targets.push(p);
      }
      m.goal = 4;
      m.timeLeft = 150;
      m.reward = 1500;
      m.title = `Erledige 4 ${ef.name}`;
    } else if (type === 'delivery') {
      const s = g.city.randomLaneSpot(g.playerX, g.playerY, 1600, 2600, 60) ?? g.city.randomLaneSpot(g.playerX, g.playerY, 800, 2600, 60);
      m.dropX = s ? s.x : g.city.hospital.x;
      m.dropY = s ? s.y : g.city.hospital.y;
      m.timeLeft = 35 + dist(g.playerX, g.playerY, m.dropX, m.dropY) / 140;
      m.reward = 1000;
      m.title = 'Liefere einen Wagen (≥40% Zustand) ab';
    } else {
      m.goal = 2500;
      m.timeLeft = 80;
      m.reward = 900;
      m.title = 'Drift-Show: 2500 Drift-Punkte';
    }
    this.active = m;
    g.bigText('NEUER JOB', `${f.name}: ${m.title}`, f.color, 3);
    g.sound.mission();
  }

  private complete() {
    const g = this.g, m = this.active!;
    g.money += m.reward;
    g.factions.add(m.giver, 15);
    g.bigText('JOB ERLEDIGT!', `+$${m.reward}  ·  Respekt bei ${FACTIONS[m.giver].name} ↑`, '#7dff7d', 3.5);
    g.sound.mission();
    this.cleanupMission();
  }

  failActive(reason: string) {
    if (!this.active) return;
    const g = this.g;
    g.factions.add(this.active.giver, -4);
    g.message(`Job gescheitert: ${reason}`, '#ff6b6b');
    this.cleanupMission();
  }

  private cleanupMission() {
    const m = this.active;
    if (!m) return;
    for (const t of m.targets) {
      t.marked = false;
      t.tag = null;
    }
    this.active = null;
  }

  // --- hooks -------------------------------------------------------------------

  onKill(p: Ped) {
    const m = this.active;
    if (m && m.type === 'hit' && p.marked) {
      p.marked = false;
      m.progress++;
      this.g.message(`Ziel ausgeschaltet (${m.progress}/${m.goal})`, '#ffd400');
      if (m.progress >= m.goal) this.complete();
    }
  }

  onDrift(points: number) {
    const m = this.active;
    if (m && m.type === 'drift') {
      m.progress += points;
      if (m.progress >= m.goal) this.complete();
    }
  }

  onEnterVehicle(_v: Vehicle) {}

  onVehicleDestroyed(v: Vehicle) {
    if (this.event && this.event.vehicle === v) this.endEvent();
  }

  // --- update ------------------------------------------------------------------

  update(dt: number) {
    const g = this.g;
    g.factions.update(dt);
    const m = this.active;
    if (m && g.state === 'play') {
      m.timeLeft -= dt;
      if (m.type === 'hit') {
        // retarget the remaining marked members to defend themselves when the player approaches
        for (const t of m.targets) {
          if (t.alive && t.marked && !t.target && dist2(t.x, t.y, g.playerX, g.playerY) < 260 * 260) t.target = g.player;
        }
        if (m.targets.every((t) => !t.alive) && m.progress < m.goal) {
          // targets killed by others or despawned still count
          m.progress = m.goal;
          this.complete();
          return;
        }
      }
      if (m.type === 'delivery') {
        const v = g.player.vehicle;
        if (v && dist2(v.x, v.y, m.dropX, m.dropY) < 80 * 80 && v.speed < 90) {
          if (v.hp < v.model.hp * 0.4) {
            if (m.timeLeft % 2 < dt) g.message('Der Wagen ist zu kaputt! Hol einen besseren.', '#ffb347');
          } else {
            g.playerCtl.exitVehicle(true);
            g.vehicles = g.vehicles.filter((o) => o !== v);
            this.complete();
            return;
          }
        }
      }
      if (this.active && m.timeLeft <= 0) {
        g.bigText('JOB GESCHEITERT', 'Die Zeit ist abgelaufen', '#ff6b6b', 2.5);
        g.sound.fail();
        this.failActive('Zeit abgelaufen');
      }
    }

    // dynamic events
    if (this.event) {
      const e = this.event;
      e.timeLeft -= dt;
      if (e.type === 'turf') {
        const a = e.peds.filter((p) => p.alive && p.faction === e.factions[0]).length;
        const b = e.peds.filter((p) => p.alive && p.faction === e.factions[1]).length;
        if (a === 0 || b === 0 || e.timeLeft <= 0) {
          if (e.timeLeft > 0) {
            const winner = a > 0 ? e.factions[0] : e.factions[1];
            g.message(`Bandenkrieg vorbei – die ${FACTIONS[winner].name} halten das Revier.`, FACTIONS[winner].color);
          }
          this.endEvent();
        }
      } else if (e.vehicle) {
        e.x = e.vehicle.x;
        e.y = e.vehicle.y;
        if (e.timeLeft <= 0 || !g.vehicles.includes(e.vehicle)) {
          g.message('Der Geldtransporter ist entkommen.', '#aaa');
          this.endEvent();
        }
      }
    } else if (g.state === 'play') {
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) {
        this.eventTimer = rand(60, 100);
        if (chance(0.55)) this.startTurfWar();
        else this.startCashTruck();
      }
    }
  }

  private startTurfWar() {
    const g = this.g;
    const p = g.city.randomPointNear(g.playerX, g.playerY, 450, 850, (t) => g.city.isWalkTile(t), 60);
    if (!p) return;
    const fa = g.city.district(p.x);
    const fb = FACTIONS[fa].hates;
    const peds: Ped[] = [];
    const ang = Math.random() * Math.PI * 2;
    for (let side = 0; side < 2; side++) {
      const f = side === 0 ? fa : fb;
      const ox = Math.cos(ang) * 90 * (side ? 1 : -1), oy = Math.sin(ang) * 90 * (side ? 1 : -1);
      for (let i = 0; i < 4; i++) {
        const q = g.ai.spawnGang(p.x + ox + rand(-25, 25), p.y + oy + rand(-25, 25), f);
        g.city.collideCircle(q, q.radius);
        q.warWith = side === 0 ? fb : fa;
        q.tag = 'event';
        peds.push(q);
      }
    }
    this.event = { type: 'turf', title: `Bandenkrieg: ${FACTIONS[fa].name} vs ${FACTIONS[fb].name}`, x: p.x, y: p.y, timeLeft: 80, peds, vehicle: null, factions: [fa, fb] };
    g.message(`⚔ ${this.event.title}! Mische mit für Respekt.`, '#ffd400');
  }

  private startCashTruck() {
    const g = this.g;
    const s = g.city.randomLaneSpot(g.playerX, g.playerY, 500, 900, 60);
    if (!s || !g.spotFree(s.x, s.y, 90)) return;
    const v = g.ai.spawnTraffic(s, 'armored');
    v.tag = 'cashtruck';
    v.persistent = true;
    if (v.traffic) v.traffic.cruise = 140;
    this.event = { type: 'cashtruck', title: 'Geldtransporter unterwegs', x: v.x, y: v.y, timeLeft: 110, peds: [], vehicle: v, factions: [0, 0] };
    g.message('💰 Ein gepanzerter Geldtransporter ist in der Nähe! Knack ihn!', '#7dff7d');
  }

  private endEvent() {
    const e = this.event;
    if (!e) return;
    for (const p of e.peds) {
      p.warWith = -1;
      p.tag = null;
    }
    if (e.vehicle) e.vehicle.tag = null;
    this.event = null;
  }

  // --- presentation --------------------------------------------------------------

  objective(): Objective | null {
    const g = this.g;
    const m = this.active;
    if (m) {
      if (m.type === 'delivery') return { x: m.dropX, y: m.dropY, color: '#ffd400' };
      if (m.type === 'hit') {
        let best: Ped | null = null, bd = Infinity;
        for (const t of m.targets) {
          if (!t.alive || !t.marked) continue;
          const d = dist2(t.x, t.y, g.playerX, g.playerY);
          if (d < bd) { bd = d; best = t; }
        }
        if (best) return { x: best.x, y: best.y, color: '#ff4d4d' };
      }
    }
    if (this.event) return { x: this.event.x, y: this.event.y, color: this.event.type === 'turf' ? '#ffa64d' : '#7dff7d' };
    return null;
  }

  drawWorld(ctx: CanvasRenderingContext2D, time: number) {
    const g = this.g;
    // payphones
    for (const ph of g.city.payphones) {
      const f = FACTIONS[ph.faction];
      const hostile = g.factions.respect[ph.faction] <= RESPECT_HOSTILE;
      const pulse = (time * 1.5) % 1;
      if (!this.active && !hostile) {
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = 1 - pulse;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ph.x, ph.y, 14 + pulse * 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(ph.x - 9, ph.y - 12, 18, 24);
      ctx.fillStyle = hostile ? '#555' : f.color;
      ctx.fillRect(ph.x - 7, ph.y - 10, 14, 6);
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('☎', ph.x, ph.y + 4);
    }

    const m = this.active;
    if (m && m.type === 'delivery') {
      const r = 46 + Math.sin(time * 4) * 6;
      ctx.strokeStyle = '#ffd400';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(m.dropX, m.dropY, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,212,0,0.15)';
      ctx.fill();
    }
    // markers above targets
    const bob = Math.sin(time * 5) * 3;
    for (const p of g.peds) {
      if (!p.alive || !p.marked) continue;
      this.arrow(ctx, p.x, p.y - 22 + bob, '#ff3b3b');
    }
    if (this.event && this.event.vehicle) this.arrow(ctx, this.event.x, this.event.y - 34 + bob, '#7dff7d');
  }

  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 8);
    ctx.lineTo(x + 7, y - 8);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
