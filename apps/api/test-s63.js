#!/usr/bin/env node

const BASE_URL = 'http://localhost:3000';
const Redis = require('ioredis');
const { Client } = require('pg');

const redis = new Redis({ host: '127.0.0.1', port: 6379 });
const pg = new Client({ host: '127.0.0.1', port: 5432, user: 'nanommo', password: 'nanommo_dev_password', database: 'nanommo' });

const TIMESTAMP = Date.now().toString().slice(-8);
const USER_EMAIL = `test_${TIMESTAMP}@test.com`;
const USER_PASSWORD = 'Test123!@#';
const USER_CPF = `123456789${TIMESTAMP.slice(-2)}`;
const USER_USERNAME = `t${TIMESTAMP}`;

let ACCESS_TOKEN = '';
let CHAR_ID = '';
let GAMBIT_ID = '';

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

async function getQueueFromDB() {
  const { data } = await request('GET', `/battles/queue`, null, ACCESS_TOKEN);
  return data;
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

async function main() {
  await pg.connect();
  console.log('=== §6.3 E2E Test: Queue Recalculation on Level-Up ===\n');

  // Step 1: Register user
  console.log('1. Registering user...');
  const reg = await request('POST', '/auth/register', {
    email: USER_EMAIL,
    username: USER_USERNAME,
    password: USER_PASSWORD,
    cpf: USER_CPF,
  });
  console.log(`   Status: ${reg.status}`);
  if (reg.status !== 201) {
    console.error('   FAILED:', reg.raw);
    process.exit(1);
  }

  // Step 2: Login
  console.log('2. Logging in...');
  const login = await request('POST', '/auth/login', {
    username: USER_USERNAME,
    password: USER_PASSWORD,
  });
  console.log(`   Status: ${login.status}`);
  if (login.status !== 200 && login.status !== 201) {
    console.error('   FAILED:', login.raw);
    process.exit(1);
  }
  ACCESS_TOKEN = login.data.accessToken;
  console.log(`   Token: ${ACCESS_TOKEN.slice(0,30)}...`);

  // Step 3: Create character
  console.log('3. Creating character...');
  const char = await request('POST', '/characters', { username: 'S63TestChar' }, ACCESS_TOKEN);
  console.log(`   Status: ${char.status}`);
  if (char.status !== 201) {
    console.error('   FAILED:', char.raw);
    process.exit(1);
  }
  CHAR_ID = char.data.id;
  console.log(`   Character ID: ${CHAR_ID}`);

  // Step 4: Equip sword
  console.log('4. Equipping sword...');
  const equip = await request('PUT', '/equipment/equip', { slot: 'mainHand', itemId: 'equip_sword_t1' }, ACCESS_TOKEN);
  console.log(`   Status: ${equip.status}`);
  if (equip.status !== 200) {
    console.error('   FAILED:', equip.raw);
    process.exit(1);
  }

  // Step 5: Create gambit page (always -> attack)
  console.log('5. Creating gambit page...');
  const gambit = await request('POST', '/gambits', {
    lines: [
      { conditions: [{ id: 'always' }], action: { id: 'attack' } }
    ]
  }, ACCESS_TOKEN);
  console.log(`   Status: ${gambit.status}`);
  if (gambit.status !== 201) {
    console.error('   FAILED:', gambit.raw);
    process.exit(1);
  }
  GAMBIT_ID = gambit.data.id;
  console.log(`   Gambit ID: ${GAMBIT_ID}`);

  // Step 6: Activate gambit page
  console.log('6. Activating gambit page...');
  const activate = await request('PUT', `/gambits/${GAMBIT_ID}/activate`, {}, ACCESS_TOKEN);
  console.log(`   Status: ${activate.status}`);
  if (activate.status !== 200) {
    console.error('   FAILED:', activate.raw);
    process.exit(1);
  }

  // Step 7: Enter map (this will queue battles with kill count 0)
  console.log('7. Entering map_green_grounds...');
  const mapEnter = await request('POST', '/maps/map_green_grounds/enter', {}, ACCESS_TOKEN);
  console.log(`   Status: ${mapEnter.status}`);
  if (mapEnter.status !== 201) {
    console.error('   FAILED:', mapEnter.raw);
    process.exit(1);
  }

  // Wait for initial queue to be created
  await sleep(2000);

  // Step 8: Clear the initial queue and pin kill counter to 2 (slime)
  console.log('8. Pinning kill counter to 2 (mon_slime) and re-queueing...');
  await clearBattles(CHAR_ID);
  await setKillCounter(CHAR_ID, 'map_green_grounds', 2);
  
  // Also clear BullMQ jobs
  const keys = await redis.keys('bull:battle-queue:*');
  for (const key of keys) {
    await redis.del(key);
  }

  // Queue fresh battles with pinned kill counter
  const queueInit = await request('POST', '/battles/queue', {}, ACCESS_TOKEN);
  console.log(`   Status: ${queueInit.status}`);

  await sleep(2000);

  // Get queue BEFORE
  console.log('\n=== CAPTURING STATE BEFORE LEVEL-UP ===');
  const queueBefore = await getQueueFromDB();
  console.log('\n--- 5 Queue Entries BEFORE (ids, endAt) ---');
  for (const entry of queueBefore) {
    console.log(`   ID: ${entry.id} | seq: ${entry.sequenceIndex} | monster: ${entry.monsterId} | endAt: ${entry.endAt} | xpGain: ${entry.xpGain} | hpAfter: ${entry.hpAfter} | outcome: ${entry.outcome}`);
  }

  const redisJobsBefore = await getRedisJobs();
  const redisCountsBefore = await getRedisJobCounts();
  console.log('\n--- BullMQ Jobs in Redis BEFORE ---');
  console.log(`   Counts: waiting=${redisCountsBefore.waiting}, active=${redisCountsBefore.active}, delayed=${redisCountsBefore.delayed}, completed=${redisCountsBefore.completed}, failed=${redisCountsBefore.failed}`);
  console.log(`   Job IDs: ${Object.keys(redisJobsBefore).join(', ') || '(none)'}`);

  // Find the battle that will trigger level-up (first slime battle)
  const levelUpBattle = queueBefore.find(b => b.monsterId === 'mon_slime' && b.xpGain >= 17);
  if (!levelUpBattle) {
    console.log('\n⚠ No slime battle with enough XP found. Checking all battles...');
    for (const b of queueBefore) {
      console.log(`   ${b.monsterId}: xpGain=${b.xpGain}, xpToNext(1)=17, outcome=${b.outcome}`);
    }
    // Use first battle anyway
    const targetBattle = queueBefore[0];
    console.log(`\nUsing first battle: ${targetBattle.id} (${targetBattle.monsterId})`);
    // Wait for it to resolve
    const endAtMs = new Date(targetBattle.endAt).getTime();
    const nowMs = Date.now();
    const waitMs = Math.max(0, endAtMs - nowMs + 2000);
    console.log(`\n9. Waiting ${Math.round(waitMs/1000)}s for battle ${targetBattle.id} to resolve...`);
    await sleep(waitMs);
  } else {
    console.log(`\n🎯 Level-up battle identified: ${levelUpBattle.id} (mon_slime, xpGain=${levelUpBattle.xpGain})`);
    const endAtMs = new Date(levelUpBattle.endAt).getTime();
    const nowMs = Date.now();
    const waitMs = Math.max(0, endAtMs - nowMs + 2000);
    console.log(`\n9. Waiting ${Math.round(waitMs/1000)}s for battle ${levelUpBattle.id} to resolve...`);
    await sleep(waitMs);
  }

  // Give extra time for the BullMQ job to process and requeue
  console.log('   Waiting additional 5s for requeue to complete...');
  await sleep(5000);

  // Get queue AFTER
  console.log('\n=== CAPTURING STATE AFTER LEVEL-UP ===');
  const queueAfter = await getQueueFromDB();
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

  // Get character state
  const charState = await request('GET', `/characters`, null, ACCESS_TOKEN);
  console.log('\n--- Character State After Level-Up ---');
  if (Array.isArray(charState.data)) {
    const c = charState.data[0];
    console.log(`   Level: ${c.level}, XP: ${c.xp}, unspent: ${c.unspentAttributePoints}`);
    console.log(`   hpCurrent: ${c.hpCurrent}, spCurrent: ${c.spCurrent}`);
    console.log(`   Status: ${c.status}, Map: ${c.currentMapId}`);
  }

  // Test 3: Idempotency of requeueBattlesAfterLevelUp
  console.log('\n=== TEST 3: Idempotency of requeueBattlesAfterLevelUp ===');
  // We can't directly call the private method, but we can verify queue stability
  await sleep(2000);
  const queueCheck1 = await getQueueFromDB();
  await sleep(2000);
  const queueCheck2 = await getQueueFromDB();
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