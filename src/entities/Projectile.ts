import { WeaponId } from '../config';
import type { Ped } from './Ped';
import type { Vehicle } from './Vehicle';

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  weapon: WeaponId;
  owner: Ped | null;
  ownerVehicle: Vehicle | null;
  dead: boolean;
  px: number;
  py: number;
}
