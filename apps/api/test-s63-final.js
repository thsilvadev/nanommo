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
  return 2;
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

async function getRedisJobs() {
  const keys = await redis.keys('bull:battle-queue:*');
  const jobs = {};
  for (const key of keys) {
    if (key.includes(':id:') || key.includes(':data:')) {
      const id = key.split(':').pop();
      const jobData = await redis.get(key);
      if (jobData) {
        try { jobs[id] = JSON.parse(jobData); } catch {}
      }
    }
  }
  return jobs;
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

async function main() {
  await pg.connect();
  console.log('=== §6.3 E2E Test: Queue Recalculation on Level-Up ===\n');

  const TIMESTAMP = Date.now().toString().slice(-8);
  const USER_EMAIL = `test_${TIMESTAMP}@test.com`;
  const USER_PASSWORD = 'Test123!@#';
  const USER_CPF = `123456789${TIMESTAMP.slice(-2)}`;
  const USER_USERNAME = `t${TIMESTAMP}`;

  let ACCESS_TOKEN = '';
  let CHAR_ID = '';
  let GAMBIT_ID = '';

  // Step 1: Register user
  console.log('1. Registering user...');
  const reg = await request('POST', '/auth/register', {
    email: USER_EMAIL,
    username: USER_USERNAME,
    password: USER_PASSWORD,
    cpf: USER_CPF,
  });
  console.log(`   Status: ${reg.status}`);
  if (reg.status !== 201) throw new Error(`Register failed: ${reg.raw}`);

  // Step 2: Login
  console.log('2. Logging in...');
  const login = await request('POST', '/auth/login', {
    username: USER_USERNAME,
    password: USER_PASSWORD,
  });
  console.log(`   Status: ${login.status}`);
  if (login.status !== 200 && login.status !== 201) throw new Error(`Login failed: ${login.raw}`);
  ACCESS_TOKEN = login.data.accessToken;
  console.log(`   Token: ${ACCESS_TOKEN.slice(0,30)}...`);

  // Step 3: Create character
  console.log('3. Creating character...');
  const char = await request('POST', '/characters', { username: 'S63TestChar' }, ACCESS_TOKEN);
  console.log(`   Status: ${char.status}`);
  if (char.status !== 201) throw new Error(`Create char failed: ${char.raw}`);
  CHAR_ID = char.data.id;
  console.log(`   Character ID: ${CHAR_ID}`);

  // Step 4: Equip sword
  console.log('4. Equipping sword...');
  const equip = await request('PUT', '/equipment/equip', { slot: 'mainHand', itemId: 'equip_sword_t1' }, ACCESS_TOKEN);
  console.log(`   Status: ${equip.status}`);
  if (equip.status !== 200) throw new Error(`Equip failed: ${equip.raw}`);

  // Step 5: Create gambit page
  console.log('5. Creating gambit page...');
  const gambit = await request('POST', '/gambits', {
    lines: [{ conditions: [{ id: 'always' }], action: { id: 'attack' } }]
  }, ACCESS_TOKEN);
  console.log(`   Status: ${gambit.status}`);
  if (gambit.status !== 201) throw new Error(`Gambit failed: ${gambit.raw}`);
  GAMBIT_ID = gambit.data.id;
  console.log(`   Gambit ID: ${GAMBIT_ID}`);

  // Step 6: Activate gambit page
  console.log('6. Activating gambit page...');
  const activate = await request('PUT', `/gambits/${GAMBIT_ID}/activate`, {}, ACCESS_TOKEN);
  console.log(`   Status: ${activate.status}`);
  if (activate.status !== 200) throw new Error(`Activate failed: ${activate.raw}`);

  // Step 7: Enter map
  console.log('7. Entering map_green_grounds...');
  const mapEnter = await request('POST', '/maps/map_green_grounds/enter', {}, ACCESS_TOKEN);
  console.log(`   Status: ${mapEnter.status}`);
  if (mapEnter.status !== 201) throw new Error(`Enter map failed: ${mapEnter.raw}`);

  await sleep(2000);

  // Step 8: Find kill count for slime and pin it
  console.log('8. Pinning kill counter for mon_slime...');
  const slimeKillCount = findSlimeKillCount(CHAR_ID, 'map_green_grounds', 0);
  console.log(`   Slime at kill count: ${slimeKillCount}`);
  
  await clearBattles(CHAR_ID);
  await setKillCounter(CHAR_ID, 'map_green_grounds', slimeKillCount);
  await clearRedisJobs();

  const queueInit = await request('POST', '/battles/queue', {}, ACCESS_TOKEN);
  console.log(`   Queue init status: ${queueInit.status}`);
  if (queueInit.status !== 201) throw new Error(`Queue failed: ${queueInit.raw}`);

  await sleep(2000);

  // === CAPTURING STATE BEFORE LEVEL-UP ===
  console.log('\n=== CAPTURING STATE BEFORE LEVEL-UP ===');
  const queueBefore = await getQueueFromDB(ACCESS_TOKEN);
  console.log('\n--- 5 Queue Entries BEFORE (ids, endAt) ---');
  for (const entry of queueBefore) {
    console.log(`   ID: ${entry.id} | seq: ${entry.sequenceIndex} | monster: ${entry.monsterId} | endAt: ${entry.endAt} | xpGain: ${entry.xpGain} | hpAfter: ${entry.hpAfter} | outcome: ${entry.outcome}`);
  }

  const redisJobsBefore = await getRedisJobs();
  const redisCountsBefore = await getRedisJobCounts();
  console.log('\n--- BullMQ Jobs in Redis BEFORE ---');
  console.log(`   Counts: waiting=${redisCountsBefore.waiting}, active=${redisCountsBefore.active}, delayed=${redisCountsBefore.delayed}, completed=${redisCountsBefore.completed}, failed=${redisCountsBefore.failed}`);
  console.log(`   Job IDs: ${Object.keys(redisJobsBefore).join(', ') || '(none)'}`);

  // Find the level-up battle (first slime with xpGain >= 17)
  const levelUpBattle = queueBefore.find(b => b.monsterId === 'mon_slime' && b.xpGain >= 17);
  if (!levelUpBattle) throw new Error('No level-up battle found');
  console.log(`\n🎯 Level-up battle: ${levelUpBattle.id} (mon_slime, xpGain=${levelUpBattle.xpGain})`);

  // Wait for resolution
  const endAtMs = new Date(levelUpBattle.endAt).getTime();
  const waitMs = Math.max(0, endAtMs - Date.now() + 2000);
  console.log(`\n9. Waiting ${Math.round(waitMs/1000)}s for battle to resolve...`);
  await sleep(waitMs);
  console.log('   Waiting additional 5s for requeue...');
  await sleep(5000);

  // === CAPTURING STATE AFTER LEVEL-UP ===
  console.log('\n=== CAPTURING STATE AFTER LEVEL-UP ===');
  const queueAfter = await getQueueFromDB(ACCESS_TOKEN);
  console.log('\n--- 5 Queue Entries AFTER (ids, endAt) ---');
  for (const entry of queueAfter) {
    console.log(`   ID: ${entry.id} | seq: ${entry.sequenceIndex} | monster: ${entry.monsterId} | endAt: ${entry.endAt} | xpGain: ${entry.xpGain} | hpAfter: ${entry.hpAfter} | outcome: ${entry.outcome}`);
  }

  const redisJobsAfter = await getRedisJobs();
  const redisCountsAfter = await getRedisJobCounts();
  console.log('\n--- BullMQ Jobs in Redis AFTER ---');
  console.log(`   Counts: waiting=${redisCountsAfter.waiting}, active=${redisCountsAfter.active}, delayed=${redisCountsAfter.delayed}, completed=${redisCountsAfter.completed}, failed=${redisCountsAfter.failed}`);
  console.log(`   Job IDs: ${Object.keys(redisJobsAfter).join(', ') || '(none)'}`);

  // Verify IDs are different
  const beforeIds = new Set(queueBefore.map(b => b.id));
  const afterIds = new Set(queueAfter.map(b => b.id));
  const overlap = [...beforeIds].filter(id => afterIds.has(id));
  console.log('\n--- ID Comparison ---');
  console.log(`   Before IDs: ${[...beforeIds].join(', ')}`);
  console.log(`   After IDs:  ${[...afterIds].join(', ')}`);
  console.log(`   Overlap (should be empty): ${overlap.join(', ') || '(none - GOOD)'}`);

  // Check for orphaned jobs
  const beforeJobIds = new Set(Object.keys(redisJobsBefore));
  const afterJobIds = new Set(Object.keys(redisJobsAfter));
  const orphaned = [...beforeJobIds].filter(id => !afterJobIds.has(id));
  console.log('\n--- Orphaned Jobs Check ---');
  console.log(`   Before job IDs: ${[...beforeJobIds].join(', ') || '(none)'}`);
  console.log(`   After job IDs:  ${[...afterJobIds].join(', ') || '(none)'}`);
  console.log(`   Orphaned (should be 0): ${orphaned.length}`);
  console.log(`   Completed jobs: ${redisCountsAfter.completed} (should be 1 for the resolved battle)`);

  // Get character state
  const charState = await request('GET', `/characters`, null, ACCESS_TOKEN);
  const c = charState.data; // Single object, not array
  console.log('\n--- Character State After Level-Up ---');
  if (c && c.id) {
    console.log(`   Level: ${c.level}, XP: ${c.xp}, unspent: ${c.unspentAttributePoints}`);
    console.log(`   hpCurrent: ${c.hpCurrent}, spCurrent: ${c.spCurrent}`);
    console.log(`   Status: ${c.status}, Map: ${c.currentMapId}`);
  } else {
    console.log(`   Response: ${JSON.stringify(charState.data)}`);
  }

  // Test 3: Idempotency - check queue stability
  console.log('\n=== TEST 3: Idempotency of requeueBattlesAfterLevelUp ===');
  await sleep(2000);
  const queueCheck1 = await getQueueFromDB(ACCESS_TOKEN);
  await sleep(2000);
  const queueCheck2 = await getQueueFromDB(ACCESS_TOKEN);
  const ids1 = queueCheck1.map(b => b.id).join(',');
  const ids2 = queueCheck2.map(b => b.id).join(',');
  console.log(`   Check 1 IDs: ${ids1}`);
  console.log(`   Check 2 IDs: ${ids2}`);
  console.log(`   Stable: ${ids1 === ids2 ? 'YES' : 'NO'}`);

  // Test 4: hpAfter reflects real damage
  console.log('\n=== TEST 4: hpAfter reflects real damage ===');
  for (const entry of queueAfter) {
    const startHP = entry.log?.header?.characterSnapshot?.hp;
    if (startHP) {
      const dmg = startHP - entry.hpAfter;
      console.log(`   Battle ${entry.id} (${entry.monsterId}): startHP=${startHP}, hpAfter=${entry.hpAfter}, damageTaken=${dmg}`);
    }
  }

  // Also check the level-up battle log for damage
  console.log('\n--- Level-up Battle Log (damage verification) ---');
  const lupLog = levelUpBattle.log;
  if (lupLog && lupLog.events) {
    const charEvents = lupLog.events.filter(e => e.actor === 'character' && e.action === 'attack');
    const monsterEvents = lupLog.events.filter(e => e.actor === 'monster' && e.action === 'attack');
    console.log(`   Character attacks: ${charEvents.length}`);
    console.log(`   Monster attacks: ${monsterEvents.length}`);
    if (monsterEvents.length > 0) {
      const totalMonsterDmg = monsterEvents.reduce((sum, e) => sum + (e.damage || 0), 0);
      console.log(`   Total monster damage: ${totalMonsterDmg}`);
    }
    const startHP = lupLog.header?.characterSnapshot?.hp;
    if (startHP) {
      console.log(`   Start HP: ${startHP}, End HP: ${levelUpBattle.hpAfter}, Damage taken: ${startHP - levelUpBattle.hpAfter}`);
    }
  }

  console.log('\n=== TEST COMPLETE ===');
  await redis.quit();
  await pg.end();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  redis.quit();
  pg.end();
  process.exit(1);
});