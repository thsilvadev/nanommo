const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BattleEngine } = require('../../../packages/shared/dist/battle-engine');
const { chatRetentionLimit, GlobalChatHistoryService, TransientChatHistoryService, IdleJournalService } = require('../dist/apps/api/src/modules/chat/chat-history.service');
const { ChatService } = require('../dist/apps/api/src/modules/chat/chat.service');
const { BadRequestException, HttpException } = require('@nestjs/common');

const root = path.resolve(__dirname, '../../..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const monstersData = read('monsters.json');
const itemsData = read('items.json');
const mapsData = read('maps.json');
const skillsData = read('skill_trees.json');
const statusesData = read('status_effects.json');
const mirrored = {
  monsters: read('apps/frontend/public/data/monsters.json'),
  items: read('apps/frontend/public/data/items.json'),
  maps: read('apps/frontend/public/data/maps.json'),
  skills: read('apps/frontend/public/data/skill_trees.json'),
  statuses: read('apps/frontend/public/data/status_effects.json'),
};
const byId = (rows, id) => rows.find(row => row.id === id);
const monsterById = (id) => byId(monstersData.monsters, id);
const itemById = (id) => [...itemsData.monsterParts, ...itemsData.materials, ...itemsData.food, ...itemsData.consumables, ...itemsData.equipment].find(row => row.id === id);
const statusDefs = Object.fromEntries(statusesData.statusEffects.map(row => [row.id, row]));
const monsterSkillDefs = Object.fromEntries(skillsData.monsterSkills.map(row => [row.id, row]));

function testCatalogue() {
  assert.deepEqual(monstersData, mirrored.monsters, 'canonical monster catalogue matches its public mirror');
  assert.deepEqual(itemsData, mirrored.items, 'canonical item catalogue matches its public mirror');
  assert.deepEqual(mapsData, mirrored.maps, 'canonical world map matches its public mirror');
  assert.deepEqual(skillsData, mirrored.skills, 'canonical skill catalogue matches its public mirror');
  assert.deepEqual(statusesData, mirrored.statuses, 'canonical status catalogue matches its public mirror');

  const bee = monsterById('mon_mutantbee');
  const mantis = monsterById('mon_giantmantis');
  const treant = monsterById('mon_flamingtreant');
  assert(bee && mantis && treant, 'all three added species exist');
  assert.equal(bee.level, 5);
  assert.equal(bee.xpReward, 112, 'level 5 follows the low-level +30% XP rule');
  assert.equal(mantis.level, 36);
  assert.equal(mantis.xpReward, 832, 'Giant Mantis follows the standard monster XP curve');
  assert.equal(mantis.evasion, 150);
  assert.equal(mantis.isAggressive, false);
  assert.equal(bee.isAggressive, true);
  assert.equal(treant.level, 38);
  assert.equal(treant.xpReward, 885, 'Flaming Treant follows the standard monster XP curve');
  assert.equal(treant.isAggressive, true);
  assert.equal(treant.basicAttackDamageType, 'melee');
  assert.equal(treant.combatStyle, 'melee');
  assert(treant.elementalResistances.includes('fire'));
  assert.equal(treant.elementalDamageTakenMultiplier.fire, 0);

  // The documented estimated level-38 baseline is ATK 200, a 6-tick attack
  // interval and world Move Speed 55: ATK ×1.40, interval round(6/0.80)=8,
  // and Move Speed base round(55×0.80)=44.
  assert.equal(treant.atk, Math.round(200 * 1.4));
  assert.equal(treant.atkSpeedTicks, Math.round(6 / 0.8));
  assert.equal(treant.moveSpeedBase, Math.round(55 * 0.8));
  assert.equal(treant.moveSpd, treant.moveSpeedBase + treant.level - 1);

  const expectedRosters = {
    map_green_grounds_1: { mon_mutantbee: 60, mon_fieldbat: 8, mon_thornsprout: 32 },
    map_green_grounds_4: { mon_mutantbee: 35, mon_fieldbat: 13, mon_mudcrawler: 52 },
    map_caete_0: { mon_giantmantis: 15, mon_rootboundbrute: 8.5, mon_moonleafarcanist: 55.25, mon_kwaiouaranger: 21.25 },
    map_kwaioua_forest_5: { mon_giantmantis: 50, mon_rootboundbrute: 22.5, mon_venomviper: 17.5, mon_mudflatcrocodile: 10 },
    map_kwaioua_forest_6: { mon_flamingtreant: 30, mon_arcanewisp: 22.4, mon_kwaiouaranger: 22.4, mon_venomviper: 11.2, mon_rootboundbrute: 14 },
    map_kwaioua_forest_7: { mon_flamingtreant: 35, mon_arcanewisp: 22.1, mon_kwaiouaranger: 16.9, mon_venomviper: 13, mon_rootboundbrute: 13 },
  };
  assert.deepEqual(Object.fromEntries(byId(mapsData.maps,'map_green_grounds_5').monsters.map(entry => [entry.monsterId, entry.presenceRate])),
    { mon_mudcrawler: 95, mon_thornsprout: 5 }, 'current Green Grounds 5 is the former GG6 and retains its existing roster');
  for (const [mapId, expected] of Object.entries(expectedRosters)) {
    const map = byId(mapsData.maps, mapId);
    assert(map, mapId + ' exists');
    assert.deepEqual(Object.fromEntries(map.monsters.map(entry => [entry.monsterId, entry.presenceRate])), expected, mapId + ' uses exact requested roster');
    assert(Math.abs(map.monsters.reduce((sum, entry) => sum + entry.presenceRate, 0) - 100) < 0.001, mapId + ' roster totals 100%');
  }

  const allowedGathering = new Map([
    ['map_green_grounds_0', { mat_wheat: 50, mat_milk: 50 }],
    ['map_green_grounds_1', { mat_cabbage: 40, mat_carrot: 40, mat_honeycomb: 20 }],
    ['map_green_grounds_2', { mat_cabbage: 50, mat_carrot: 50 }],
    ['map_green_grounds_3', { mat_wheat: 100 }],
    ['map_green_grounds_4', { mat_sugar: 80, mat_honeycomb: 20 }],
    ['map_green_grounds_5', { mat_sugar: 100 }],
    ['map_menace_hills_1', { mat_wild_blueberries: 100 }],
    ['map_menace_hills_3', { mat_wild_blueberries: 100 }],
    ['map_ipora_beach_0', { mat_cooking_oil: 100 }],
    ['map_ipora_beach_1', { mat_cooking_oil: 100 }],
  ]);
  for (const map of mapsData.maps) {
    if (/^map_kwaioua_forest_[0-7]$/.test(map.id) || /^map_forest_ruins_[0-3]$/.test(map.id) || /^map_caete_[0-7]$/.test(map.id)) {
      allowedGathering.set(map.id, { mat_herbs: 100 });
    }
    const expected = allowedGathering.get(map.id);
    if (!expected) {
      assert.equal(map.gatheringPool, undefined, map.id + ' has no unassigned gathering pool');
      continue;
    }
    assert.deepEqual(Object.fromEntries(map.gatheringPool.map(entry => [entry.itemId, entry.weight])), expected, map.id + ' has its exact regional material allow-list');
    assert.equal(map.gatheringPool.reduce((sum, entry) => sum + entry.weight, 0), 100);
    assert(!map.gatheringPool.some(entry => entry.itemId === 'mat_meat'));
  }
  const honeycombMaps = mapsData.maps.filter(map => map.gatheringPool?.some(entry => entry.itemId === 'mat_honeycomb')).map(map => map.id).sort();
  assert.deepEqual(honeycombMaps, ['map_green_grounds_1', 'map_green_grounds_4']);

  const requiredParts = [
    ['part_mutantbee_common', "Mutant Bee's Stinger"], ['part_mutantbee_rare', 'Mutant Bee Royal Jelly'],
    ['part_giantmantis_common', 'Fun Purple Paint'], ['part_giantmantis_rare', 'Giant Mantis Scythe Blade'],
    ['part_flamingtreant_common', "Forest Ancient's Teardrop"], ['part_flamingtreant_rare', 'Flame-Hollow Heartwood'],
  ];
  for (const [id, name] of requiredParts) {
    const item = byId(itemsData.monsterParts, id);
    assert(item, id + ' exists');
    assert.equal(item.name, name);
    assert(item.sellPriceToVendor > 0);
    assert(fs.existsSync(path.join(root, 'apps/frontend/assets/ui/items/svg/monster_parts', id + '.svg')), id + ' has an item icon');
  }
  for (const id of ['mon_mutantbee', 'mon_giantmantis', 'mon_flamingtreant']) {
    const spritePath = path.join(root, 'apps/frontend/assets/monsters', id + '.svg');
    assert(fs.existsSync(spritePath), id + ' has a sprite');
    const source = fs.readFileSync(spritePath, 'utf8');
    assert(/width="167"/.test(source) && /height="199"/.test(source) && /viewBox="0 0 167 199"/.test(source), id + ' sprite retains a 167×199 canvas');
    assert(!/<rect[^>]+width="167"[^>]+height="199"[^>]+fill="#/.test(source), id + ' sprite does not paint an opaque canvas background');
  }
  assert(fs.existsSync(path.join(root, 'apps/frontend/assets/ui/status/tip_of_pain.svg')));
  assert(fs.existsSync(path.join(root, 'apps/frontend/assets/ui/skill-icons/monster_skill_sting.svg')));
  assert(fs.existsSync(path.join(root, 'apps/frontend/assets/ui/aggression-badge.svg')));
  const ui = fs.readFileSync(path.join(root, 'apps/frontend/src/app/features/play/grind-info.html'), 'utf8');
  assert(ui.includes('Aggressive: this monster will try to interrupt your gathering or traveling'));
  assert(ui.includes('monster(b.monsterId)?.isAggressive === true'));
  const globalStyles = fs.readFileSync(path.join(root, 'apps/frontend/src/styles.css'), 'utf8');
  assert(globalStyles.includes('content:attr(aria-label)') && globalStyles.includes('.aggression-badge:focus::after'), 'aggression tooltip is visible on hover and keyboard focus');

  const sting = byId(skillsData.monsterSkills, 'monster_skill_sting');
  assert(sting);
  assert.equal(sting.name, 'Sting');
  assert.equal(sting.spCost, 30);
  assert.equal(sting.cooldownTicks, 15);
  assert.equal(sting.baseCastTicks, 2);
  assert.equal(sting.target, 'self');
  const tip = byId(statusesData.statusEffects, 'tip_of_pain');
  assert(tip);
  assert.equal(tip.nextBasicAttackAtkMultiplier, 2);
  assert.equal(tip.consumeOnNextBasicAttackAttempt, true);
  assert.equal(tip.applyDisarmOnHitTicks, 10);
}

function testStingSimulator() {
  const bee = monsterById('mon_mutantbee');
  const snapshot = {
    characterName: 'StingTest', level: 1, hp: 100000, maxHp: 100000, sp: 0, maxSp: 0,
    atk: 700, matk: 0, def: 0, mdefPercent: 0, accuracy: 200, evasion: 0,
    critChance: 0, agi: 0, dex: 0, luk: 0, attackSpeed: 800, castTimeReduction: 0,
    hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, combatStyle: 'melee',
    basicAttackDamageType: 'melee', basicAttackRange: 0, statusEffects: [],
    skills: {}, skillDefs: {}, masteryEquipment: [],
  };
  const result = BattleEngine.simulateBattle(snapshot, { ...bee, hp: 30000, atk: 100, accuracy: 100, evasion: 0, critChance: 0, atkSpeedTicks: 5 },
    { lines: [{ priority: 1, condition: { id: 'always' }, action: { id: 'attack' } }] },
    'bee-sting-test', { statusEffectDefs: statusDefs, monsterSkillDefs, itemDefinitions: {} });
  const events = result.log.events;
  const casts = events.filter(event => event.actor === 'monster' && event.action === 'use_skill' && event.skillId === 'monster_skill_sting');
  assert(casts.length >= 2, 'Sting is used more than once over a sufficiently long battle');
  assert(casts.every(event => event.target === 'monster' && event.damage === 0 && event.spSpent === 30), 'Sting is a 30-SP zero-damage self-buff');
  const tipEvents = events.filter(event => event.status === 'tip_of_pain' && event.action === 'status_applied');
  assert(tipEvents.length >= 2 && tipEvents.every(event => event.target === 'monster'), 'Tip of Pain is applied only to the monster');
  assert.equal(tipEvents[0].tick, casts[0].tick, 'Tip of Pain applies when the two-tick cast resolves');
  assert(!events.some(event => event.status === 'tip_of_pain' && event.target === 'character'), 'Sting never applies Tip of Pain to the player');

  const empoweredAttacks = events.filter(event => event.actor === 'monster' && event.action === 'attack' && event.empoweredBy === 'tip_of_pain');
  assert(empoweredAttacks.length >= 2);
  assert.equal(empoweredAttacks[0].hit, false, 'this deterministic seed makes the first empowered attempt miss');
  const firstConsumption = events.find(event => event.action === 'status_ended' && event.status === 'tip_of_pain');
  assert(firstConsumption && firstConsumption.tick === empoweredAttacks[0].tick, 'the buff is consumed on the first basic-attack attempt, even on a miss');
  assert(!events.some(event => event.action === 'status_applied' && event.status === 'disarm' && event.tick === empoweredAttacks[0].tick), 'a missed empowered attack applies no Disarm');
  const empoweredHit = empoweredAttacks.find(event => event.hit);
  assert(empoweredHit, 'a later empowered attack lands');
  const disarm = events.find(event => event.action === 'status_applied' && event.status === 'disarm' && event.sourceSkillId === 'monster_skill_sting');
  assert(disarm && disarm.tick === empoweredHit.tick && disarm.target === 'character' && disarm.durationTicks === 10, 'only a landed empowered attack Disarms for 10 ticks');
  const normalHits = events.filter(event => event.actor === 'monster' && event.action === 'attack' && event.hit && !event.empoweredBy).map(event => event.damage).filter(damage => damage > 0);
  assert(normalHits.length);
  assert(Math.abs(empoweredHit.damage - 2 * normalHits[0]) <= Math.max(10, normalHits[0] * 0.15), 'Tip of Pain doubles raw physical ATK before normal mitigation/variance');
  for (let index = 1; index < casts.length; index++) assert(casts[index].tick - casts[index - 1].tick >= 15, 'Sting respects its configured cooldown');
  assert(!events.some(event => event.action === 'status_applied' && event.status === 'tip_of_pain' && event.tick > tipEvents[0].tick && event.tick < empoweredAttacks[0].tick), 'the status-aware Gambit does not refresh Tip of Pain before attacking');
}

function testChatServices() {
  assert.equal(chatRetentionLimit(undefined), 20);
  assert.equal(chatRetentionLimit('20'), 20);
  assert.equal(chatRetentionLimit('4'), 4);
  for (const invalid of ['', '0', '-1', '0.5', 'abc', '99999999999999999999']) assert.throws(() => chatRetentionLimit(invalid), /CHAT_HISTORY_RETENTION_LIMIT/);

  const order = [];
  const redis = {
    set: async (...args) => { order.push(['set', ...args]); return 'OK'; },
    publish: async (...args) => { order.push(['publish', ...args]); return 1; },
  };
  const characterRepo = { findOne: async ({ where }) => ({ id: where.id, userId: 'user-a', name: 'ChatTester' }) };
  const globalHistory = {
    append: async (id, name, message) => {
      order.push(['append', id, name, message]);
      return { id: 'message-1', senderCharacterId: id, senderNameSnapshot: name, message, sentAt: new Date('2026-10-21T12:00:00Z') };
    },
    list: async limit => { order.push(['global-list', limit]); return []; },
  };
  const transientHistory = { listJournal: async id => { order.push(['journal-list', id]); return [{ id: 'private-1', channel: 'journal', message: 'private row', sentAt: '2026-10-21T12:00:01Z' }]; } };
  const service = new ChatService({ create: value => value, save: async value => value, find: async () => [] }, characterRepo, {}, globalHistory, transientHistory, redis);
  const returned = service.sendChatMessage('character-a', 'global', ' hello ').then(value => {
    assert.equal(value.message, 'hello');
    assert.equal(value.username, 'ChatTester');
    assert(order.some(entry => entry[0] === 'set' && entry[1] === 'chat:rate:user-a' && entry[2] === '1' && entry[3] === 'EX' && entry[4] === 5 && entry[5] === 'NX'), 'rate limit is atomic, 5 seconds, and account-scoped (not Character-scoped)');
    assert(order.findIndex(entry => entry[0] === 'append') < order.findIndex(entry => entry[0] === 'publish'), 'persist before live publication');
    return value;
  });
  return returned.then(async () => {
    await assert.rejects(service.sendChatMessage('character-a', 'town', 'nope'), error => error instanceof BadRequestException);
    await assert.rejects(service.sendChatMessage('character-a', 'global', '   '), error => error instanceof BadRequestException);
    await assert.rejects(service.sendChatMessage('character-a', 'global', 'x'.repeat(201)), error => error instanceof BadRequestException);
    const journal = await service.getChatHistory('journal', 20, 'character-a');
    assert.equal(journal[0].id, 'private-1');
    assert(order.some(entry => entry[0] === 'journal-list' && entry[1] === 'character-a'), 'Journal fetch is character-scoped');
    await assert.rejects(service.getChatHistory('journal', 20), error => error instanceof BadRequestException);

    // Exercise the actual Redis-only bounded list adapter and all six exact templates.
    const lists = new Map();
    const publications = [];
    const fakeRedis = {
      set: async (key) => { if (key.includes(':dedupe:')) return 'OK'; return 'OK'; },
      multi: () => {
        let listKey, serialized, trimStart, trimEnd;
        const multi = {
          lpush(key, row) { listKey = key; serialized = row; return multi; },
          ltrim(_key, start, end) { trimStart = start; trimEnd = end; return multi; },
          async exec() {
            const rows = lists.get(listKey) ?? [];
            rows.unshift(serialized);
            lists.set(listKey, rows.slice(trimStart, trimEnd + 1));
            return [];
          },
        };
        return multi;
      },
      publish: async (channel, row) => { publications.push({ channel, row: JSON.parse(row) }); },
      lrange: async (key, start, end) => (lists.get(key) ?? []).slice(start, end + 1),
    };
    const transient = new TransientChatHistoryService(fakeRedis);
    const journalService = new IdleJournalService(transient);
    await journalService.gathered('character-a', 2, 'Wheat', 'Green Grounds 0', 'gather-1');
    await journalService.passed('character-a', 'Giant Mantis', 'passed-1');
    await journalService.dodged('character-a', 'Mutant Bee', 'dodged-1');
    await journalService.fled('character-a', 'Mutant Bee', 'fled-1');
    await journalService.stolen('character-a', 'Pickpocket', 3, 'Wheat', 'stolen-1');
    await journalService.ate('character-a', 'Bread', 'ate-1');
    assert.deepEqual(publications.map(row => row.row.message), [
      'You have gathered 2x Wheat in Green Grounds 0',
      'You passed by a Giant Mantis and moved on.',
      'Mutant Bee found you, but you misled it!',
      'You managed to flee the battle against Mutant Bee',
      'Pickpocket has stolen 3x Wheat from you! Such a shame...',
      'You just ate Bread',
    ]);
    assert(publications.every(row => row.channel === 'gateway:chat:journal:character-a'));
    assert.equal(lists.get('chat:journal:character-a').length, 6, 'Journal is stored in the character-scoped Redis list, not in SQL');
    console.log('grind-monster-expansion-chat-journal: catalog, Sting simulator and chat/Journal unit assertions passed');
  });
}

async function run() {
  testCatalogue();
  testStingSimulator();
  await testChatServices();
}

run().catch(error => { console.error(error); process.exitCode = 1; });
