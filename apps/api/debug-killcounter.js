#!/usr/bin/env node

const { Client } = require('pg');
const pg = new Client({ host: '127.0.0.1', port: 5432, user: 'nanommo', password: 'nanommo_dev_password', database: 'nanommo' });

const { Mulberry32, mulberry32Seed, rngForIndex } = require('@nanommo/shared');

async function main() {
  await pg.connect();
  
  // Check kill counter
  const result = await pg.query(`SELECT * FROM map_kill_counters WHERE "characterId" = '94191b67-dbe9-4f73-b46c-8a852c9500cb'`);
  console.log('Kill counter:', result.rows[0]);
  
  // Test RNG
  const monsters = [
    { id: 'mon_slime', weight: 1 },
    { id: 'mon_fieldbat', weight: 1 },
    { id: 'mon_thornsprout', weight: 1 },
    { id: 'mon_mudcrawler', weight: 1 },
    { id: 'mon_direwolf', weight: 1 },
  ];
  
  const charId = '94191b67-dbe9-4f73-b46c-8a852c9500cb';
  const mapId = 'map_green_grounds';
  const epoch = 0;
  
  const seed = mulberry32Seed(charId + ':' + mapId + ':' + epoch);
  
  for (let i = 0; i < 10; i++) {
    const rng = rngForIndex(seed, i);
    const pick = rng.weightedPick(monsters);
    console.log(`Kill count ${i}: ${pick.id}`);
  }
  
  await pg.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  pg.end();
  process.exit(1);
});