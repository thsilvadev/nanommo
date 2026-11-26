// A quest whose item reward does not fit in the bag is refused with QUEST_REWARD_NO_SPACE (the client shows
// "Free up space to receive your reward." in red), before anything is consumed. Run after `pnpm --filter @nanommo/api build`.
const assert = require('node:assert/strict');
const { QuestService } = require('../dist/apps/api/src/modules/quests/quest.service');
(async () => {
  const service = Object.create(QuestService.prototype);
  const full = Array.from({ length: 200 }, (_, i) => ({ itemId: `mat_${i}`, quantity: 1, instanceData: null }));
  let consumed = false;
  const instance = { id: 'qi1', characterId: 'c1', questId: 'q1', status: 'active', progress: {} };
  const manager = { getRepository: () => ({ findOne: async () => instance, save: async () => undefined }) };
  Object.assign(service, {
    instances: { manager: { transaction: async (fn) => fn(manager) } },
    withExpiry: async () => undefined, characterAtTown: async () => ({ id: 'c1' }), expire: async () => undefined,
    definition: () => ({ id: 'q1', objectives: [], rewards: { items: [{ itemId: 'mega_elixir', quantity: 1 }] } }),
    deliveryRequirements: () => [], rowsAfterDelivery: async () => full,
    rewardInstances: () => [{ itemId: 'mega_elixir', quantity: 1, instanceData: null }],
    consumeRequirements: async () => { consumed = true; },
    data: { getItemById: (id) => ({ id, stackable: true, maxStack: 20 }) },
  });
  const error = await service.turnIn('c1', 'qi1').then(() => null, (e) => e);
  assert(error, 'refused');
  assert.equal(error.getResponse().code, 'QUEST_REWARD_NO_SPACE');
  assert.equal(error.getResponse().message, 'Free up space to receive your reward.');
  assert.equal(consumed, false, 'nothing delivered or consumed');
  console.log('quest-reward-no-space: refused with QUEST_REWARD_NO_SPACE before consuming anything');
})().catch((e) => { console.error(e); process.exitCode = 1; });
