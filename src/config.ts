// ---------------------------------------------------------------------------
// Global tuning constants and data definitions
// ---------------------------------------------------------------------------

export const TILE = 64;
/** One city block period in tiles: 2 road tiles + 1 sidewalk + 10 interior + 1 sidewalk. */
export const BLOCK = 14;
export const NUM_BLOCKS = 6;
export const MAP_TILES = NUM_BLOCKS * BLOCK + 2;
export const MAP_PX = MAP_TILES * TILE;

export enum Tile {
  Road = 0,
  Sidewalk = 1,
  Building = 2,
  Grass = 3,
  Plaza = 4,
  Tree = 5,
}

// --- Factions ---------------------------------------------------------------

export type FactionId = 0 | 1 | 2;

export interface FactionDef {
  id: FactionId;
  name: string;
  color: string;
  dark: string;
  /** The faction this gang is at war with. Killing members of `hates` pleases this gang. */
  hates: FactionId;
}

export const FACTIONS: FactionDef[] = [
  { id: 0, name: 'Neon Serpents', color: '#33ff77', dark: '#0d6b2e', hates: 1 },
  { id: 1, name: 'Iron Kings', color: '#ff8c1a', dark: '#7a3c00', hates: 2 },
  { id: 2, name: 'Ghost Cartel', color: '#b45cff', dark: '#4a1f75', hates: 0 },
];

/** Returns the faction that hates `f` (and therefore likes it when `f` dies). */
export function enemyOf(f: FactionId): FactionId {
  return FACTIONS.find((d) => d.hates === f)!.id;
}

export const RESPECT_HOSTILE = -30;
export const RESPECT_FRIENDLY = 30;

// --- Weapons ----------------------------------------------------------------

export type WeaponId = 'fists' | 'pistol' | 'smg' | 'shotgun' | 'emp';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: number;
  damage: number;
  /** shots per second */
  rate: number;
  speed: number;
  range: number;
  spread: number;
  pellets: number;
  maxAmmo: number;
  color: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: 'fists', name: 'Fäuste', slot: 1, damage: 12, rate: 2.5, speed: 0, range: 24, spread: 0, pellets: 0, maxAmmo: Infinity, color: '#fff' },
  pistol: { id: 'pistol', name: 'Pistole', slot: 2, damage: 26, rate: 3.2, speed: 950, range: 520, spread: 0.03, pellets: 1, maxAmmo: 150, color: '#ffe680' },
  smg: { id: 'smg', name: 'Maschinenpistole', slot: 3, damage: 13, rate: 11, speed: 1000, range: 460, spread: 0.09, pellets: 1, maxAmmo: 400, color: '#ffd24d' },
  shotgun: { id: 'shotgun', name: 'Schrotflinte', slot: 4, damage: 13, rate: 1.1, speed: 850, range: 300, spread: 0.32, pellets: 7, maxAmmo: 60, color: '#ffb84d' },
  emp: { id: 'emp', name: 'EMP-Werfer', slot: 5, damage: 0, rate: 0.8, speed: 520, range: 560, spread: 0, pellets: 1, maxAmmo: 6, color: '#6be4ff' },
};

export const WEAPON_ORDER: WeaponId[] = ['fists', 'pistol', 'smg', 'shotgun', 'emp'];

// --- Vehicles ---------------------------------------------------------------

export type VehicleModelId = 'sedan' | 'sports' | 'taxi' | 'van' | 'truck' | 'police' | 'swat' | 'armored';

export interface VehicleModel {
  id: VehicleModelId;
  name: string;
  length: number;
  width: number;
  maxSpeed: number;
  accel: number;
  grip: number;
  turnRate: number;
  hp: number;
  mass: number;
  colors: string[];
}

export const VEHICLES: Record<VehicleModelId, VehicleModel> = {
  sedan: { id: 'sedan', name: 'Sedan', length: 44, width: 22, maxSpeed: 360, accel: 270, grip: 9, turnRate: 2.7, hp: 100, mass: 1, colors: ['#3b6fd6', '#c93b3b', '#d9d9d9', '#2f2f2f', '#4f9c5a', '#8a5bd1'] },
  sports: { id: 'sports', name: 'Sportwagen', length: 42, width: 21, maxSpeed: 480, accel: 400, grip: 10, turnRate: 3.1, hp: 80, mass: 0.9, colors: ['#ff2a2a', '#ffcc00', '#00d0ff', '#ff5ad1'] },
  taxi: { id: 'taxi', name: 'Taxi', length: 44, width: 22, maxSpeed: 350, accel: 260, grip: 9, turnRate: 2.7, hp: 100, mass: 1, colors: ['#ffc81a'] },
  van: { id: 'van', name: 'Lieferwagen', length: 50, width: 24, maxSpeed: 300, accel: 210, grip: 8, turnRate: 2.3, hp: 130, mass: 1.5, colors: ['#e8e8e8', '#7a8a99', '#a0522d'] },
  truck: { id: 'truck', name: 'Truck', length: 62, width: 26, maxSpeed: 260, accel: 170, grip: 8, turnRate: 1.9, hp: 190, mass: 2.3, colors: ['#6b4f2a', '#2e5e8a', '#8a2e2e'] },
  police: { id: 'police', name: 'Polizei', length: 46, width: 22, maxSpeed: 440, accel: 350, grip: 10, turnRate: 2.9, hp: 150, mass: 1.25, colors: ['#1c2c66'] },
  swat: { id: 'swat', name: 'SWAT-Van', length: 54, width: 26, maxSpeed: 390, accel: 280, grip: 9, turnRate: 2.4, hp: 280, mass: 2.1, colors: ['#1b1b1b'] },
  armored: { id: 'armored', name: 'Geldtransporter', length: 56, width: 26, maxSpeed: 230, accel: 150, grip: 8, turnRate: 2.0, hp: 520, mass: 3, colors: ['#4d5b4a'] },
};

export const CIVILIAN_MODELS: VehicleModelId[] = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'truck', 'sports'];

// --- Wanted -----------------------------------------------------------------

/** Heat needed for 1..5 stars. Index 0 = 0 stars. */
export const WANTED_THRESHOLDS = [0, 20, 120, 260, 420, 600];
export const WANTED_MAX_HEAT = 720;
export const POLICE_CARS_PER_STAR = [0, 0, 1, 2, 3, 4];
export const POLICE_FOOT_PER_STAR = [0, 1, 2, 2, 3, 4];
/** Cost of a respray (clears wanted level, repairs the car). */
export const SPRAY_COST = 200;

export const CRIME = {
  shot: 2,
  hitPed: 15,
  killCivilian: 45,
  killGang: 18,
  killCop: 80,
  carjack: 25,
  carjackCop: 120,
  destroyCar: 30,
  destroyPolice: 130,
  ramPolice: 12,
  punchCop: 30,
  bigHeist: 260,
};

// --- Player -----------------------------------------------------------------

export const PLAYER_WALK = 130;
export const PLAYER_RUN = 200;
export const PED_RADIUS = 7;
