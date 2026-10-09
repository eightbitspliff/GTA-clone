import { VehicleModel } from '../config';
import { pick } from '../core/math';
import type { Ped } from './Ped';

let nextId = 1;

/** Lane-following state for NPC traffic (see AIManager). */
export interface TrafficState {
  dir: number;
  road: number;
  next: number;
  nextDir: number;
  turnX: number;
  turnY: number;
  cruise: number;
  blockedTime: number;
  panic: number;
}

export class Vehicle {
  readonly id = nextId++;
  model: VehicleModel;
  x: number;
  y: number;
  angle: number;
  vx = 0;
  vy = 0;
  color: string;
  hp: number;
  driver: Ped | null = null;

  // control inputs (set by player controller or AI each frame)
  throttle = 0;
  steer = 0;
  handbrake = false;
  nitroOn = false;

  // derived each physics step
  forwardSpeed = 0;
  lateralSpeed = 0;

  nitro = 0.35;
  drifting = false;
  driftTime = 0;
  driftScore = 0;
  driftGrace = 0;

  burning = 0;
  destroyed = false;
  empTimer = 0;
  siren = false;
  lastAttacker: Ped | null = null;

  traffic: TrafficState | null = null;
  stuckTimer = 0;
  reverseTimer = 0;
  reverseSteer = 0;
  hornCooldown = 0;
  /** remove when far from player */
  persistent = false;
  tag: string | null = null;
  wreckTime = 0;
  lastWheels: { lx: number; ly: number; rx: number; ry: number } | null = null;

  constructor(model: VehicleModel, x: number, y: number, angle: number, color?: string) {
    this.model = model;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.color = color ?? pick(model.colors);
    this.hp = model.hp;
  }

  get isPolice() {
    return this.model.id === 'police' || this.model.id === 'swat';
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  get fx() {
    return Math.cos(this.angle);
  }
  get fy() {
    return Math.sin(this.angle);
  }

  /** Two collision circles along the car's long axis. */
  circles(): [number, number, number][] {
    const r = this.model.width / 2;
    const off = this.model.length / 2 - r;
    const fx = this.fx, fy = this.fy;
    return [
      [this.x + fx * off, this.y + fy * off, r],
      [this.x - fx * off, this.y - fy * off, r],
    ];
  }

  /** Point in oriented box test (with padding). */
  contains(px: number, py: number, pad = 0) {
    const dx = px - this.x, dy = py - this.y;
    const lx = dx * this.fx + dy * this.fy;
    const ly = -dx * this.fy + dy * this.fx;
    return Math.abs(lx) <= this.model.length / 2 + pad && Math.abs(ly) <= this.model.width / 2 + pad;
  }

  get usable() {
    return !this.destroyed && this.burning <= 0;
  }
}
