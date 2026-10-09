// ---------------------------------------------------------------------------
// HUD: money, respect bars, wanted stars, health/armor, weapon, vehicle info
// (speed, nitro, drift combo), minimap, objective arrow, messages, overlays.
// ---------------------------------------------------------------------------

import { FACTIONS, RESPECT_FRIENDLY, RESPECT_HOSTILE, TILE, Tile, WEAPONS } from '../config';
import type { Game } from '../core/Game';
import { clamp, dist } from '../core/math';

const FONT = '"Segoe UI", system-ui, sans-serif';

export class HUD {
  private minimap: HTMLCanvasElement;
  private mmScale = 3; // minimap pixels per tile

  constructor(private g: Game) {
    const c = g.city;
    this.minimap = document.createElement('canvas');
    this.minimap.width = c.w * this.mmScale;
    this.minimap.height = c.h * this.mmScale;
    const m = this.minimap.getContext('2d')!;
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const t = c.get(x, y);
        m.fillStyle = t === Tile.Road ? '#4a4a50' : t === Tile.Building ? '#1e1f24' : t === Tile.Grass || t === Tile.Tree ? '#2f5a2c' : '#7a7670';
        m.fillRect(x * this.mmScale, y * this.mmScale, this.mmScale, this.mmScale);
      }
    }
    // district tint
    for (let f = 0; f < 3; f++) {
      m.fillStyle = FACTIONS[f].color + '18';
      m.fillRect((f * c.w * this.mmScale) / 3, 0, (c.w * this.mmScale) / 3, c.h * this.mmScale);
    }
  }

  private key(kbm: string, pad: string) {
    return this.g.controls.device === 'pad' ? pad : kbm;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    if (g.state === 'title') {
      this.drawTitle(ctx);
      return;
    }
    this.drawObjectiveArrow(ctx);
    this.drawTopLeft(ctx);
    this.drawStars(ctx);
    this.drawBottomLeft(ctx);
    this.drawVehicle(ctx);
    this.drawMission(ctx);
    this.drawMinimap(ctx);
    this.drawHints(ctx);
    this.drawMessages(ctx);
    this.drawBig(ctx);
    if (g.showHelp) this.drawHelp(ctx);
    if (g.paused) this.drawPause(ctx);
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${g.fps} FPS`, g.width - 8, g.height - 4);
  }

  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 'bold') {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size / 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  private drawTopLeft(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    this.text(ctx, `$${g.money.toLocaleString('de-DE')}`, 20, 30, 30, '#9cff4d');
    let y = 62;
    for (const f of FACTIONS) {
      const r = g.factions.respect[f.id];
      const w = 150, h = 9, x = 20;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      const mid = x + w / 2;
      const len = (r / 100) * (w / 2);
      ctx.fillStyle = r >= 0 ? f.color : '#d33';
      ctx.fillRect(Math.min(mid, mid + len), y, Math.abs(len), h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(mid - 0.5, y - 2, 1, h + 4);
      const pulse = g.factions.pulse[f.id];
      if (pulse > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
      }
      const status = r <= RESPECT_HOSTILE ? ' ✖' : r >= RESPECT_FRIENDLY ? ' ✔' : '';
      this.text(ctx, f.name + status, x + w + 10, y + 4, 12, f.color);
      y += 18;
    }
  }

  private drawStars(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    const stars = g.wanted.stars;
    const flash = g.wanted.flashing && Math.floor(g.time * 4) % 2 === 0;
    for (let i = 0; i < 5; i++) {
      const x = g.width - 30 - (4 - i) * 34, y = 32;
      const on = i < stars;
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? 14 : 6;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = on ? (flash ? '#fff' : '#ffd400') : 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.strokeStyle = on ? '#000' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    if (stars > 0 && g.wanted.unseen > 2) {
      const t = clamp(g.wanted.unseen / g.wanted.escapeTime, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(g.width - 186, 54, 170, 5);
      ctx.fillStyle = '#9fd4ff';
      ctx.fillRect(g.width - 186, 54, 170 * t, 5);
      this.text(ctx, 'außer Sicht', g.width - 16, 68, 11, '#9fd4ff', 'right', 'normal');
    }
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, color: string) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(t, 0, 1), h);
  }

  private drawBottomLeft(ctx: CanvasRenderingContext2D) {
    const g = this.g, p = g.player;
    const y = g.height - 34;
    this.bar(ctx, 20, y, 200, 12, p.hp / p.maxHp, p.hp < 30 ? '#ff3b3b' : '#4dff6a');
    if (p.armor > 0) this.bar(ctx, 20, y - 18, 200, 7, p.armor / 100, '#4da6ff');
    const w = WEAPONS[p.weapon];
    const ammo = p.weapon === 'fists' ? '' : `  ${p.ammo[p.weapon]}`;
    this.text(ctx, `${w.name}${ammo}`, 20, y - 40, 20, w.color);
  }

  private drawVehicle(ctx: CanvasRenderingContext2D) {
    const g = this.g, v = g.player.vehicle;
    if (!v) return;
    const cx = g.width / 2, y = g.height - 40;
    const kmh = Math.round(v.speed * 0.45);
    this.text(ctx, `${kmh}`, cx - 70, y, 30, '#fff', 'right');
    this.text(ctx, 'km/h', cx - 64, y + 4, 12, '#bbb', 'left', 'normal');
    this.bar(ctx, cx - 10, y - 12, 130, 9, v.nitro, v.nitroOn ? '#ff7a1a' : '#ff5ad1');
    this.text(ctx, 'NITRO', cx + 126, y - 8, 11, '#ff5ad1', 'left');
    this.bar(ctx, cx - 10, y + 4, 130, 6, v.hp / v.model.hp, v.burning > 0 ? '#ff3b1a' : '#ddd');
    this.text(ctx, 'ZUSTAND', cx + 126, y + 7, 11, '#ddd', 'left', 'normal');
    if (v.driftScore > 1) {
      const combo = 1 + Math.min(4, v.driftTime * 0.6);
      const s = 1 + Math.sin(g.time * 18) * 0.04;
      ctx.save();
      ctx.translate(cx, g.height * 0.72);
      ctx.scale(s, s);
      this.text(ctx, `DRIFT ${Math.floor(v.driftScore)}`, 0, 0, 28, '#ff5ad1', 'center');
      this.text(ctx, `x${combo.toFixed(1)}`, 0, 26, 16, '#fff', 'center');
      ctx.restore();
    }
    if (v.empTimer > 0) this.text(ctx, 'MOTOR GESTÖRT (EMP)', cx, y - 40, 16, '#7fe9ff', 'center');
  }

  private drawMission(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    const m = g.missions.active;
    let y = 26;
    if (m) {
      const f = FACTIONS[m.giver];
      const t = Math.max(0, Math.ceil(m.timeLeft));
      const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(g.width / 2 - 220, 8, 440, 50);
      ctx.fillStyle = f.color;
      ctx.fillRect(g.width / 2 - 220, 8, 4, 50);
      this.text(ctx, m.title, g.width / 2, y, 16, '#fff', 'center');
      let prog = '';
      if (m.type === 'hit') prog = `${m.progress}/${m.goal}`;
      if (m.type === 'drift') prog = `${Math.floor(m.progress)}/${m.goal}`;
      if (m.type === 'delivery') prog = `${Math.round(dist(g.playerX, g.playerY, m.dropX, m.dropY) / TILE)} m`;
      this.text(ctx, `${prog}   ⏱ ${mm}:${ss}`, g.width / 2, y + 20, 14, t < 15 ? '#ff6b6b' : '#ffd400', 'center');
      y += 56;
    }
    const e = g.missions.event;
    if (e) this.text(ctx, `${e.type === 'turf' ? '⚔' : '💰'} ${e.title}`, g.width / 2, y + 6, 14, e.type === 'turf' ? '#ffa64d' : '#7dff7d', 'center');
  }

  private drawObjectiveArrow(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    const o = g.missions.objective();
    if (!o) return;
    const s = g.camera.worldToScreen(o.x, o.y);
    const margin = 50;
    if (s.x > margin && s.x < g.width - margin && s.y > margin && s.y < g.height - margin) return;
    const cx = g.width / 2, cy = g.height / 2;
    const a = Math.atan2(s.y - cy, s.x - cx);
    const rx = g.width / 2 - margin, ry = g.height / 2 - margin;
    const k = Math.min(rx / Math.abs(Math.cos(a) || 1e-6), ry / Math.abs(Math.sin(a) || 1e-6));
    const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = o.color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-10, -12);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    this.text(ctx, `${Math.round(dist(g.playerX, g.playerY, o.x, o.y) / TILE)}m`, x - Math.cos(a) * 30, y - Math.sin(a) * 30, 12, o.color, 'center');
  }

  private drawMinimap(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    const size = Math.round(clamp(g.height * 0.26, 140, 220));
    const x0 = g.width - size - 16, y0 = g.height - size - 22;
    const worldSpan = 2000;
    const scale = size / worldSpan; // screen px per world px
    const mmPerWorld = this.mmScale / TILE;
    const px = g.playerX, py = g.playerY;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, size, size);
    ctx.clip();
    ctx.fillStyle = '#0d1b26';
    ctx.fillRect(x0, y0, size, size);
    const sx = (px - worldSpan / 2) * mmPerWorld, sy = (py - worldSpan / 2) * mmPerWorld;
    ctx.globalAlpha = 0.92;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimap, sx, sy, worldSpan * mmPerWorld, worldSpan * mmPerWorld, x0, y0, size, size);
    ctx.globalAlpha = 1;

    const toMap = (wx: number, wy: number) => ({ x: x0 + size / 2 + (wx - px) * scale, y: y0 + size / 2 + (wy - py) * scale });
    const dot = (wx: number, wy: number, r: number, color: string) => {
      const m = toMap(wx, wy);
      const cx = clamp(m.x, x0 + 4, x0 + size - 4), cy = clamp(m.y, y0 + 4, y0 + size - 4);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const ph of g.city.payphones) dot(ph.x, ph.y, 4, FACTIONS[ph.faction].color);
    dot(g.city.hospital.x, g.city.hospital.y, 3.5, '#ff4d4d');
    for (const s of g.city.sprayShops) dot(s.x, s.y, 3.5, '#ff9a1a');
    dot(g.city.policeStation.x, g.city.policeStation.y, 3.5, '#4d8bff');
    const blink = Math.floor(g.time * 6) % 2 === 0;
    for (const v of g.vehicles) {
      if (v.siren) dot(v.x, v.y, 3, blink ? '#ff2a2a' : '#2a6bff');
    }
    for (const p of g.peds) {
      if (!p.alive || p.vehicle) continue;
      if (p.kind === 'cop' && g.wanted.stars > 0) dot(p.x, p.y, 2, '#6aa0ff');
      if (p.marked) dot(p.x, p.y, 3, '#ff3b3b');
    }
    const o = g.missions.objective();
    if (o) dot(o.x, o.y, 5, o.color);
    const m = g.missions.active;
    if (m && m.type === 'delivery') dot(m.dropX, m.dropY, 5, '#ffd400');

    // player arrow
    const ang = g.player.vehicle ? g.player.vehicle.angle : g.player.angle;
    ctx.save();
    ctx.translate(x0 + size / 2, y0 + size / 2);
    ctx.rotate(ang);
    ctx.fillStyle = '#ffd400';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, size, size);
    const d = g.city.district(px);
    this.text(ctx, `Revier: ${FACTIONS[d].name}`, x0 + size / 2, y0 - 10, 12, FACTIONS[d].color, 'center');
    this.text(ctx, `🕒 ${g.lighting.clock()}`, x0 + size, y0 - 28, 13, '#ddd', 'right', '600');
  }

  private drawHints(ctx: CanvasRenderingContext2D) {
    const g = this.g, p = g.player;
    if (g.state !== 'play' || p.vehicle) return;
    const btn = this.key('F', 'Ⓨ');
    let hint = '';
    const phone = g.missions.phoneNear(p.x, p.y);
    if (phone) hint = `${btn}  Telefon abnehmen (${FACTIONS[phone.faction].name})`;
    else {
      for (const v of g.vehicles) {
        if (v.usable && dist(p.x, p.y, v.x, v.y) < v.model.length / 2 + 30) {
          hint = `${btn}  ${v.driver ? 'Wagen klauen' : 'Einsteigen'}: ${v.model.name}`;
          break;
        }
      }
    }
    if (hint) this.text(ctx, hint, g.width / 2, g.height - 90, 16, '#fff', 'center');
  }

  private drawMessages(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    let y = g.height - 120;
    for (let i = g.messages.length - 1; i >= 0; i--) {
      const m = g.messages[i];
      ctx.globalAlpha = clamp(m.time, 0, 1);
      this.text(ctx, m.text, 20, y, 15, m.color, 'left', '600');
      y -= 22;
    }
    ctx.globalAlpha = 1;
  }

  private drawBig(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    if (!g.big) return;
    const b = g.big;
    ctx.globalAlpha = clamp(b.time * 2, 0, 1);
    this.text(ctx, b.text, g.width / 2, g.height * 0.38, 64, b.color, 'center', '900');
    if (b.sub) this.text(ctx, b.sub, g.width / 2, g.height * 0.38 + 50, 20, '#fff', 'center', '600');
    ctx.globalAlpha = 1;
  }

  private panel(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const g = this.g;
    const x = (g.width - w) / 2, y = (g.height - h) / 2;
    ctx.fillStyle = 'rgba(8,10,16,0.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    return { x, y };
  }

  private controlsTable(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const rows: [string, string, string][] = [
      ['Aktion', 'Maus + Tastatur', 'Xbox-Controller'],
      ['Laufen / Lenken', 'W A S D / Pfeile', 'Linker Stick'],
      ['Zielen', 'Maus', 'Rechter Stick (Aim-Assist)'],
      ['Schießen', 'Linke Maustaste / Strg', 'RT  (im Auto: X)'],
      ['Sprinten', 'Shift', 'A'],
      ['Gas / Bremse', 'W / S', 'RT / LT'],
      ['Handbremse (Drift)', 'Leertaste', 'A'],
      ['Nitro', 'Shift', 'B'],
      ['Ein-/Aussteigen, Telefon', 'F / Enter', 'Y'],
      ['Waffe wechseln', 'Q / E, Mausrad, 1–5', 'LB / RB'],
      ['Pause / Hilfe', 'Esc, P / H', 'Start / Back'],
      ['Grafikqualität', 'G', '–'],
    ];
    rows.forEach((r, i) => {
      const col = i === 0 ? '#ffd400' : '#ddd';
      const wgt = i === 0 ? 'bold' : 'normal';
      this.text(ctx, r[0], x, y + i * 24, 14, col, 'left', wgt);
      this.text(ctx, r[1], x + 220, y + i * 24, 14, col, 'left', wgt);
      this.text(ctx, r[2], x + 420, y + i * 24, 14, col, 'left', wgt);
    });
  }

  private drawTitle(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, g.width, g.height);
    const { x, y } = this.panel(ctx, 700, 560);
    this.text(ctx, 'NEON GRID', g.width / 2, y + 50, 56, '#ffd400', 'center', '900');
    this.text(ctx, 'Ein GTA2-inspirierter Top-Down-Prototyp', g.width / 2, y + 92, 16, '#ccc', 'center', 'normal');
    this.controlsTable(ctx, x + 30, y + 135);
    this.text(ctx, '☎ Telefone = Gang-Jobs · Driften lädt Nitro · EMP legt Autos lahm · SPRAY-Shop löscht Fahndung', g.width / 2, y + 448, 14, '#9fe8ff', 'center', 'normal');
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250);
    ctx.globalAlpha = pulse;
    this.text(ctx, 'ENTER / Klick  oder  Ⓐ  zum Starten', g.width / 2, y + 500, 22, '#fff', 'center');
    ctx.globalAlpha = 1;
    if (g.input.padConnected) this.text(ctx, '🎮 Controller erkannt', g.width / 2, y + 535, 13, '#7dff7d', 'center', 'normal');
  }

  private drawHelp(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    const { x, y } = this.panel(ctx, 700, 370);
    this.text(ctx, 'STEUERUNG', g.width / 2, y + 28, 24, '#ffd400', 'center');
    this.controlsTable(ctx, x + 30, y + 64);
    this.text(ctx, `${this.key('H', 'Back')} zum Schließen`, g.width / 2, y + 355, 13, '#aaa', 'center', 'normal');
  }

  private drawPause(ctx: CanvasRenderingContext2D) {
    const g = this.g;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, g.width, g.height);
    this.text(ctx, 'PAUSE', g.width / 2, g.height / 2 - 20, 56, '#fff', 'center', '900');
    this.text(ctx, `${this.key('Esc / P', 'Start')} zum Fortsetzen · ${this.key('H', 'Back')} für Steuerung`, g.width / 2, g.height / 2 + 30, 16, '#ccc', 'center', 'normal');
  }
}
