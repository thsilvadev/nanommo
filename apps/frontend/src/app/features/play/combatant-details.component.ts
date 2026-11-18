import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

export interface CombatantStatRow { label: string; value: string }
export interface CombatantDropRow { name: string; percent: number }

/** Shared snapshot vocabulary for monsters and future player target details. */
export function combatantStatRows(snapshot: object | null | undefined): CombatantStatRow[] {
  const values = (snapshot ?? {}) as Record<string, unknown>;
  return [['ATK','atk'],['MATK','matk'],['DEF','def'],['MDEF','mdefPercent'],['ACC','accuracy'],['EVA','evasion'],['CRIT','critChance']].map(([label,key]) => ({
    label, value: values[key] == null ? '—' : String(values[key]) + (key === 'mdefPercent' || key === 'critChance' ? '%' : ''),
  }));
}

/** Omit drops for players; pass an array (including empty) for monsters. */
@Component({
  selector: 'app-combatant-details', standalone: true, imports: [CommonModule],
  template: `
    <small class="portrait-section-label">STATS</small>
    <div class="portrait-detail-row" *ngFor="let stat of stats"><span>{{stat.label}}</span><b>{{stat.value}}</b></div>
    <ng-container *ngIf="drops !== null">
      <small class="portrait-section-label portrait-drops-heading">DROPS</small>
      <div class="portrait-detail-row" *ngFor="let drop of drops"><span>{{drop.name}}</span><b>{{drop.percent | number:'1.0-3'}}%</b></div>
      <small *ngIf="!drops?.length">No listed drops.</small>
    </ng-container>`,
})
export class CombatantDetailsComponent {
  @Input() stats: CombatantStatRow[] = [];
  @Input() drops: CombatantDropRow[] | null = null;
}
