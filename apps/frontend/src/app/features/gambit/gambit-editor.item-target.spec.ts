import { GambitEditorComponent } from './gambit-editor.component';

describe('GambitEditorComponent — Use item (Self / Ally / Foe)', () => {
  const items: any[] = [
    { id: 'mega_elixir', type: 'consumable', effect: { type: 'heal_hp_sp' } },
    { id: 'tonic_haste_shot', type: 'consumable', effect: { type: 'apply_status', status: 'haste_shot' } },
    { id: 'fairy_in_a_bottle', type: 'consumable', effect: { type: 'revive_full_cleanse' } },
    { id: 'super_tonic_sapupema_tea', type: 'consumable', effect: { type: 'revive_ally' } },
  ];
  const conditions = [
    { id: 'self_hp', scope: 'Self' }, { id: 'self_has_status', scope: 'Self' },
    { id: 'ally_hp', scope: 'Ally' }, { id: 'ally_has_status', scope: 'Ally' },
    { id: 'foe_has_status', scope: 'Foe' },
  ];
  const actions = [{ id: 'attack', label: 'Attack current target' }, { id: 'use_skill', label: 'Use skill...' }, { id: 'use_item', label: 'Use item...', params: [{ name: 'itemId', type: 'itemRef' }] }];
  let editor: any;
  beforeEach(() => {
    editor = Object.create(GambitEditorComponent.prototype);
    editor.catalog = { gambits: () => ({ conditions, actions }), items: () => items, item: (id: string) => items.find((i) => i.id === id) };
    editor.character = { character: () => ({ knownItemIds: items.map((i) => i.id) }) };
    editor.pages = Object.assign(() => [], { set: () => undefined });
    editor.lines = () => [];
  });
  const line = (condition: any, action: any = { id: 'attack' }) => ({ priority: 1, conditions: [condition], action, enabled: true });
  const keys = (l: any) => editor.actionChoicesForLine(l).map((c: any) => c.key);
  const ids = (l: any) => editor.itemOptionsForLine(l).map((i: any) => i.id);

  it('Self condition offers only Use item (Self)', () => {
    expect(keys(line({ id: 'self_hp', params: {} }))).toEqual(['attack', 'use_skill', 'use_item:self']);
  });
  it('Ally condition offers Ally and Self; Foe condition offers Foe and Self', () => {
    expect(keys(line({ id: 'ally_hp', params: {} }))).toEqual(['attack', 'use_skill', 'use_item:ally', 'use_item:self']);
    expect(keys(line({ id: 'foe_has_status', params: { status: 'magic_prowess' } }))).toEqual(['attack', 'use_skill', 'use_item:foe', 'use_item:self']);
    expect(editor.actionChoicesForLine(line({ id: 'foe_has_status', params: {} }))[2].label).toBe('Use item (Foe)...');
  });
  it('picking an option stores the target; legacy lines show their old target', () => {
    const l: any = line({ id: 'foe_has_status', params: { status: 'magic_prowess' } });
    editor.changeAction(l, 'use_item:foe');
    expect(l.action).toEqual({ id: 'use_item', params: { target: 'foe' } });
    expect(editor.actionKey(line({ id: 'foe_has_status', params: {} }, { id: 'use_item', params: { itemId: 'tonic_haste_shot' } }))).toBe('use_item:self');
    expect(editor.actionKey(line({ id: 'ally_hp', params: {} }, { id: 'use_item', params: { itemId: 'mega_elixir' } }))).toBe('use_item:ally');
  });
  it('items follow the target: no revive items on a foe, Sapupema only for a KO ally, Fairy only for Self KO', () => {
    expect(ids(line({ id: 'foe_has_status', params: {} }, { id: 'use_item', params: { target: 'foe' } }))).toEqual(['mega_elixir', 'tonic_haste_shot']);
    expect(ids(line({ id: 'ally_has_status', params: { status: 'ko' } }, { id: 'use_item', params: { target: 'ally' } }))).toEqual(['super_tonic_sapupema_tea']);
    expect(ids(line({ id: 'ally_has_status', params: { status: 'ko' } }, { id: 'use_item', params: { target: 'self' } }))).toEqual(['mega_elixir', 'tonic_haste_shot']);
    expect(ids(line({ id: 'self_has_status', params: { status: 'ko' } }, { id: 'use_item', params: { target: 'self' } }))).toEqual(['fairy_in_a_bottle']);
    expect(ids(line({ id: 'self_hp', params: {} }, { id: 'use_item', params: { target: 'self' } }))).toEqual(['mega_elixir', 'tonic_haste_shot']);
  });
  it('changing the condition keeps the action on an allowed target and drops an item that no longer fits', () => {
    const l: any = line({ id: 'foe_has_status', params: {} }, { id: 'use_item', params: { target: 'foe', itemId: 'tonic_haste_shot' } });
    editor.changeCondition(l, 0, 'self_hp');
    expect(l.action).toEqual({ id: 'use_item', params: { target: 'self', itemId: 'tonic_haste_shot' } });
    const s: any = line({ id: 'ally_has_status', params: { status: 'ko' } }, { id: 'use_item', params: { target: 'ally', itemId: 'super_tonic_sapupema_tea' } });
    editor.changeCondition(s, 0, 'ally_hp');
    expect(s.action).toEqual({ id: 'use_item', params: { target: 'ally' } });
  });
});
