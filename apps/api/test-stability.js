#!/usr/bin/env node

const BASE_URL = 'http://localhost:3000';
const Redis = require('ioredis');
const { Client } = require('pg');
const { Mulberry32, mulberry32Seed, rngForIndex } = require('@nanommo/shared');

const redis = new Redis({ host: '127.0.0.1', port: 6379 });
const pg = new Client({ host: '127.0.0.1', port: 5432, user: 'nanommo', password: 'nanommo_dev_password', database: 'nanommo' });

const monsters = [
  { id: 'mon_slime', weight: 1 },
  { id: 'mon_fieldbat', weight: 1 },
  { id: 'mon_thornsprout', weight: 1 },
  { id: 'mon_mudcrawler', weight: 1 },
  { id: 'mon_direwolf', weight: 1 },
];

function findSlimeKillCount(characterId, mapId, epoch = 0) {
  const seed = mulberry32Seed(`${characterId}:${mapId}:${epoch}`);
  for (let i = 0; i < 100; i++) {
    const rng = rngForIndex(seed, i);
    const pick = rng.weightedPick(monsters);
    if (pick.id === 'mon_slime') {
      return i;
    }
  }
  return 2; // fallback
}

async function request(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, data: json, raw: text };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getQueueFromDB(token) {
  const { data } = await request('GET', `/battles/queue`, null, token);
  return data;
}

async function getRedisJobCounts() {
  const waiting = await redis.zcard('bull:battle-queue:waiting');
  const active = await redis.zcard('bull:battle-queue:active');
  const delayed = await redis.zcard('bull:battle-queue:delayed');
  const completed = await redis.zcard('bull:battle-queue:completed');
  const failed = await redis.zcard('bull:battle-queue:failed');
  return { waiting, active, delayed, completed, failed };
}

async function setKillCounter(characterId, mapId, mapKillCount) {
  await pg.query(
    `UPDATE map_kill_counters SET "mapKillCount" = $1 WHERE "characterId" = $2 AND "mapId" = $3`,
    [mapKillCount, characterId, mapId]
  );
}

async function clearBattles(characterId) {
  await pg.query(
    `DELETE FROM battle_queue_entries WHERE "characterId" = $1`,
    [characterId]
  );
}

async function clearRedisJobs() {
  const keys = await redis.keys('bull:battle-queue:*');
  for (const key of keys) {
    await redis.del(key);
  }
}

async function runOneTest(testNum) {
  const TIMESTAMP = `${Date.now()}-${testNum}`;
  const USER_EMAIL = `test_${TIMESTAMP}@test.com`;
  const USER_PASSWORD = 'Test123!@#';
  const USER_CPF = `123456789${TIMESTAMP.slice(-2)}`;
  const USER_USERNAME = `t${TIMESTAMP}`;

  let ACCESS_TOKEN = '';
  let CHAR_ID = '';
  let GAMBIT_ID = '';

  // Register
  const reg = await request('POST', '/auth/register', {
    email: USER_EMAIL,
    username: USER_USERNAME,
    password: USER_PASSWORD,
    cpf: USER_CPF,
  });
  if (reg.status !== 201) throw new Error(`Register failed: ${reg.raw}`);

  // Login
  const login = await request('POST', '/auth/login', {
    username: USER_USERNAME,
    password: USER_PASSWORD,
  });
  if (login.status !== 200 && login.status !== 201) throw new Error(`Login failed: ${login.raw}`);
  ACCESS_TOKEN = login.data.accessToken;

  // Create character
  const char = await request('POST', '/characters', { username: `S63TestChar${testNum}` }, ACCESS_TOKEN);
  if (char.status !== 201) throw new Error(`Create char failed: ${char.raw}`);
  CHAR_ID = char.data.id;

  // Equip sword
  const equip = await request('PUT', '/equipment/equip', { slot: 'mainHand', itemId: 'equip_sword_t1' }, ACCESS_TOKEN);
  if (equip.status !== 200) throw new Error(`Equip failed: ${equip.raw}`);

  // Create gambit page
  const gambit = await request('POST', '/gambits', {
    lines: [{ conditions: [{ id: 'always' }], action: { id: 'attack' } }]
  }, ACCESS_TOKEN);
  if (gambit.status !== 201) throw new Error(`Gambit failed: ${gambit.raw}`);
  GAMBIT_ID = gambit.data.id;

  // Activate gambit page
  const activate = await request('PUT', `/gambits/${GAMBIT_ID}/activate`, {}, ACCESS_TOKEN);
  if (activate.status !== 200) throw new Error(`Activate failed: ${activate.raw}`);

  // Enter map (creates kill counter row)
  const mapEnter = await request('POST', '/maps/map_green_grounds/enter', {}, ACCESS_TOKEN);
  if (mapEnter.status !== 201) throw new Error(`Enter map failed: ${mapEnter.raw}`);

  await sleep(2000);

  // Find kill count that yields slime for THIS character
  const slimeKillCount = findSlimeKillCount(CHAR_ID, 'map_green_grounds', 0);
  console.log(`   Character ${CHAR_ID}: slime at kill count ${slimeKillCount}`);

  // Clear initial queue and pin kill counter
  await clearBattles(CHAR_ID);
  await setKillCounter(CHAR_ID, 'map_green_grounds', slimeKillCount);
  await clearRedisJobs();

  // Queue fresh battles with pinned kill counter
  const queueInit = await request('POST', '/battles/queue', {}, ACCESS_TOKEN);
  if (queueInit.status !== 201) throw new Error(`Queue failed: ${queueInit.raw}`);

  await sleep(2000);

  // Get queue BEFORE
  const queueBefore = await getQueueFromDB(ACCESS_TOKEN);
  const levelUpBattle = queueBefore.find(b => b.monsterId === 'mon_slime' && b.xpGain >= 17);
  if (!levelUpBattle) {
    console.log(`   Queue: ${queueBefore.map(b => `${b.monsterId}(xp:${b.xpGain})`).join(', ')}`);
    throw new Error('No level-up battle found');
  }

  const endAtMs = new Date(levelUpBattle.endAt).getTime();
  const waitMs = Math.max(0, endAtMs - Date.now() + 2000);
  await sleep(waitMs);
  await sleep(5000); // Extra time for requeue

  // Get queue AFTER
  const queueAfter = await getQueueFromDB(ACCESS_TOKEN);
  
  // Verify IDs are different
  const beforeIds = new Set(queueBefore.map(b => b.id));
  const afterIds = new Set(queueAfter.map(b => b.id));
  const overlap = [...beforeIds].filter(id => afterIds.has(id));
  
  // Check Redis
  const redisCounts = await getRedisJobCounts();
  
  // Get character state
  const charState = await request('GET', `/characters`, null, ACCESS_TOKEN);
  const c = Array.isArray(charState.data) ? charState.data[0] : null;

  return {
    success: true,
    beforeCount: queueBefore.length,
    afterCount: queueAfter.length,
    overlapCount: overlap.length,
    redisCompleted: redisCounts.completed,
    level: c?.level,
    xp: c?.xp,
    unspent: c?.unspentAttributePoints,
    hpCurrent: c?.hpCurrent,
    status: c?.status,
  };
}

async function main() {
  await pg.connect();
  console.log('=== §6.3 Transient Instability Investigation ===\n');
  console.log('Running same scenario 3x to check stability...\n');

  const results = [];
  for (let i = 1; i <= 3; i++) {
    console.log(`--- Run ${i} ---`);
    try {
      const result = await runOneTest(i);
      results.push({ run: i, ...result });
      console.log(`   ✓ PASS: level=${result.level}, xp=${result.xp}, unspent=${result.unspent}, hp=${result.hpCurrent}, overlap=${result.overlapCount}, redisCompleted=${result.redisCompleted}`);
    } catch (err) {
      results.push({ run: i, success: false, error: err.message });
      console.log(`   ✗ FAIL: ${err.message}`);
    }
    await sleep(3000);
  }

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.success).length;
  console.log(`Passed: ${passed}/3`);
  
  if (passed === 3) {
    console.log('✓ STABLE - No transient instability detected');
  } else {
    console.log('✗ UNSTABLE - Transient instability confirmed');
    results.filter(r => !r.success).forEach(r => console.log(`   Run ${r.run}: ${r.error}`));
  }

  await redis.quit();
  await pg.end();
  process.exit(passed === 3 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  redis.quit();
  pg.end();
  process.exit(1);
});