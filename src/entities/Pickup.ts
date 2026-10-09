import { WeaponId } from '../config';

export type PickupKind = 'weapon' | 'health' | 'armor' | 'cash';

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  weapon?: WeaponId;
  amount: number;
  /** seconds until respawn; 0 = active */
  respawn: number;
  /** respawn delay; 0 = one-shot pickup (removed once collected) */
  respawnDelay: number;
  active: boolean;
  bob: number;
}
