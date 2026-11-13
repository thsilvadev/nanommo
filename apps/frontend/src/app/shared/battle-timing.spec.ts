import { battleTickAt, battleTickDurationMs, battleTickExpiryRemainingSeconds } from './battle-timing';

describe('battle timing metadata', () => {
  const entry = { startAt: '2026-11-13T12:00:00.000Z', tickDurationMs: 500 };

  it('uses the persisted per-entry duration and does not fall back to an implicit global clock', () => {
    expect(battleTickDurationMs(entry)).toBe(500);
    expect(battleTickDurationMs({ startAt: entry.startAt })).toBeNull();
    expect(battleTickDurationMs({ tickDurationMs: 0 })).toBeNull();
    expect(battleTickDurationMs({ log: { header: { tickDurationMs: 500 } } })).toBe(500);
  });

  it('projects elapsed ticks at exact 500 ms boundaries', () => {
    expect(battleTickAt(entry, Date.parse(entry.startAt))).toBe(0);
    expect(battleTickAt(entry, Date.parse(entry.startAt) + 499)).toBe(0);
    expect(battleTickAt(entry, Date.parse(entry.startAt) + 500)).toBe(1);
    expect(battleTickAt({ startAt: entry.startAt }, Date.parse(entry.startAt) + 1000)).toBeNull();
  });

  it('converts tick-based status expiry back to seconds using the same entry clock', () => {
    expect(battleTickExpiryRemainingSeconds(entry, 4, Date.parse(entry.startAt))).toBe(2);
    expect(battleTickExpiryRemainingSeconds(entry, 4, Date.parse(entry.startAt) + 1500)).toBe(1);
    expect(battleTickExpiryRemainingSeconds({ startAt: entry.startAt }, 4, Date.parse(entry.startAt))).toBeNull();
  });
});
