import { battleEventText } from './battle-event-text';

describe('battleEventText — items used on someone else', () => {
  const name = (id: string) => ({ tonic_haste_shot: 'Haste Shot', mega_elixir: 'Mega Elixir' } as Record<string, string>)[id] ?? id;
  it('names the target when it is not the user', () => {
    expect(battleEventText({ action: 'use_item', itemId: 'tonic_haste_shot' }, 'Hero', 'Unicorn', name)).toBe('Hero uses Haste Shot on Unicorn.');
    expect(battleEventText({ action: 'use_item', itemId: 'mega_elixir', healAmount: 50 }, 'Hero', 'Mira', name)).toBe('Hero uses Mega Elixir on Mira and restores 50 HP.');
  });
  it('stays as before when used on oneself', () => {
    expect(battleEventText({ action: 'use_item', itemId: 'mega_elixir', healAmount: 50 }, 'Hero', 'Hero', name)).toBe('Hero uses Mega Elixir and restores 50 HP.');
  });
});
