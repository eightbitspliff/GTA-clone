import { FactionId, PED_RADIUS, WeaponId } from '../config';
import type { Vehicle } from './Vehicle';

export type PedKind = 'player' | 'civilian' | 'gang' | 'cop';
export type PedState = 'wander' | 'flee' | 'attack' | 'chase' | 'idle';

let nextId = 1;

const SHIRTS = ['#c94f4f', '#4f7cc9', '#d6c35a', '#59a86b', '#9c6bc4', '#d98c3f', '#e0e0e0', '#3a3a3a', '#c46b9c'];
const SKINS = ['#f1c9a5', '#d9a77c', '#a8724d', '#7a4b2e', '#e8b98f'];

export class Ped {
  readonly id = nextId++;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  angle = Math.random() * Math.PI * 2;
  radius = PED_RADIUS;
  hp = 100;
  maxHp = 100;
  armor = 0;
  alive = true;
  deadTime = 0;
  kind: PedKind;
  faction: FactionId | -1 = -1;
  vehicle: Vehicle | null = null;

  weapon: WeaponId = 'fists';
  ammo: Record<WeaponId, number> = { fists: Infinity, pistol: 0, smg: 0, shotgun: 0, emp: 0 };
  cooldown = 0;

  shirt: string;
  skin: string;
  walkPhase = Math.random() * 10;

  // --- AI state ---
  state: PedState = 'wander';
  stateTimer = 0;
  target: Ped | null = null;
  goalX = 0;
  goalY = 0;
  hasGoal = false;
  fleeX = 0;
  fleeY = 0;
  reaction = 0;
  stunTimer = 0;
  /** Persistent: this gang member was spawned for an event / mission. */
  tag: string | null = null;
  /** Mission target marker */
  marked = false;
  lastAttacker: Ped | null = null;
  bustTimer = 0;
  /** Turf-war enemy faction this ped fights regardless of player respect. */
  warWith: FactionId | -1 = -1;

  constructor(kind: PedKind, x: number, y: number) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.shirt = SHIRTS[Math.floor(Math.random() * SHIRTS.length)];
    this.skin = SKINS[Math.floor(Math.random() * SKINS.length)];
  }

  give(w: WeaponId, amount: number) {
    this.ammo[w] = (this.ammo[w] || 0) + amount;
  }

  hasAmmo(w: WeaponId = this.weapon) {
    return w === 'fists' || this.ammo[w] > 0;
  }
}
