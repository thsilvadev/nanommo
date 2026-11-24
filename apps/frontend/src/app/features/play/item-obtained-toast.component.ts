import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { GameSocketService } from '../../core/game.socket.service';
import { CatalogService } from '../../core/catalog.service';
import { LocaleService } from '../../core/locale.service';

type ObtainedEvent = { items?: Array<{ itemId: string; quantity: number }>; source?: string };
type Shown = { itemId: string; quantity: number };

/** How long one "item obtained" line stays on screen. */
export const ITEM_OBTAINED_MS = 4000;

const RARITY_COLORS: Record<string, string> = {
  common: '#1b1b1b', uncommon: '#2f7d32', rare: '#1f5fbf', epic: '#7b2fbf', legendary: '#c46a00',
};

/**
 * Ragnarok-style "item obtained" line: one box at a time, centred above the
 * notification band. A newer gain replaces it in place (no transition) and
 * restarts its 4 s. Several items obtained at once show only the first.
 */
@Component({
  selector: 'app-item-obtained-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="item-obtained" *ngIf="shown() as item" role="status" aria-live="polite">
      <img [src]="icon(item.itemId)" alt="" width="18" height="18">
      <span class="text"><span class="name" [style.color]="color(item.itemId)">{{ name(item.itemId) }}</span> – {{ item.quantity }} {{ suffix() }}</span>
    </div>
  `,
  styles: [`
    :host{position:fixed;inset:0;z-index:2500;pointer-events:none}
    .item-obtained{position:absolute;top:14vh;left:50%;transform:translateX(-50%);box-sizing:border-box;max-width:min(560px,calc(100vw - 28px));display:flex;align-items:center;gap:7px;padding:4px 12px 4px 7px;background:rgba(255,255,255,.88);border:1px solid #9aa3b5;border-radius:3px;box-shadow:0 2px 8px rgba(0,0,0,.35);color:#1b1b1b;font:13px/1.3 Tahoma,Verdana,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:none;animation:none}
    .item-obtained img{flex:0 0 18px;width:18px;height:18px;object-fit:contain}
    .text{overflow:hidden;text-overflow:ellipsis}
    .name{font-weight:600}
    @media(max-width:600px){.item-obtained{top:11vh;font-size:12px}}
  `],
})
export class ItemObtainedToastComponent implements OnInit, OnDestroy {
  private readonly socket = inject(GameSocketService);
  private readonly catalog = inject(CatalogService);
  private readonly locale = inject(LocaleService);
  readonly shown = signal<Shown | null>(null);
  private subscription: Subscription | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.subscription = this.socket.on<ObtainedEvent>('inventory:obtained').subscribe((event) => this.show(event));
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
  }

  name(itemId: string): string { return this.catalog.itemName(itemId); }
  icon(itemId: string): string { return this.catalog.itemIcon(itemId); }
  color(itemId: string): string { return RARITY_COLORS[String((this.catalog.item(itemId) as { rarity?: string } | undefined)?.rarity ?? 'common')] ?? RARITY_COLORS['common']; }
  suffix(): string { return this.locale.locale() === 'pt-BR' ? 'obtido(s).' : 'obtained.'; }

  private show(event: ObtainedEvent | null | undefined): void {
    const first = (event?.items ?? []).find((item) => item?.itemId && Number(item.quantity) > 0);
    if (!first) return;
    this.shown.set({ itemId: first.itemId, quantity: Number(first.quantity) });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.shown.set(null); }, ITEM_OBTAINED_MS);
  }
}
