// ---------------------------------------------------------------------------
// Faction / respect system (GTA2 style): three rival gangs in a circular
// feud. Killing members of a gang lowers its respect and raises the respect
// of the gang that hates it.
// ---------------------------------------------------------------------------

import { FACTIONS, FactionId, RESPECT_FRIENDLY, RESPECT_HOSTILE, enemyOf } from '../config';
import type { Game } from '../core/Game';
import { clamp } from '../core/math';
import type { Ped } from '../entities/Ped';

export class FactionSystem {
  respect: number[] = [0, 0, 0];
  /** brief UI pulse per faction when respect changes */
  pulse: number[] = [0, 0, 0];

  constructor(private g: Game) {}

  isHostile(f: FactionId | -1) {
    return f >= 0 && this.respect[f] <= RESPECT_HOSTILE;
  }

  isFriendly(f: FactionId | -1) {
    return f >= 0 && this.respect[f] >= RESPECT_FRIENDLY;
  }

  add(f: FactionId, amount: number) {
    const before = this.respect[f];
    this.respect[f] = clamp(before + amount, -100, 100);
    this.pulse[f] = 1;
    const name = FACTIONS[f].name;
    const col = FACTIONS[f].color;
    if (before > RESPECT_HOSTILE && this.respect[f] <= RESPECT_HOSTILE) this.g.message(`Die ${name} wollen dich tot sehen!`, col);
    if (before <= RESPECT_HOSTILE && this.respect[f] > RESPECT_HOSTILE) this.g.message(`Die ${name} lassen dich in Ruhe.`, col);
    if (before < RESPECT_FRIENDLY && this.respect[f] >= RESPECT_FRIENDLY) this.g.message(`Die ${name} respektieren dich – sie geben dir Deckung!`, col);
  }

  onPlayerKill(p: Ped) {
    if (p.kind !== 'gang' || p.faction < 0) return;
    const f = p.faction as FactionId;
    this.add(f, -8);
    this.add(enemyOf(f), +5);
    this.g.money += 40;
  }

  update(dt: number) {
    for (let i = 0; i < 3; i++) this.pulse[i] = Math.max(0, this.pulse[i] - dt * 2);
  }
}
