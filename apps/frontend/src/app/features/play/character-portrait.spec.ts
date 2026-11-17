import { portraitAnimationSource, portraitHandTypes, portraitModel } from './character-portrait';

describe('character portrait', () => {
  const items: Record<string, { weaponType?: string }> = {
    equip_sword_t1: { weaponType: 'sword' },
    equip_shield_t1: { weaponType: 'shield' },
    equip_bow_t2: { weaponType: 'bow' },
    equip_helmet_t1: {},
    equip_odd: { weaponType: 'axe' },
  };
  const lookup = (id: string) => items[id];

  it('reads the hand item types from the equipped items', () => {
    expect(portraitHandTypes([{ slot: 'mainHand', itemId: 'equip_sword_t1' }, { slot: 'offHand', itemId: 'equip_shield_t1' }, { slot: 'head', itemId: 'equip_helmet_t1' }], lookup))
      .toEqual({ main: 'sword', off: 'shield' });
    expect(portraitHandTypes([{ slot: 'mainHand', itemId: 'equip_bow_t2' }], lookup)).toEqual({ main: 'bow', off: null });
    expect(portraitHandTypes([], lookup)).toEqual({ main: null, off: null });
  });

  it('ignores unknown items and weapon types the viewer has no model for', () => {
    expect(portraitHandTypes([{ slot: 'mainHand', itemId: 'missing' }, { slot: 'offHand', itemId: 'equip_odd' }], lookup)).toEqual({ main: null, off: null });
  });

  it('only builds a model for a character that has an appearance', () => {
    expect(portraitModel(null)).toBeNull();
    expect(portraitModel({ sex: null, heightCm: null, appearance: null, dominantHand: 'right' } as any)).toBeNull();
    const appearance = { v: 1 } as any;
    expect(portraitModel({ sex: 'female', heightCm: 170, appearance, dominantHand: 'left' } as any))
      .toEqual({ sex: 'female', heightCm: 170, appearance, dominantHand: 'left' });
  });

  it('animates from the stores at call time: town idles, grinding walks, a running battle fights', () => {
    const startAt = '2026-11-17T12:00:00.000Z';
    const start = Date.parse(startAt);
    let character: { status: string } | null = { status: 'town' };
    let battle: any = null;
    const source = portraitAnimationSource(() => character, () => battle);
    expect(source(start)).toEqual({ base: 'Idle' });
    character = { status: 'grinding' };
    expect(source(start)).toEqual({ base: 'Walk' });
    battle = { startAt, endAt: '2026-11-17T12:01:00.000Z', tickDurationMs: 500, outcome: 'win',
      log: { events: [{ tick: 4, actor: 'character', action: 'attack', target: 'monster', damage: 3 }] } };
    expect(source(start + 4 * 500 + 10)).toEqual({ base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: start + 2000, speed: 1 } });
  });
});
