import { formatServerAnnounce } from './server-announce-text';

describe('formatServerAnnounce', () => {
  const item = (id: string) => (id === 'mat_divine_shard' ? 'Divine Shard' : id);
  const map = (id: string) => (id === 'map_town' ? 'Sierra Village' : id);
  const soon = (minutes: number) => ({ key: 'event.smashingSpree.soon', params: { minutes }, message: 'fallback' });

  it('Smashing Spree countdown in both languages, singular and plural', () => {
    expect(formatServerAnnounce(soon(1), 'en-US', item, map)).toBe('The Smashing Spree starts in 1 minute! Head to any town.');
    expect(formatServerAnnounce(soon(5), 'en-US', item, map)).toBe('The Smashing Spree starts in 5 minutes! Head to any town.');
    expect(formatServerAnnounce(soon(1), 'pt-BR', item, map)).toBe('O Quebra-Quebra começa em 1 minuto! Vá para qualquer cidade.');
    expect(formatServerAnnounce(soon(30), 'pt-BR', item, map)).toBe('O Quebra-Quebra começa em 30 minutos! Vá para qualquer cidade.');
  });

  it('start announcement', () => {
    const row = { key: 'event.smashingSpree.started', params: {}, message: 'fallback' };
    expect(formatServerAnnounce(row, 'en-US', item, map)).toBe('The Smashing Spree has begun! Break the vases in town!');
    expect(formatServerAnnounce(row, 'pt-BR', item, map)).toBe('O Quebra-Quebra começou! Quebre os vasos na cidade!');
  });

  it('gem find line', () => {
    const row = { key: 'event.smashingSpree.found', params: { name: 'Hero', itemId: 'mat_divine_shard', mapId: 'map_town' }, message: 'fallback' };
    expect(formatServerAnnounce(row, 'en-US', item, map)).toBe('Hero found Divine Shard in Sierra Village!');
    expect(formatServerAnnounce(row, 'pt-BR', item, map)).toBe('Hero encontrou Divine Shard em Sierra Village!');
  });

  it('unknown or missing key falls back to the server message', () => {
    expect(formatServerAnnounce({ key: 'nope', message: 'Server restart at 10:00' }, 'pt-BR', item, map)).toBe('Server restart at 10:00');
    expect(formatServerAnnounce({ message: 'Plain' }, 'en-US', item, map)).toBe('Plain');
  });
});
