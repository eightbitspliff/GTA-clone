// ---------------------------------------------------------------------------
// Game: owns all world state and wires the systems together.
// ---------------------------------------------------------------------------

import { MAP_PX, VEHICLES, VehicleModelId, WEAPON_ORDER } from '../config';
import { Ped, PedKind } from '../entities/Ped';
import { Pickup } from '../entities/Pickup';
import { Projectile } from '../entities/Projectile';
import { Vehicle } from '../entities/Vehicle';
import { AIManager } from '../systems/AIManager';
import { CombatSystem } from '../systems/CombatSystem';
import { FactionSystem } from '../systems/FactionSystem';
import { MissionSystem } from '../systems/MissionSystem';
import { Particles } from '../systems/Particles';
import { PlayerController } from '../systems/PlayerController';
import { VehicleSystem } from '../systems/VehicleSystem';
import { WantedSystem } from '../systems/WantedSystem';
import { HUD } from '../ui/HUD';
import { CityRenderer } from '../world/CityRenderer';
import { City } from '../world/City';
import { Camera } from './Camera';
import { Controls, Input } from './Input';
import { Sound } from './Sound';
import { clamp, dist2 } from './math';

export type GameState = 'title' | 'play' | 'down';

interface Message { text: string; color: string; time: number }

export class Game {
  ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  input: Input;
  camera = new Camera();
  sound = new Sound();
  city: City;
  cityRenderer: CityRenderer;
  particles = new Particles();

  peds: Ped[] = [];
  vehicles: Vehicle[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];

  player: Ped;
  money = 250;
  time = 0;
  state: GameState = 'title';
  paused = false;
  showHelp = false;
  controls!: Controls;

  downTimer = 0;
  downKind: 'wasted' | 'busted' = 'wasted';

  messages: Message[] = [];
  big: { text: string; sub: string; color: string; time: number } | null = null;

  combat: CombatSystem;
  vehicleSys: VehicleSystem;
  ai: AIManager;
  wanted: WantedSystem;
  factions: FactionSystem;
  missions: MissionSystem;
  playerCtl: PlayerController;
  hud: HUD;

  private last = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  fps = 60;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.input = new Input(canvas);
    this.input.onFirstGesture = () => this.sound.unlock();
    this.input.onDeviceMessage = (m) => this.message(m, '#9fe8ff');
    this.city = new City(20260);
    this.cityRenderer = new CityRenderer(this.city);

    this.combat = new CombatSystem(this);
    this.vehicleSys = new VehicleSystem(this);
    this.ai = new AIManager(this);
    this.wanted = new WantedSystem(this);
    this.factions = new FactionSystem(this);
    this.missions = new MissionSystem(this);
    this.playerCtl = new PlayerController(this);
    this.hud = new HUD(this);

    const start = this.city.hospital;
    this.player = new Ped('player', start.x, start.y);
    this.player.shirt = '#ffd400';
    this.player.skin = '#e8b98f';
    this.player.give('pistol', 48);
    this.player.weapon = 'pistol';
    this.peds.push(this.player);

    this.camera.snap(start.x, start.y);
    this.combat.spawnWorldPickups();
    this.ai.populateInitial();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.dpr = dpr;
    this.camera.resize(this.width, this.height);
  }
  dpr = 1;

  start() {
    const loop = (t: number) => {
      const dt = this.last ? clamp((t - this.last) / 1000, 0, 0.05) : 0.016;
      this.last = t;
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.fps = Math.round(this.fpsFrames / this.fpsAcc);
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // --- helpers used by systems ----------------------------------------------

  message(text: string, color = '#fff') {
    this.messages.push({ text, color, time: 4 });
    if (this.messages.length > 6) this.messages.shift();
  }

  bigText(text: string, sub = '', color = '#fff', time = 2.5) {
    this.big = { text, sub, color, time };
  }

  /** Position of the player (or the player's car). */
  get playerX() {
    return this.player.vehicle ? this.player.vehicle.x : this.player.x;
  }
  get playerY() {
    return this.player.vehicle ? this.player.vehicle.y : this.player.y;
  }

  spawnPed(kind: PedKind, x: number, y: number): Ped {
    const p = new Ped(kind, x, y);
    this.peds.push(p);
    return p;
  }

  spawnVehicle(model: VehicleModelId, x: number, y: number, angle: number, color?: string): Vehicle {
    const v = new Vehicle(VEHICLES[model], x, y, angle, color);
    this.vehicles.push(v);
    return v;
  }

  /** Is anything (car or ped) occupying this spot? */
  spotFree(x: number, y: number, r: number) {
    const r2 = r * r;
    for (const v of this.vehicles) if (dist2(v.x, v.y, x, y) < r2) return false;
    return true;
  }

  playerDown(kind: 'wasted' | 'busted') {
    if (this.state === 'down') return;
    this.state = 'down';
    this.downKind = kind;
    this.downTimer = 3.5;
    if (kind === 'busted') {
      this.bigText('BUSTED', 'Die Polizei hat dich geschnappt', '#4da3ff', 3.5);
      this.player.vx = this.player.vy = 0;
    } else {
      this.bigText('WASTED', 'Du bist tot', '#ff3b3b', 3.5);
    }
    this.missions.failActive('Du bist ausgeschaltet worden');
    this.sound.fail();
  }

  private respawn() {
    const p = this.player;
    if (p.vehicle) this.playerCtl.exitVehicle(true);
    const at = this.downKind === 'busted' ? this.city.policeStation : this.city.hospital;
    p.x = at.x;
    p.y = at.y;
    p.hp = p.maxHp;
    p.alive = true;
    p.armor = 0;
    p.stunTimer = 0;
    if (this.downKind === 'busted') {
      const fine = Math.min(this.money, 500 + Math.floor(this.money * 0.1));
      this.money -= fine;
      for (const w of WEAPON_ORDER) if (w !== 'fists') p.ammo[w] = 0;
      p.ammo.pistol = 24;
      p.weapon = 'pistol';
      this.message(`Kaution bezahlt: -$${fine}. Waffen konfisziert.`, '#4da3ff');
    } else {
      const fee = Math.min(this.money, 200 + Math.floor(this.money * 0.05));
      this.money -= fee;
      this.message(`Krankenhauskosten: -$${fee}`, '#ff7b7b');
      if (!p.hasAmmo()) p.weapon = 'fists';
    }
    this.wanted.clear();
    this.ai.clearPolice();
    this.camera.snap(p.x, p.y);
    this.state = 'play';
  }

  // --- main loop -------------------------------------------------------------

  private frame(dt: number) {
    this.controls = this.input.poll();
    const c = this.controls;

    if (this.state === 'title') {
      if (c.confirm || c.interact) {
        this.state = 'play';
        this.sound.unlock();
        this.message('Willkommen in NEON GRID. Finde ein Telefon (☎) für Jobs!', '#ffd400');
      }
    } else {
      if (c.pause) this.paused = !this.paused;
      if (c.help) this.showHelp = !this.showHelp;
      if (!this.paused) this.update(dt);
    }

    this.render();
    this.input.endFrame();
  }

  private update(dt: number) {
    this.time += dt;
    if (this.state === 'play') this.playerCtl.update(dt);
    else if (this.state === 'down') {
      this.downTimer -= dt;
      if (this.downTimer <= 0) this.respawn();
    }

    this.ai.update(dt);
    this.vehicleSys.update(dt);
    this.combat.update(dt);
    this.wanted.update(dt);
    this.missions.update(dt);
    this.particles.update(dt);

    // camera
    const pv = this.player.vehicle;
    const vx = pv ? pv.vx : this.player.vx, vy = pv ? pv.vy : this.player.vy;
    const sp = pv ? pv.speed / 480 : 0;
    this.camera.follow(this.playerX, this.playerY, vx, vy, sp, dt);
    this.camera.x = clamp(this.camera.x, 0, MAP_PX);
    this.camera.y = clamp(this.camera.y, 0, MAP_PX);

    for (const m of this.messages) m.time -= dt;
    this.messages = this.messages.filter((m) => m.time > 0);
    if (this.big) {
      this.big.time -= dt;
      if (this.big.time <= 0) this.big = null;
    }
  }

  private render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, this.width, this.height);

    const cam = this.camera;
    const z = cam.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, this.dpr * (this.width / 2 - (cam.x + cam.shakeX) * cam.zoom), this.dpr * (this.height / 2 - (cam.y + cam.shakeY) * cam.zoom));
    const view = cam.view(80);

    this.cityRenderer.drawGround(ctx, view, this.time);
    this.particles.drawDecals(ctx, view);
    this.combat.drawPickups(ctx, view, this.time);
    this.missions.drawWorld(ctx, this.time);
    this.ai.drawPeds(ctx, view, false);
    this.vehicleSys.draw(ctx, view, this.time);
    this.ai.drawPeds(ctx, view, true);
    this.combat.drawProjectiles(ctx);
    this.particles.draw(ctx, false);
    this.cityRenderer.drawBuildings(ctx, view, cam.x, cam.y);
    this.particles.draw(ctx, true);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.hud.draw(ctx);
  }
}
