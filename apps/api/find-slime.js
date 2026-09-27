const { Mulberry32, mulberry32Seed, rngForIndex } = require('@nanommo/shared');

const monsters = [
  { id: 'mon_slime', weight: 1 },
  { id: 'mon_fieldbat', weight: 1 },
  { id: 'mon_thornsprout', weight: 1 },
  { id: 'mon_mudcrawler', weight: 1 },
  { id: 'mon_direwolf', weight: 1 },
];

const charId = 'test-char-id';
const mapId = 'map_green_grounds';
const epoch = 0;

const seed = mulberry32Seed(charId + ':' + mapId + ':' + epoch);

for (let i = 0; i < 20; i++) {
  const rng = rngForIndex(seed, i);
  const pick = rng.weightedPick(monsters);
  console.log('Kill count ' + i + ': ' + pick.id);
}