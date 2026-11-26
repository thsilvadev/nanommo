// GM commands: role check, parsing, the command registry, /start-event and the
// GM-scheduled Smashing Spree (countdown that fits, start, end), plus the
// deploy-safety contract of the users.role column.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../..');
const dist = '../dist/apps/api/src';
const { createFakeRedis } = require('./helpers/fake-redis');
const { manualSchedule } = require(`${dist}/modules/town-event/smashing-spree.logic`);
const { TownEventService } = require(`${dist}/modules/town-event/town-event.service`);
const { TownEventProcessor, SMASHING_SPREE_GM_PHASE } = require(`${dist}/modules/town-event/town-event.processor`);
const { SmashingSpreeGmEvent } = require(`${dist}/modules/town-event/smashing-spree.gm-event`);
const { GmService } = require(`${dist}/modules/gm/gm.service`);
const { GmAccessService } = require(`${dist}/modules/gm/gm-access.service`);
const { GmCommandError, tokenizeGmLine } = require(`${dist}/modules/gm/gm.types`);
const { StartEventCommand } = require(`${dist}/modules/gm/commands/start-event.command`);
const { GrantEquipCommand, GrantFoodsCommand, ResetDietCommand, UpgradeDietCommand } = require(`${dist}/modules/gm/commands/inventory-cheat.commands`);
const { ResetSkillTreeCommand } = require(`${dist}/modules/gm/commands/reset-skilltree.command`);

const cfg = require(path.join(root, 'town_events.json')).smashingSpree;
const towns = require(path.join(root, 'town_scenes.json')).towns;
const MIN = 60_000;
const announced = (phases) => phases.filter((p) => p.phase.kind === 'announce').map((p) => p.phase.minutes);

let clock = Date.parse('2026-11-26T19:10:00Z');
const realNow = Date.now;
Date.now = () => clock;
const silence = (svc) => { svc.logger = { log() {}, warn() {}, error() {} }; return svc; };

(async () => {
  // Countdown: only the configured announcements that fit in the lead time.
  {
    assert.deepEqual(cfg.announceMinutesBefore.slice().sort((a, b) => b - a), [30, 15, 5, 1], 'fixture: catalogue countdown');
    assert.deepEqual(announced(manualSchedule(clock, 20, cfg)), [15, 5, 1]);
    assert.deepEqual(announced(manualSchedule(clock, 3, cfg)), [1]);
    assert.deepEqual(announced(manualSchedule(clock, 0, cfg)), []);
    assert.deepEqual(announced(manualSchedule(clock, 45, cfg)), [30, 15, 5, 1]);
    const at15 = manualSchedule(clock, 15, cfg);
    assert.deepEqual(announced(at15), [15, 5, 1]);
    assert.equal(at15[0].runAt, clock, 'a lead equal to a countdown step announces it at once');
    const phases = manualSchedule(clock, 20, cfg);
    const start = phases.find((p) => p.phase.kind === 'start');
    const end = phases.find((p) => p.phase.kind === 'end');
    assert.equal(start.runAt, clock + 20 * MIN);
    assert.equal(start.phase.endsAt, start.runAt + cfg.durationSeconds * 1000);
    assert.equal(end.runAt, start.phase.endsAt);
    assert.equal(start.phase.eventKey, `ss-gm-${clock + 20 * MIN}`);
    assert.deepEqual(phases.filter((p) => p.phase.kind === 'announce').map((p) => p.runAt), [15, 5, 1].map((m) => start.runAt - m * MIN));
    for (const bad of [-1, 1.5, 24 * 60 + 1, NaN]) assert.throws(() => manualSchedule(clock, bad, cfg), RangeError);
  }

  // Parsing: spaces split, double quotes keep a name together.
  assert.deepEqual(tokenizeGmLine('grant-equip "Sir Lancelot" equip_a,equip_b 12'), ['grant-equip', 'Sir Lancelot', 'equip_a,equip_b', '12']);
  assert.deepEqual(tokenizeGmLine('  start-event   smashing-spree  20 '), ['start-event', 'smashing-spree', '20']);

  // GmService: only GMs, unknown commands look like any unknown slash command, errors carry the usage.
  {
    const runs = [];
    const echo = { name: 'echo', usage: '<text>', summary: 'Echoes', run: async (args, ctx) => { runs.push([args, ctx]); return args.join(' '); } };
    const broken = { name: 'broken', usage: '<x>', summary: 'Rejects', run: async () => { throw new GmCommandError('x is wrong'); } };
    const crash = { name: 'crash', usage: '', summary: 'Crashes', run: async () => { throw new Error('db down'); } };
    const gms = new Set(['user-gm']);
    const access = { isGm: async (userId) => gms.has(userId) };
    const characterRepo = { findOne: async ({ where }) => ({ id: where.id, name: where.id === 'char-gm' ? 'thiagosauro' : 'someone' }) };
    const gm = silence(new GmService([echo, broken, crash], access, characterRepo));

    assert.deepEqual(await gm.execute('user-player', 'char-p', '/echo hi'), { success: false, error: 'UNKNOWN_COMMAND' }, 'a player gets UNKNOWN_COMMAND');
    assert.equal(runs.length, 0);
    assert.deepEqual(await gm.execute('user-gm', 'char-gm', '/nope'), { success: false, error: 'UNKNOWN_COMMAND' });
    assert.deepEqual(await gm.execute('user-gm', 'char-gm', 'echo hi'), { success: false, error: 'UNKNOWN_COMMAND' }, 'needs the slash');
    assert.deepEqual(await gm.execute('user-gm', 'char-gm', 42), { success: false, error: 'UNKNOWN_COMMAND' });
    assert.deepEqual(await gm.execute('user-gm', 'char-gm', '/ECHO "a b" c'), { success: true, message: 'a b c' }, 'case-insensitive name, quoted args');
    assert.deepEqual(runs[0][1], { userId: 'user-gm', characterId: 'char-gm', characterName: 'thiagosauro' });
    const rejected = await gm.execute('user-gm', 'char-gm', '/broken 1');
    assert.equal(rejected.success, false);
    assert.match(rejected.error, /^\/broken: x is wrong\nUsage: \/broken <x>$/);
    assert.deepEqual(await gm.execute('user-gm', 'char-gm', '/crash'), { success: false, error: '/crash failed: db down' });
    const help = await gm.execute('user-gm', 'char-gm', '/gm-help');
    assert.equal(help.success, true);
    for (const name of ['/broken <x>', '/crash', '/echo <text>', '/gm-help']) assert.ok(help.message.includes(name), `help lists ${name}`);
    assert.throws(() => new GmService([echo, echo], access, characterRepo), /Duplicate GM command \/echo/);
  }

  // Cheats target the GM's own character unless a name is given.
  {
    const ctx = { userId: 'user-gm', characterId: 'char-gm', characterName: 'thiagosauro' };
    const calls = [];
    const inventory = {
      grantEquipmentCheat: async (ids, refine, name) => { calls.push(['equip', ids, refine, name]); return { name, granted: ids.map((itemId) => ({ itemId })) }; },
      grantAllFoodsCheat: async (qty, name) => { calls.push(['foods', qty, name]); return { foods: [] }; },
      resetDietCheat: async (name) => { calls.push(['reset', name]); return { diet: [] }; },
      upgradeDietCheat: async (name) => { calls.push(['upgrade', name]); return { diet: [] }; },
    };
    const items = new Set(['equip_a', 'equip_b']);
    const data = { getItemById: (id) => (items.has(id) ? { id } : null) };
    const equip = new GrantEquipCommand(inventory, data);
    await equip.run(['equip_a,equip_b', '12'], ctx);
    await equip.run(['equip_a'], ctx);
    await equip.run(['Ana', 'equip_a', '3'], ctx);
    await assert.rejects(equip.run([], ctx), (e) => e instanceof GmCommandError);
    const foods = new GrantFoodsCommand(inventory);
    await foods.run([], ctx);
    await foods.run(['5'], ctx);
    await foods.run(['Ana', '7'], ctx);
    await new ResetDietCommand(inventory).run([], ctx);
    await new UpgradeDietCommand(inventory).run(['Ana'], ctx);
    const resets = [];
    await new ResetSkillTreeCommand({ resetMasteryForCharacterName: async (n) => { resets.push(n); return { characterName: n, categoriesReset: 8 }; } }).run([], ctx);
    assert.deepEqual(calls, [
      ['equip', ['equip_a', 'equip_b'], 12, 'thiagosauro'],
      ['equip', ['equip_a'], 0, 'thiagosauro'],
      ['equip', ['equip_a'], 3, 'Ana'],
      ['foods', 10, 'thiagosauro'],
      ['foods', 5, 'thiagosauro'],
      ['foods', 7, 'Ana'],
      ['reset', 'thiagosauro'],
      ['upgrade', 'Ana'],
    ]);
    assert.deepEqual(resets, ['thiagosauro']);
  }

  // GmAccessService: the role comes from the database; a missing column (pre-migration) means no GM.
  {
    const ok = silence(new GmAccessService({ query: async (_sql, [id]) => (id === 'u1' ? [{ role: 'gm' }] : [{ role: 'player' }]) }));
    assert.equal(await ok.isGm('u1'), true);
    assert.equal(await ok.isGm('u2'), false);
    assert.equal(await ok.isGm(undefined), false);
    const premigration = silence(new GmAccessService({ query: async () => { throw new Error('column "role" does not exist'); } }));
    assert.equal(await premigration.isGm('u1'), false);
  }

  // /start-event: event code lookup, minutes validation, a readable answer.
  {
    const calls = [];
    const event = { code: 'smashing-spree', name: 'Smashing Spree', schedule: async (m) => { calls.push(m); return { startsAt: clock + m * MIN, endsAt: clock + m * MIN + 300_000, announcements: m >= 15 ? [15, 5, 1] : [1] }; } };
    const cmd = new StartEventCommand([event], { getSmashingSpreeConfig: () => cfg });
    const msg = await cmd.run(['smashing-spree', '20']);
    assert.deepEqual(calls, [20]);
    assert.match(msg, /starts in 20 min/);
    assert.match(msg, /countdown at 15 min, 5 min, 1 min/);
    await assert.rejects(cmd.run(['party', '5']), (e) => e instanceof GmCommandError && /Events: smashing-spree/.test(e.message));
    for (const bad of [undefined, '-1', '2.5', 'soon', '1441']) await assert.rejects(cmd.run(['smashing-spree', bad]), GmCommandError);
  }

  // The GM event end to end on the real TownEventService: queued phases, then run in order.
  {
    const redis = createFakeRedis(() => clock);
    const announces = [];
    const chat = { announceServerMessage: async (...args) => announces.push(args), announceEventFind: async () => {} };
    const data = { getSmashingSpreeConfig: () => cfg, getTownSceneMapIds: () => towns.map((t) => t.mapId), getTownScene: (id) => towns.find((t) => t.mapId === id) ?? null, getMaps: () => [{ id: 'map_town', name: 'Sierra Village' }] };
    const svc = new TownEventService(redis, data, { poseOf: async () => null }, chat, { grant: async () => 'bag' });
    const jobs = [];
    const queue = { add: async (name, payload, opts) => jobs.push({ name, payload, opts }) };
    const gmEvent = silence(new SmashingSpreeGmEvent(queue, data, svc));
    const result = await gmEvent.schedule(20);
    assert.deepEqual(result.announcements, [15, 5, 1]);
    assert.equal(result.startsAt, clock + 20 * MIN);
    assert.ok(jobs.every((j) => j.name === SMASHING_SPREE_GM_PHASE));
    assert.deepEqual(jobs.map((j) => j.opts.delay), [5, 15, 19, 20, 25].map((m) => m * MIN));
    assert.equal(new Set(jobs.map((j) => j.opts.jobId)).size, jobs.length, 'one job id per phase');

    const processor = new TownEventProcessor(svc, data);
    processor.logger = { error() {} };
    const run = async (job) => { clock = job.payload.runAt; await processor.handleGmPhase({ data: job.payload }); };
    for (const job of jobs.slice(0, 4)) await run(job);
    assert.deepEqual(announces.map((a) => a[2]), ['event.smashingSpree.soon', 'event.smashingSpree.soon', 'event.smashingSpree.soon', 'event.smashingSpree.started']);
    assert.deepEqual(announces.slice(0, 3).map((a) => a[3].minutes), [15, 5, 1]);
    const live = await svc.activeEvent('map_town');
    assert.equal(live.eventKey, `ss-gm-${result.startsAt}`);
    assert.equal(live.startsAt, result.startsAt);
    assert.equal(live.vases.length, cfg.vasesPerTown);
    await assert.rejects(gmEvent.schedule(0), (e) => e instanceof GmCommandError && /running right now/.test(e.message), 'no second start over a live event');
    await run(jobs[4]);
    assert.equal(await svc.activeEvent('map_town'), null, 'the end phase closes it');
  }

  // A GM phase processed late: a start after the event's end and a stale countdown are dropped.
  {
    const ran = [];
    const processor = new TownEventProcessor({ runPhase: async (p) => ran.push(p.kind) }, {});
    const startMs = clock;
    clock = startMs + cfg.durationSeconds * 1000 + 1;
    await processor.handleGmPhase({ data: { phase: { kind: 'start', eventKey: 'ss-gm-1', startMs, endsAt: startMs + cfg.durationSeconds * 1000 }, runAt: startMs } });
    clock = startMs + 61_000;
    await processor.handleGmPhase({ data: { phase: { kind: 'announce', eventKey: 'ss-gm-1', startMs, minutes: 1 }, runAt: startMs } });
    clock = startMs + 30_000;
    await processor.handleGmPhase({ data: { phase: { kind: 'start', eventKey: 'ss-gm-1', startMs, endsAt: startMs + cfg.durationSeconds * 1000 }, runAt: startMs } });
    assert.deepEqual(ran, ['start'], 'only the start still inside the event ran');
  }

  // users.role: forward-only migration seeding thiagosauro; the entity never reads or writes it through the ORM.
  {
    const migration = fs.readFileSync(path.join(__dirname, '../src/database/migrations/1800800000000-UserRole.ts'), 'utf8');
    assert.match(migration, /ADD COLUMN "role" varchar\(16\) NOT NULL DEFAULT 'player'/);
    assert.match(migration, /lower\(name\) = 'thiagosauro'/);
    assert.match(migration, /forward-only/);
    const entity = fs.readFileSync(path.join(__dirname, '../src/database/entities/user.entity.ts'), 'utf8');
    const column = /@Column\(\{([^}]*)\}\)[^\n]*\n\s*role\?/.exec(entity);
    assert.ok(column, 'role column on User');
    assert.match(column[1], /select: false/);
    assert.match(column[1], /insert: false/);
    assert.match(column[1], /update: false/);
    assert.doesNotMatch(column[1], /default/, 'an ORM default would put "role" in every INSERT ... RETURNING');
  }

  // The unauthenticated /inventory/__dev_7f3a91c2/* URLs are off: their cheats are GM commands now.
  {
    const inventoryModule = fs.readFileSync(path.join(__dirname, '../src/modules/inventory/inventory.module.ts'), 'utf8');
    const controllers = /controllers:\s*\[([^\]]*)\]/.exec(inventoryModule)[1].replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(controllers, /DevCheatController/);
    const { InventoryModule } = require(`${dist}/modules/inventory/inventory.module`);
    const registered = Reflect.getMetadata('controllers', InventoryModule).map((c) => c.name);
    assert.deepEqual(registered, ['InventoryController']);
  }

  Date.now = realNow;
  console.log('gm-commands: ok');
})().catch((error) => { Date.now = realNow; console.error(error); process.exitCode = 1; });
