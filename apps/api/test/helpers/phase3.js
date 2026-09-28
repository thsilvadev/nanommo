/**
 * Phase 3 shared verification harness — `grind-loop-phase3-edge-cases`.
 *
 * Bootstrap duplicated from `apps/api/test-s63.js` (design.md D2: duplicated,
 * not refactored out, so a known-good script is never touched). Everything the
 * six Phase 3 scripts need lives here:
 *
 *   request / sleep / waitFor      — HTTP + polling
 *   pg Client                      — direct DB seeding and inspection (design.md D3)
 *   ioredis + bull Queue           — BullMQ job introspection and job injection
 *   createCharacter                — register → emailVerified → gambit page → map
 *   preflight                      — fail fast when the stack is not up
 *   assert / summarize             — `[PASS]`/`[FAIL]` tally with SPEC-clause names (D8)
 *   setCharacterProgression, setKillCounter, clearQueue, insertQueueEntry,
 *   rewriteEndAtToPast             — seeded preconditions, each annotated with the
 *                                    SPEC clause it approximates
 *
 * Standing constraints (tasks.md):
 *   - No production code changes, no new npm dependencies.
 *   - The backend base URL comes from PHASE3_API_URL, defaulting to the
 *     docker-compose host mapping http://localhost:3010 — never the hardcoded
 *     3000 that test-s63.js uses.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const Redis = require('ioredis');
const { Client } = require('pg');
const Bull = require('bull');

/** docker-compose maps the backend container's 3000 to the host's 3010. */
const BASE_URL = process.env.PHASE3_API_URL || 'http://localhost:3010';

/** Repo root — used for the source scan and for `docker compose` invocations. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const PG_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'nanommo',
  password: process.env.PGPASSWORD || 'nanommo_dev_password',
  database: process.env.PGDATABASE || 'nanommo',
};

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};

/** The BullMQ queue name registered by `BattleModule` (battle.module.ts:28). */
const QUEUE_NAME = 'battle-queue';

const MAP_ID = 'map_green_grounds';

// ---------------------------------------------------------------------------
//  HTTP
// ---------------------------------------------------------------------------

/**
 * The API is globally throttled: `ThrottlerModule.forRoot` in app.module.ts:28
 * defaults to `THROTTLE_TTL=60000` ms / `THROTTLE_LIMIT=5` requests, and the
 * guard is registered as an `APP_GUARD`, so it applies to every route and is
 * keyed by caller IP — one budget for the whole test process.
 *
 * Left alone this makes a suite that makes 30 HTTP calls fail with 429s partway
 * through. So requests are paced to stay inside the window, and a 429 is still
 * retried as a safety net. Set `PHASE3_API_MIN_INTERVAL_MS=0` to pace nothing,
 * which is only safe against a stack started with a raised THROTTLE_LIMIT.
 */
const API_MIN_INTERVAL_MS = Number(process.env.PHASE3_API_MIN_INTERVAL_MS ?? 13_000);
const MAX_429_RETRIES = 6;

let lastRequestAt = 0;
let throttleNoticePrinted = false;

function announceThrottle() {
  if (throttleNoticePrinted) return;
  throttleNoticePrinted = true;
  console.log(
    `[NOTE] API throttling is active (THROTTLE_LIMIT=5 / THROTTLE_TTL=60000, ` +
      `app.module.ts:28). Pacing HTTP calls to one every ${API_MIN_INTERVAL_MS}ms. ` +
      `Set PHASE3_API_MIN_INTERVAL_MS=0 to disable pacing.`,
  );
}

async function paceRequest() {
  if (API_MIN_INTERVAL_MS <= 0) return;
  announceThrottle();
  const waitMs = lastRequestAt + API_MIN_INTERVAL_MS - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
}

/**
 * `fetch` wrapper. Returns `{ status, data, raw }` and never throws on a
 * non-2xx, so an assertion can inspect the failure body. A 429 is transparently
 * retried after the throttler window rather than surfacing as a test failure.
 */
async function request(method, reqPath, body = null, token = null) {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    await paceRequest();

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE_URL}${reqPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (res.status !== 429 || attempt === MAX_429_RETRIES) {
      return { status: res.status, data, raw: text };
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000 + 500
      : 61_000;
    console.log(
      `[NOTE] 429 from ${method} ${reqPath} — the throttler budget is spent; ` +
        `waiting ${Math.round(waitMs / 1000)}s and retrying (attempt ${attempt + 1}/${MAX_429_RETRIES})`,
    );
    await sleep(waitMs);
  }

  throw new Error('unreachable: request() exhausted its 429 retries');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `predicate` until it returns truthy. On timeout it throws a message
 * naming what never became true, so a red run is self-diagnosing (design.md
 * Risks: prefer polling on observable state over a fixed `sleep()`).
 */
async function waitFor(name, predicate, timeoutMs = 30_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(
    `waitFor timed out after ${timeoutMs}ms waiting for: ${name}` +
      (last === undefined ? '' : ` (last observed: ${JSON.stringify(last)})`),
  );
}

/**
 * Fail fast with a clear message when the API is unreachable (design.md Risks:
 * "Scripts fail fast with a clear message if the health endpoint is
 * unreachable, rather than hanging on a fetch timeout").
 *
 * Any HTTP status counts as live — 401 on /maps is the expected answer for an
 * unauthenticated probe and proves routing is up.
 */
async function preflight() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${BASE_URL}/maps`, { signal: controller.signal });
    return { reachable: true, status: res.status };
  } catch (error) {
    throw new Error(
      `Cannot reach the backend at ${BASE_URL} (${error.message}).\n` +
        `Start the stack first:\n` +
        `  docker compose up --build -d\n` +
        `  # or point PHASE3_API_URL at a running backend (default http://localhost:3010)`,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
//  Postgres
// ---------------------------------------------------------------------------

/** Lazily-created shared `pg` client, connected on first use. */
let pgClient = null;
async function pg() {
  if (!pgClient) {
    pgClient = new Client(PG_CONFIG);
    await pgClient.connect();
  }
  return pgClient;
}

async function sql(text, params = []) {
  const client = await pg();
  return client.query(text, params);
}

async function closePg() {
  if (pgClient) {
    await pgClient.end();
    pgClient = null;
  }
}

// ---------------------------------------------------------------------------
//  Redis / BullMQ
// ---------------------------------------------------------------------------

let redisClient = null;
function redis() {
  if (!redisClient) {
    redisClient = new Redis(REDIS_CONFIG);
  }
  return redisClient;
}

/**
 * A `bull` Queue bound to the same Redis the API uses. Lets a script inject a
 * `resolve-battle` job, which is otherwise unreachable: there is no
 * `POST /battles/:id/resolve` route (design.md D4).
 */
let bullQueue = null;
function queue() {
  if (!bullQueue) {
    bullQueue = new Bull(QUEUE_NAME, { redis: REDIS_CONFIG });
  }
  return bullQueue;
}

/**
 * Bull v3 stores a job as ONE flat `bull:<queue>:<jobId>` hash. There are no
 * `:id:`/`:data:` suffixes — `test-s63.js` looks for those and therefore always
 * observes zero jobs, which is why its "orphaned jobs: 0" output was never
 * evidence of anything.
 *
 * Those keys include the ones bull v3 RETAINS AFTER COMPLETION (it does not set
 * `removeOnComplete`, so a finished job keeps its hash with `finishedOn` and
 * `returnvalue` set). So raw key presence is the wrong question for "is there
 * outstanding work"; membership of the state lists is the right one.
 */
const QUEUE_STATE_LISTS = ['wait', 'active', 'delayed', 'paused'];
const QUEUE_META_KEYS = new Set([
  'id', 'wait', 'active', 'delayed', 'completed', 'failed', 'paused',
  'stalled-check', 'waiting-children', 'prioritized',
]);

/** Every `bull:battle-queue:<jobId>` key present, completed ones included. */
async function allBullJobKeys() {
  const r = redis();
  const prefix = `bull:${QUEUE_NAME}:`;
  const ids = [];
  for (const key of await r.keys(`${prefix}*`)) {
    const suffix = key.slice(prefix.length);
    if (!suffix || QUEUE_META_KEYS.has(suffix) || suffix.startsWith('repeat:')) continue;
    ids.push(suffix);
  }
  return ids;
}

/**
 * Job ids that represent OUTSTANDING work — members of the queue's wait /
 * active / delayed / paused lists. This is what "no orphaned job" and "every
 * entry has a job" have to mean; counting completed jobs would make both
 * meaningless.
 */
async function bullJobIds() {
  const r = redis();
  const prefix = `bull:${QUEUE_NAME}:`;
  const ids = new Set();
  for (const state of QUEUE_STATE_LISTS) {
    for (const member of await r.zrange(`${prefix}${state}`, 0, -1)) {
      ids.add(member);
    }
  }
  return [...ids];
}

/** Job ids in a specific BullMQ state, for diagnosing which stage a job is in. */
async function bullJobStates() {
  const r = redis();
  const prefix = `bull:${QUEUE_NAME}:`;
  const out = {};
  for (const state of [...QUEUE_STATE_LISTS, 'completed', 'failed']) {
    out[state] = await r.zrange(`${prefix}${state}`, 0, -1);
  }
  return out;
}

async function removeBullJob(jobId) {
  try {
    const job = await queue().getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state === 'active') return false;
    await job.remove();
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove every job key in the queue, ignoring the ones BullMQ refuses to drop.
 * Uses the raw key list rather than the pending list, so retained COMPLETED job
 * hashes are cleared too and a run starts from a genuinely clean queue.
 */
async function clearBullJobs() {
  const ids = await allBullJobKeys();
  let removed = 0;
  for (const id of ids) {
    if (await removeBullJob(id)) removed += 1;
  }
  return { seen: ids.length, removed };
}

/**
 * Enqueue a `resolve-battle` job for `battleId` with no delay.
 *
 * The queue is authoritative only at fire time — `resolveBattle()`'s contract
 * is "claimed after endAt", not "claimed exactly at endAt" (design.md Risks),
 * so injecting a job for a battle whose endAt is already past is legitimate.
 *
 * `jobId` defaults to `battleId` (what `queueBattles()` uses). A distinct
 * `jobId` lets a second job for the same battle be added alongside the first,
 * which is how the idempotency race is staged (D4).
 */
async function enqueueResolveJob(battleId, { jobId, delay = 0, attempts = 3 } = {}) {
  const id = jobId ?? battleId;
  await removeBullJob(id);
  return queue().add(
    'resolve-battle',
    { battleId },
    { jobId: id, delay: Math.max(0, delay), attempts, backoff: { type: 'exponential', delay: 2000 } },
  );
}

async function closeQueueAndRedis() {
  if (bullQueue) {
    await bullQueue.close().catch(() => undefined);
    bullQueue = null;
  }
  if (redisClient) {
    await redisClient.quit().catch(() => undefined);
    redisClient = null;
  }
  await closePg();
}

// ---------------------------------------------------------------------------
//  docker compose
// ---------------------------------------------------------------------------

/**
 * Run a `docker compose` subcommand from the repo root. Used only by the
 * restart-gated scenarios (crash recovery, restart race).
 */
function dockerCompose(args, { quiet = true } = {}) {
  try {
    return execFileSync('docker', ['compose', ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
  } catch (error) {
    throw new Error(
      `docker compose ${args.join(' ')} failed: ${error.stderr || error.message}`,
    );
  }
}

/** `docker compose logs backend`, used to observe the resolver's own log lines. */
function backendLogs(sinceSeconds = 900) {
  return dockerCompose(['logs', '--since', `${sinceSeconds}s`, '--no-color', 'backend']);
}

async function waitForBackendUp(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/maps`);
      if (res.status > 0) return true;
    } catch {
      /* not listening yet */
    }
    await sleep(1_000);
  }
  throw new Error(`Backend did not come back up on ${BASE_URL} within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
//  Assertions (design.md D8)
// ---------------------------------------------------------------------------

const tally = { pass: 0, fail: 0, failures: [] };

/**
 * Print `[PASS]`/`[FAIL] <name> — <detail>`, count the failure, and return the
 * condition so it can be used inline. Never throws: a script keeps running so
 * one run reports every broken guarantee, not just the first.
 */
function assert(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (ok) {
    tally.pass += 1;
    console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    tally.fail += 1;
    tally.failures.push({ name, detail });
    console.log(`[FAIL] ${name} — ${detail || 'condition was false'}`);
  }
  return ok;
}

/** Assert equality and report both values, so the diff is in the output. */
function assertEqual(name, actual, expected, extra = '') {
  return assert(
    name,
    Object.is(actual, expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${extra ? ` (${extra})` : ''}`,
  );
}

/** Print a per-area tally and exit non-zero if anything failed. */
function summarize(suiteName) {
  const total = tally.pass + tally.fail;
  console.log('');
  console.log(`=== ${suiteName}: ${tally.pass}/${total} assertions passed ===`);
  if (tally.fail > 0) {
    console.log('Failed assertions:');
    for (const f of tally.failures) {
      console.log(`  - ${f.name}: ${f.detail}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

/** A non-fatal note — used for divergences and non-overlap warnings. */
function note(message) {
  console.log(`[NOTE] ${message}`);
}

/** A divergence from design.md's "Known divergences", recorded not fixed. */
function divergence(divergenceNumber, message) {
  console.log(`[DIVERGENCE #${divergenceNumber}] ${message}`);
}

// ---------------------------------------------------------------------------
//  Bootstrap
// ---------------------------------------------------------------------------

/**
 * Register a timestamp-unique user, bypass email verification, ensure an active
 * `always -> attack` gambit page, and return the tokens/ids every scenario needs.
 *
 * A gambit page is required, not cosmetic: with no active page the character
 * has no legal action on any gauge, so every battle hits the engine's
 * MAX_TICKS stalemate valve and is recorded as a `loss` (STATUS.md Issue #2).
 */
async function createCharacter({ gambit = true, enterMap = false, mapId = MAP_ID, level } = {}) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-13);
  const username = `p3${stamp}`;

  const reg = await request('POST', '/auth/register', {
    email: `p3_${stamp}@test.com`,
    username,
    password: 'Test123!@#',
    cpf: `${stamp}${Math.floor(Math.random() * 90 + 10)}`,
  });
  if (reg.status !== 201) {
    throw new Error(`register failed: ${reg.status} ${reg.raw}`);
  }
  const token = reg.data.accessToken;
  const userId = reg.data.user?.id ?? reg.data.userId ?? null;

  // STATUS.md §7 "Email verification bypass": there is no public verify route
  // in this environment, so the flag is set directly. The column is camelCase
  // (`emailVerified`), not the snake_case the task prose guessed.
  if (userId) {
    await sql('UPDATE users SET "emailVerified" = true WHERE id = $1', [userId]);
  } else {
    await sql('UPDATE users SET "emailVerified" = true WHERE username = $1', [username]);
  }

  // Registration auto-creates the character (auth.service.ts:97). The response
  // is a single object, not an array (character.controller.ts:30).
  const charRes = await request('GET', '/characters', null, token);
  if (!charRes.data || !charRes.data.id) {
    throw new Error(`GET /characters returned no character: ${charRes.status} ${charRes.raw}`);
  }
  const charId = charRes.data.id;

  let gambitPageId = null;
  if (gambit) {
    const page = await request(
      'POST',
      '/gambits',
      {
        slotIndex: 0,
        title: 'Phase3 always-attack',
        lines: [
          {
            priority: 1,
            conditions: [{ id: 'always' }],
            combinator: null,
            action: { id: 'attack' },
          },
        ],
      },
      token,
    );
    if (page.status !== 201 && page.status !== 200) {
      throw new Error(`gambit page creation failed: ${page.status} ${page.raw}`);
    }
    gambitPageId = page.data.id;

    const activate = await request('PUT', `/gambits/${gambitPageId}/activate`, {}, token);
    if (activate.status !== 200) {
      throw new Error(`gambit activation failed: ${activate.status} ${activate.raw}`);
    }
  }

  if (level !== undefined) {
    // Some maps are level-gated at enter time, so a scenario that needs one has
    // to be at that level before the map entry, not after. Design.md D3.
    await setCharacterProgression(charId, { level });
  }

  if (enterMap) {
    const entered = await request('POST', `/maps/${mapId}/enter`, {}, token);
    if (entered.status !== 201 && entered.status !== 200) {
      throw new Error(`map enter failed: ${entered.status} ${entered.raw}`);
    }
  }

  return { token, charId, username, gambitPageId, mapId };
}

// ---------------------------------------------------------------------------
//  Seeded preconditions (design.md D3)
//  Each approximates a SPEC clause; the clause is named in the comment.
// ---------------------------------------------------------------------------

/**
 * SPEC §4.2 / §6.3: set `characters.level` / `xp` directly so the next resolve
 * lands on a chosen threshold. `xp` is XP *toward the next level* (the model
 * §4.2 defines and the level-up loop at battle.service.ts:438-445 uses).
 */
async function setCharacterProgression(charId, { level, xp, unspentAttributePoints, hpCurrent, spCurrent }) {
  const sets = [];
  const params = [charId];
  const push = (col, value) => {
    params.push(value);
    sets.push(`"${col}" = $${params.length}`);
  };

  if (level !== undefined) push('level', level);
  if (xp !== undefined) push('xp', xp);
  if (unspentAttributePoints !== undefined) push('unspentAttributePoints', unspentAttributePoints);
  if (hpCurrent !== undefined) push('hpCurrent', hpCurrent);
  if (spCurrent !== undefined) push('spCurrent', spCurrent);

  if (sets.length === 0) throw new Error('setCharacterProgression: nothing to set');
  const res = await sql(`UPDATE characters SET ${sets.join(', ')} WHERE id = $1`, params);
  return res.rowCount;
}

/** Read a character row straight from Postgres (the DTO omits maxHp/maxSp). */
async function getCharacterRow(charId) {
  const { rows } = await sql('SELECT * FROM characters WHERE id = $1', [charId]);
  return rows[0] ?? null;
}

/**
 * SPEC §11.2: pin the encounter stream.
 *
 * `mapKillCount` is the index `nextMonsterId()` reads (`rngForIndex(encounterSeed,
 * mapKillCount)`), so setting it to N deterministically makes battle N's monster
 * predictable. `epoch` is part of the encounter seed, so it is pinned to 0 to
 * keep the scan in the helper reproducible.
 *
 * SPEC §11.2 epoch rollover: a high `mapKillCount` would trip the 10,000
 * rollover inside `incrementKillCounter()`, so this stays well under it.
 */
async function setKillCounter(charId, mapId, { mapKillCount, epoch, perMonsterKillCount } = {}) {
  const { rowCount } = await sql(
    `UPDATE map_kill_counters
        SET "mapKillCount" = COALESCE($2, "mapKillCount"),
            "epoch"        = COALESCE($3, "epoch"),
            "perMonsterKillCount" = COALESCE($4::jsonb, "perMonsterKillCount")
      WHERE "characterId" = $1 AND "mapId" = $5`,
    [
      charId,
      mapKillCount ?? null,
      epoch ?? null,
      perMonsterKillCount === undefined ? null : JSON.stringify(perMonsterKillCount),
      mapId,
    ],
  );
  if (rowCount === 0) {
    // `getOrCreateKillCounter()` only runs during queue build, so the row may
    // not exist yet on a first-ever entry.
    await sql(
      `INSERT INTO map_kill_counters ("characterId", "mapId", "epoch", "mapKillCount", "perMonsterKillCount")
       VALUES ($1, $2, COALESCE($3, 0), COALESCE($4, 0), COALESCE($5::jsonb, '{}'::jsonb))`,
      [
        charId,
        mapId,
        epoch ?? null,
        mapKillCount ?? null,
        perMonsterKillCount === undefined ? null : JSON.stringify(perMonsterKillCount),
      ],
    );
  }
  return getKillCounterRow(charId, mapId);
}

async function getKillCounterRow(charId, mapId) {
  const { rows } = await sql(
    'SELECT * FROM map_kill_counters WHERE "characterId" = $1 AND "mapId" = $2',
    [charId, mapId],
  );
  return rows[0] ?? null;
}

/** Delete every queue row for a character (design.md D3 — fresh chain). */
async function clearQueue(charId) {
  const { rowCount } = await sql('DELETE FROM battle_queue_entries WHERE "characterId" = $1', [
    charId,
  ]);
  return rowCount;
}

/**
 * Insert a hand-built `BattleQueueEntry`.
 *
 * SPEC §7.4.2: the outcome, log, rewards and hpAfter are decided at queue-build
 * time, so a row written directly is indistinguishable from a simulated one as
 * far as `resolveBattle()` is concerned. SPEC §7.5: `battle_queue_entries` rows
 * — not BullMQ job state — are the source of truth.
 */
async function insertQueueEntry(charId, overrides = {}) {
  const {
    sequenceIndex = 0,
    mapId = MAP_ID,
    monsterId = 'mon_slime',
    startAt = new Date(),
    endAt = new Date(),
    outcome = 'win',
    log = { header: {}, events: [] },
    xpGain = 0,
    goldGain = 0,
    drops = [],
    itemsConsumed = [],
    hpAfter = 1,
    spAfter = 0,
    resolved = false,
    seedUsed = `seeded:${charId}:${sequenceIndex}`,
  } = overrides;

  const { rows } = await sql(
    `INSERT INTO battle_queue_entries
       ("characterId","sequenceIndex","mapId","monsterId","startAt","endAt","outcome",
        "log","xpGain","goldGain","drops","itemsConsumed","hpAfter","spAfter","resolved","seedUsed")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16)
     RETURNING id`,
    [
      charId,
      sequenceIndex,
      mapId,
      monsterId,
      startAt,
      endAt,
      outcome,
      JSON.stringify(log),
      xpGain,
      goldGain,
      JSON.stringify(drops),
      JSON.stringify(itemsConsumed),
      hpAfter,
      spAfter,
      resolved,
      seedUsed,
    ],
  );
  return rows[0].id;
}

/**
 * SPEC §7.4.1 / design.md Risks: move a row's `endAt` into the past.
 *
 * The resolver's contract is "fired after endAt", not "fired exactly at
 * endAt", so this is the legitimate way to shorten a 15–60s in-game battle for a
 * test. BullMQ's delayed job is NOT moved by this — pair it with
 * `enqueueResolveJob()` (delay 0) to actually fire the resolve.
 */
async function rewriteEndAtToPast(entryId, { secondsAgo = 5, startAtSecondsAgo } = {}) {
  const { rows } = await sql(
    `UPDATE battle_queue_entries
        SET "endAt" = now() - ($2 || ' seconds')::interval,
            "startAt" = CASE WHEN $3::text IS NULL THEN "startAt"
                              ELSE now() - ($3 || ' seconds')::interval END
      WHERE id = $1
      RETURNING id, "startAt", "endAt"`,
    [entryId, String(secondsAgo), startAtSecondsAgo === undefined ? null : String(startAtSecondsAgo)],
  );
  return rows[0] ?? null;
}

/**
 * Delete a character's queue AND wait for the BullMQ queue to actually drain.
 *
 * `clearQueue()` alone is not enough, and the gap is silent. A delayed
 * `resolve-battle` job for an already-deleted row is a no-op on the row, but a
 * job that is `active` when `clearBullJobs()` runs cannot be removed (BullMQ
 * refuses), so it fires a moment later and writes `hpCurrent = battle.hpAfter`
 * onto the character — undoing any progression seeded in between. This was
 * observed as a level-up scenario whose seeded `hpCurrent` of 80 was 192 by the
 * time the queue was built.
 *
 * Waiting for the queue to be empty closes the window: once no job remains, no
 * resolve can land. This is only safe when a single test process is running,
 * which is how the aggregate runner invokes the scripts.
 */
async function drainQueue(charId) {
  const clearedRows = await clearQueue(charId);
  const cleared = await clearBullJobs();
  const remaining = await waitFor(
    'the BullMQ queue to drain to empty',
    async () => {
      const ids = await bullJobIds();
      return ids.length === 0 ? ids : null;
    },
    30_000,
  );
  void remaining;
  return { clearedRows, clearedJobs: cleared, remaining: remaining.length };
}

/**
 * Re-read a character row and assert it still carries the progression a
 * scenario just seeded. Guards against a late resolve landing between the seed
 * and the action that depends on it.
 */
async function assertProgressionIntact(charId, expected, context) {
  const row = await getCharacterRow(charId);
  const drifted = Object.entries(expected).filter(
    ([key, value]) => Number(row[key]) !== Number(value),
  );
  return assert(
    `${context} — the seeded progression was not overwritten before use`,
    drifted.length === 0,
    drifted.length === 0
      ? `level=${row.level} xp=${row.xp} hpCurrent=${row.hpCurrent} spCurrent=${row.spCurrent} as seeded`
      : `drifted fields: ${drifted.map(([k, v]) => `${k} seeded ${v} but is ${row[k]}`).join('; ')} — a resolve-battle job fired between the seed and the queue build`,
  );
}

/** The unresolved chain, ordered as `getBattleQueue()` orders it. */
async function getUnresolvedEntries(charId) {
  const { rows } = await sql(
    `SELECT * FROM battle_queue_entries
      WHERE "characterId" = $1 AND resolved = false
      ORDER BY "sequenceIndex" ASC`,
    [charId],
  );
  return rows;
}

async function getAllEntries(charId) {
  const { rows } = await sql(
    'SELECT * FROM battle_queue_entries WHERE "characterId" = $1 ORDER BY "sequenceIndex" ASC',
    [charId],
  );
  return rows;
}

/** `GET /battles/queue` — the API's own view of the live chain. */
async function getQueueViaApi(token) {
  const res = await request('GET', '/battles/queue', null, token);
  return res.data;
}

async function getCharacterViaApi(token) {
  const res = await request('GET', '/characters', null, token);
  return res.data;
}

/** Inventory rows for a character, flattened to `itemId -> quantity`. */
async function getInventoryMap(charId) {
  const { rows } = await sql(
    `SELECT "itemId", SUM(quantity)::int AS quantity
       FROM inventory_items
      WHERE "characterId" = $1 AND location = 'inventory'
      GROUP BY "itemId"`,
    [charId],
  );
  const map = {};
  for (const row of rows) map[row.itemId] = Number(row.quantity);
  return map;
}

/** Seed a known potion stock (a consumable the gambit `use_item` can spend). */
async function setItemQuantity(charId, itemId, quantity) {
  const { rows } = await sql(
    `SELECT id FROM inventory_items
      WHERE "characterId" = $1 AND "itemId" = $2 AND location = 'inventory'
      LIMIT 1`,
    [charId, itemId],
  );
  if (rows[0]) {
    await sql('UPDATE inventory_items SET quantity = $2 WHERE id = $1', [rows[0].id, quantity]);
  } else {
    // `slotIndex` is NOT NULL even for a stackable inventory stack.
    await sql(
      `INSERT INTO inventory_items ("characterId", location, "slotIndex", "itemId", quantity)
       VALUES ($1, 'inventory', 0, $2, $3)`,
      [charId, itemId, quantity],
    );
  }
  return getInventoryMap(charId);
}

// ---------------------------------------------------------------------------
//  Engine-side replication of `queueBattles()`
//
//  Used to CHOOSE a kill index whose next battle has the properties a scenario
//  needs, before asking the API to build it. Without this, pinning a fixed
//  `mapKillCount` is a coin flip: the monster at index N depends on the
//  character's own UUID, so index 0 is a slime for one character and a direwolf
//  for the next — which is how a "staged entry is a win" precondition silently
//  became a loss.
// ---------------------------------------------------------------------------

const monstersData = require('../../../../monsters.json');
const itemsData = require('../../../../items.json');
const skillTrees = require('../../../../skill_trees.json');
const charXpCurve = require('../../../../char_xp_curve.json');
const { BattleEngine, mulberry32Seed, rngForIndex, resolveRewards } = require('@nanommo/shared');

const ITEM_DEFS = Object.fromEntries((itemsData.consumables ?? []).map((c) => [c.id, c]));
const MONSTER_SKILL_DEFS = Object.fromEntries((skillTrees.monsterSkills ?? []).map((s) => [s.id, s]));

/** The gambit page `createCharacter()` installs: always -> attack. */
const ALWAYS_ATTACK_PAGE = {
  lines: [{ priority: 1, conditions: [{ id: 'always' }], combinator: null, action: { id: 'attack' } }],
};

/** SPEC §4.2: `xpToNextLevel(level)` from char_xp_curve.json. */
function xpToNextLevel(level) {
  const entry = charXpCurve[level - 1];
  return entry ? Number(entry.xpToNext) : 0;
}

/** The character row's six attributes, in the shape `calculateDerivedStats` wants. */
function attributesOf(row) {
  return {
    str: Number(row.str),
    agi: Number(row.agi),
    dex: Number(row.dex),
    vit: Number(row.vit),
    int: Number(row.int),
    sor: Number(row.sor),
  };
}

/**
 * Replicates `BattleService.getWeaponBaseAttackTicks()` for an unarmed character
 * (battle.service.ts:179-186): the rounded average of the whole
 * `skill_trees.json` table.
 */
function unarmedWeaponBaseAttackTicks() {
  const table = skillTrees.weaponBaseAttackTicks ?? {};
  const values = Object.values(table);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 6;
}

/**
 * SPEC §4.2 level-up loop, replicated so an expected post-resolve XP value is
 * exact even when a gain spans several thresholds.
 */
function applyXpWithLevelUps(xp, level, gain) {
  let currentXp = Number(xp) + Number(gain);
  let currentLevel = Number(level);
  let levelsGained = 0;
  for (;;) {
    const needed = xpToNextLevel(currentLevel);
    if (needed <= 0 || currentXp < needed) break;
    currentXp -= needed;
    currentLevel += 1;
    levelsGained += 1;
  }
  return { xp: currentXp, level: currentLevel, levelsGained };
}

/**
 * Replay `queueBattles()`'s input assembly for one kill index and return the
 * battle the API would build there.
 *
 * `level` and `attributes` are parameters rather than constants because a stale
 * level silently previews a different fight than the one that gets queued — the
 * queue is built from the character's CURRENT stats, so a level-10 scenario
 * previewed at level 1 picks a kill index whose real level-10 fight lands at
 * full HP.
 */
function simulateQueueStepAt({ charId, mapId, epoch, killIndex, level, attributes, chainHp, chainSp }) {
  const inMap = monstersData.monsters.filter((m) => m.map === mapId);
  if (inMap.length === 0) throw new Error(`no monsters in map ${mapId}`);

  const monster = rngForIndex(mulberry32Seed(`${charId}:${mapId}:${epoch}`), killIndex).weightedPick(inMap);
  const derived = BattleEngine.calculateDerivedStats(level, attributes, {});
  const snapshot = {
    level,
    hp: Math.max(1, Math.min(chainHp, derived.maxHp)),
    sp: Math.max(0, Math.min(chainSp, derived.maxSp)),
    ...derived,
    skills: {},
    skillDefs: {},
    statusEffects: [],
    foodBuffTicksRemaining: 0,
    equippedWeaponTypes: [],
  };
  const seed = `${charId}:${mapId}:${monster.id}:0:${epoch}:${killIndex}`;
  const simulation = BattleEngine.simulateBattle(snapshot, monster, ALWAYS_ATTACK_PAGE, seed, {
    inventory: {},
    itemDefinitions: ITEM_DEFS,
    monsterSkillDefs: MONSTER_SKILL_DEFS,
    weaponBaseAttackTicks: unarmedWeaponBaseAttackTicks(),
  });
  const rewards = resolveRewards({
    monster,
    mapId,
    outcome: simulation.outcome,
    items: itemsData,
    killIndex: 0,
    seed,
  });
  return { monster, simulation, rewards, seed, derived };
}

module.exports = {
  BASE_URL,
  REPO_ROOT,
  PG_CONFIG,
  REDIS_CONFIG,
  QUEUE_NAME,
  MAP_ID,

  request,
  sleep,
  waitFor,
  preflight,

  sql,
  pg,
  closePg,

  redis,
  queue,
  bullJobIds,
  allBullJobKeys,
  bullJobStates,
  removeBullJob,
  clearBullJobs,
  enqueueResolveJob,
  closeQueueAndRedis,

  dockerCompose,
  backendLogs,
  waitForBackendUp,

  assert,
  assertEqual,
  summarize,
  note,
  divergence,

  createCharacter,
  setCharacterProgression,
  getCharacterRow,
  getCharacterViaApi,
  setKillCounter,
  getKillCounterRow,
  clearQueue,
  drainQueue,
  assertProgressionIntact,
  insertQueueEntry,
  rewriteEndAtToPast,
  getUnresolvedEntries,
  getAllEntries,
  getQueueViaApi,
  getInventoryMap,
  setItemQuantity,

  // Engine-side replication of `queueBattles()` (see the section above).
  ITEM_DEFS,
  MONSTER_SKILL_DEFS,
  ALWAYS_ATTACK_PAGE,
  xpToNextLevel,
  attributesOf,
  unarmedWeaponBaseAttackTicks,
  applyXpWithLevelUps,
  simulateQueueStepAt,
};
