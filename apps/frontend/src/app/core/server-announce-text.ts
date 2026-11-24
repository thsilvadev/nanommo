import type { GameLocale } from './locale.service';

export interface AnnounceRow { key?: string; params?: Record<string, unknown>; message: string }

/** The event town's name, or null when the row names none. */
const eventTown = (p: Record<string, unknown>, mapName: (id: string) => string): string | null => (typeof p['mapId'] === 'string' && p['mapId'] ? mapName(p['mapId']) : null);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Localized text of a server announcement (`server_announce`) or a Smashing
 * Spree find line (`event_find`). Unknown keys show the server's English text.
 */
export function formatServerAnnounce(row: AnnounceRow, locale: GameLocale, itemName: (id: string) => string, mapName: (id: string) => string): string {
  const p = row.params ?? {};
  const pt = locale === 'pt-BR';
  switch (row.key) {
    case 'event.smashingSpree.soon': {
      const n = Number(p['minutes']);
      if (!Number.isFinite(n)) return row.message;
      // Older rows (before the event moved to Sierra Village) carry no mapId.
      const town = eventTown(p, mapName);
      return pt
        ? `O Quebra-Quebra começa em ${plural(n, 'minuto', 'minutos')}! Vá para ${town ?? 'qualquer cidade'}.`
        : `The Smashing Spree starts in ${plural(n, 'minute', 'minutes')}! Head to ${town ?? 'any town'}.`;
    }
    case 'event.smashingSpree.started': {
      const town = eventTown(p, mapName);
      return pt ? `O Quebra-Quebra começou! Quebre os vasos ${town ? `em ${town}` : 'na cidade'}!` : `The Smashing Spree has begun! Break the vases in ${town ?? 'town'}!`;
    }
    case 'event.smashingSpree.found': {
      const name = String(p['name'] ?? '');
      const item = itemName(String(p['itemId'] ?? ''));
      const town = mapName(String(p['mapId'] ?? ''));
      return pt ? `${name} encontrou ${item} em ${town}!` : `${name} found ${item} in ${town}!`;
    }
    default:
      return row.message;
  }
}
