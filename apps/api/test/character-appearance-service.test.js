const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
// DataService resolves the canonical catalogues relative to apps/api.
process.chdir(path.join(root, 'apps/api'));

const { BadRequestException, ConflictException, NotFoundException, Logger } = require('@nestjs/common');
Logger.overrideLogger(false);
const { CharacterService } = require('../dist/apps/api/src/modules/character/character.service.js');
const { DataService } = require('../dist/apps/api/src/modules/data/data.service.js');
const { defaultAppearance } = require('../../../packages/shared/dist');

const dataService = new DataService();
dataService.onModuleInit();

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * In-memory stand-in for the characters table. The conditional UPDATE is applied
 * atomically inside execute(), like a single SQL statement, while every read
 * yields to the event loop so concurrent callers interleave.
 */
function makeHarness(existing) {
  const rows = new Map();
  if (existing) rows.set(existing.id, { ...existing });
  const stats = { updates: [], mutations: 0, saved: { equipped: [], inventory: [], proficiencies: [], gambits: [] } };
  let sequence = 0;

  const characterRepo = {
    findOne: async ({ where } = {}) => {
      await tick();
      for (const row of rows.values()) {
        if ((where.id && row.id === where.id) || (where.userId && row.userId === where.userId) || (where.name && row.name === where.name)) return { ...row };
      }
      return null;
    },
    create: (entity) => ({ ...entity }),
    save: async (entity) => {
      await tick();
      if (!entity.id) entity.id = `character-${++sequence}`;
      rows.set(entity.id, { ...(rows.get(entity.id) ?? {}), ...entity });
      return entity;
    },
    createQueryBuilder: () => {
      const query = { set: null, wheres: [], params: {} };
      const builder = {
        update: () => builder,
        set: (values) => { query.set = values; return builder; },
        where: (sql, params) => { query.wheres.push(sql); Object.assign(query.params, params); return builder; },
        andWhere: (sql, params) => { query.wheres.push(sql); Object.assign(query.params, params ?? {}); return builder; },
        execute: async () => {
          await tick();
          stats.updates.push(query);
          const row = rows.get(query.params.id);
          const requiresNoAppearance = query.wheres.some((sql) => /"appearance" IS NULL/.test(sql));
          if (!row || (requiresNoAppearance && row.appearance != null)) return { affected: 0 };
          for (const [column, value] of Object.entries(query.set)) {
            if (typeof value === 'function') {
              const match = String(value()).match(new RegExp(`^"${column}" \\+ \\((-?\\d+)\\)$`));
              assert.ok(match, `raw SET for ${column} must be "${column}" + (n), got ${value()}`);
              row[column] = Number(row[column]) + Number(match[1]);
            } else {
              row[column] = value;
            }
          }
          return { affected: 1 };
        },
      };
      return builder;
    },
  };
  const listRepo = (bucket) => ({
    create: (entity) => ({ ...entity }),
    save: async (entity) => {
      for (const row of Array.isArray(entity) ? entity : [entity]) { row.id ??= `${bucket}-${stats.saved[bucket].length + 1}`; stats.saved[bucket].push(row); }
      return entity;
    },
    find: async ({ where } = {}) => stats.saved[bucket].filter((row) => !where?.characterId || row.characterId === where.characterId),
    findOne: async () => null,
  });
  const battleService = {
    runFutureCombatMutation: async (_characterId, mutation) => { stats.mutations += 1; return mutation(); },
  };
  const service = new CharacterService(
    characterRepo, listRepo('proficiencies'), listRepo('gambits'), listRepo('equipped'), listRepo('inventory'), dataService, battleService,
  );
  return { service, rows, stats, row: (id) => rows.get(id) };
}

function input(overrides = {}) {
  return { sex: 'male', heightCm: 170, appearance: defaultAppearance(), ...overrides };
}

function veteran(overrides = {}) {
  return {
    id: 'veteran-1', userId: 'user-veteran', name: 'Veteran', dominantHand: 'left',
    level: 14, xp: 1234, unspentAttributePoints: 3, str: 12, agi: 9, dex: 8, vit: 10, int: 5, luk: 9,
    gold: 4321, soulTokens: 700, hpCurrent: 150, spCurrent: 40, status: 'town', currentMapId: 'map_town',
    diet: [], dietLevels: {}, knownItemIds: [], discoveredMapIds: ['map_town'],
    sex: null, height: null, heightCm: null, appearance: null,
    lastSeenAt: new Date(), regenAnchorAt: new Date(), resourceRegenAt: new Date(), consumableCooldowns: {},
    createdAt: new Date(), updatedAt: new Date(), stateVersion: 7,
    ...overrides,
  };
}

const MALFORMED = [
  ['index as string', (i) => { i.appearance.hair = '2'; }],
  ['fractional index', (i) => { i.appearance.nose = 1.5; }],
  ['negative index', (i) => { i.appearance.mouth = -1; }],
  ['index outside the list for that sex', (i) => { i.appearance.hair = 99; }],
  ['unknown appearance key', (i) => { i.appearance.wings = 1; }],
  ['unsupported version', (i) => { i.appearance.v = 2; }],
  ['height below range', (i) => { i.heightCm = 144; }],
  ['height above range', (i) => { i.heightCm = 206; }],
  ['fractional height', (i) => { i.heightCm = 175.5; }],
  ['height as string', (i) => { i.heightCm = '170'; }],
  ['unknown sex', (i) => { i.sex = 'other'; }],
  ['missing appearance', (i) => { delete i.appearance; }],
];

(async () => {
  // --- Creating a new character ----------------------------------------------
  {
    const h = makeHarness();
    const dto = await h.service.createCharacter('user-1', 'Tallone', 'left', input({ heightCm: 205, sex: 'female' }));
    assert.equal(dto.str, 7, 'height band 4 gives STR +2');
    assert.equal(dto.luk, 3, 'height band 4 gives LUK -2');
    assert.equal(dto.height, 4);
    assert.equal(dto.heightCm, 205);
    assert.equal(dto.sex, 'female');
    assert.deepEqual(dto.appearance, defaultAppearance());
    assert.equal(dto.dominantHand, 'left');
    const stored = h.row(dto.id);
    assert.equal(stored.str, 7);
    assert.equal(stored.luk, 3);
    assert.deepEqual([stored.agi, stored.dex, stored.vit, stored.int], [5, 5, 5, 5], 'other attributes are untouched');
    assert.ok(h.stats.saved.equipped.some((row) => row.itemId === 'equip_knife' && row.slot === 'mainHand'), 'starter knife is still equipped');
  }
  {
    const h = makeHarness();
    const dto = await h.service.createCharacter('user-1', 'Shortone', 'right', input({ heightCm: 145 }));
    assert.deepEqual([dto.str, dto.luk, dto.height], [3, 7, 1], 'height band 1 gives STR -2 / LUK +2');
  }
  {
    const h = makeHarness();
    const dto = await h.service.createCharacter('user-1', 'Midone', 'right', input({ heightCm: 175 }));
    assert.deepEqual([dto.str, dto.luk, dto.height], [4, 6, 2]);
    const dto2 = await makeHarness().service.createCharacter('user-1', 'Midtwo', 'right', input({ heightCm: 176 }));
    assert.deepEqual([dto2.str, dto2.luk, dto2.height], [6, 4, 3]);
  }
  {
    // The band is derived by the server; a client-sent band is not accepted.
    const h = makeHarness();
    await assert.rejects(h.service.createCharacter('user-1', 'Cheater', 'right', { ...input({ heightCm: 150 }), height: 4 }), BadRequestException);
    assert.equal(h.rows.size, 0);
  }
  for (const [label, mutate] of MALFORMED) {
    const h = makeHarness();
    const bad = input();
    mutate(bad);
    await assert.rejects(h.service.createCharacter('user-1', 'Badone', 'right', bad), BadRequestException, `create must reject: ${label}`);
    assert.equal(h.rows.size, 0, `nothing is saved for: ${label}`);
    assert.equal(h.stats.saved.equipped.length, 0);
  }
  for (const missing of [undefined, null, 'x', []]) {
    const h = makeHarness();
    await assert.rejects(h.service.createCharacter('user-1', 'Noinput', 'right', missing), BadRequestException);
    assert.equal(h.rows.size, 0);
  }

  // --- One-time appearance for an existing character -------------------------
  {
    const h = makeHarness(veteran());
    const dto = await h.service.setAppearance('user-veteran', input({ heightCm: 176, sex: 'female' }));
    assert.deepEqual([dto.str, dto.luk, dto.height, dto.heightCm, dto.sex], [13, 8, 3, 176, 'female']);
    assert.deepEqual(dto.appearance, defaultAppearance());
    const stored = h.row('veteran-1');
    for (const [field, value] of Object.entries({ name: 'Veteran', dominantHand: 'left', level: 14, xp: 1234, gold: 4321, soulTokens: 700, unspentAttributePoints: 3, agi: 9, dex: 8, vit: 10, int: 5, status: 'town', currentMapId: 'map_town' })) {
      assert.equal(stored[field], value, `${field} is preserved`);
    }
    assert.equal(h.stats.mutations, 1, 'the attribute change goes through runFutureCombatMutation');
    assert.equal(h.stats.updates.length, 1);
    assert.deepEqual(Object.keys(h.stats.updates[0].set).sort(), ['appearance', 'height', 'heightCm', 'luk', 'sex', 'str'], 'only appearance columns and STR/LUK are written');

    // Second save is refused and changes nothing.
    await assert.rejects(h.service.setAppearance('user-veteran', input({ heightCm: 205 })), ConflictException);
    assert.deepEqual([stored.str, stored.luk, stored.height, stored.heightCm, stored.sex], [13, 8, 3, 176, 'female']);
  }
  {
    // Two simultaneous saves: exactly one wins and the adjustment is applied once.
    const h = makeHarness(veteran());
    const results = await Promise.allSettled([
      h.service.setAppearance('user-veteran', input({ heightCm: 205 })),
      h.service.setAppearance('user-veteran', input({ heightCm: 205 })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one concurrent save succeeds');
    const rejected = results.find((r) => r.status === 'rejected');
    assert.ok(rejected.reason instanceof ConflictException, 'the loser gets a 409');
    assert.deepEqual([h.row('veteran-1').str, h.row('veteran-1').luk], [14, 7], 'STR/LUK adjusted exactly once');
  }
  {
    // Mixed concurrent heights must not blend: the stored band matches the stored adjustment.
    const h = makeHarness(veteran());
    await Promise.allSettled([
      h.service.setAppearance('user-veteran', input({ heightCm: 145 })),
      h.service.setAppearance('user-veteran', input({ heightCm: 205 })),
    ]);
    const stored = h.row('veteran-1');
    assert.ok((stored.height === 1 && stored.str === 10 && stored.luk === 11) || (stored.height === 4 && stored.str === 14 && stored.luk === 7), 'winner state is internally consistent');
  }
  for (const [label, mutate] of MALFORMED) {
    const h = makeHarness(veteran());
    const bad = input();
    mutate(bad);
    await assert.rejects(h.service.setAppearance('user-veteran', bad), BadRequestException, `setAppearance must reject: ${label}`);
    assert.equal(h.stats.updates.length, 0, `no write for: ${label}`);
    assert.equal(h.stats.mutations, 0);
    assert.equal(h.row('veteran-1').appearance, null);
  }
  {
    const h = makeHarness(veteran());
    await assert.rejects(h.service.setAppearance('user-nobody', input()), NotFoundException);
  }
  {
    // A request cannot smuggle a rename or a hand change through the appearance payload.
    const h = makeHarness(veteran());
    await assert.rejects(h.service.setAppearance('user-veteran', { ...input(), name: 'Renamed', dominantHand: 'right' }), BadRequestException);
    assert.equal(h.row('veteran-1').name, 'Veteran');
  }

  // --- The statement that reaches PostgreSQL ---------------------------------
  {
    const { DataSource } = require('typeorm');
    const { Character } = require('../dist/apps/api/src/database/entities/character.entity');
    const entities = require('../dist/apps/api/src/database/entities');
    const ds = new DataSource({ type: 'postgres', entities: Object.values(entities).filter((e) => typeof e === 'function') });
    await ds.buildMetadatas();
    const h = makeHarness(veteran());
    h.service.characterRepository.createQueryBuilder = () => {
      // update() returns a dedicated UpdateQueryBuilder, so capture the statement there
      // instead of sending it to a database this test does not have.
      const qb = ds.getRepository(Character).createQueryBuilder();
      const update = qb.update.bind(qb);
      qb.update = (...args) => {
        const updateBuilder = update(...args);
        updateBuilder.execute = async () => { h.sql = updateBuilder.getQueryAndParameters(); return { affected: 1 }; };
        return updateBuilder;
      };
      return qb;
    };
    await h.service.setAppearance('user-veteran', input({ heightCm: 145 }));
    const [sql, params] = h.sql;
    assert.match(sql, /^UPDATE "characters" SET /);
    assert.match(sql, /"str" = "str" \+ \(-2\)/);
    assert.match(sql, /"luk" = "luk" \+ \(2\)/);
    assert.match(sql, /"stateVersion" = "stateVersion" \+ 1/, 'the optimistic version is bumped so clients accept the new snapshot');
    assert.match(sql, /WHERE "id" = \$\d+ AND "appearance" IS NULL$/);
    assert.ok(params.includes('veteran-1') && params.includes('male') && params.includes(145) && params.includes(1));
  }

  // --- Controller wiring ------------------------------------------------------
  const controller = fs.readFileSync(path.join(root, 'apps/api/src/modules/character/character.controller.ts'), 'utf8');
  assert.match(controller, /@Post\('appearance'\)\s+@UseGuards\(AuthGuard\('jwt'\)\)/);
  assert.match(controller, /setAppearance\(\(req\.user as any\)\.userId/);
  assert.match(controller, /createCharacter\(userId, dto\.name, dto\.dominantHand, \{ sex: dto\.sex, heightCm: dto\.heightCm, appearance: dto\.appearance \}\)/);

  console.log('character-appearance-service: creation with appearance, one-time save, concurrency, malformed payloads and SQL contract passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
