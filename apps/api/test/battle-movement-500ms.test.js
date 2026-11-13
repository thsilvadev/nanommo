const assert = require('node:assert/strict');
const { BattleEngine } = require('../../../packages/shared/dist/battle-engine');

function character(moveSpeed) {
  const derived = BattleEngine.calculateDerivedStats(1, { str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5 }, {});
  return {
    ...derived, level: 1, hp: 50000, maxHp: 50000, sp: 0, maxSp: 0,
    atk: 1, matk: 0, def: 9999, accuracy: 100, evasion: 9999, critChance: 0,
    attackSpeed: 800, moveSpeedBase: moveSpeed, moveSpeed, statusEffects: [],
    hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0,
    combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0,
  };
}

const stationaryRangedTarget = {
  id: 'movement-500ms-target', level: 1, hp: 50000, atk: 0, matk: 0, def: 0,
  mdefPercent: 0, accuracy: 0, evasion: 0, critChance: 0,
  atkSpeedTicks: 99, combatStyle: 'ranged', basicAttackDamageType: 'ranged',
  basicAttackRange: 6, moveSpeedBase: 0, canMove: false, gambit: [],
};
const attackPage = { lines: [{ priority: 1, condition: { id: 'always' }, action: { id: 'attack' } }] };

for (const [speed, firstMove] of [[50, 4], [98, 3], [100, 2], [150, 2], [200, 1], [400, 1]]) {
  const result = BattleEngine.simulateBattle(
    character(speed), stationaryRangedTarget, attackPage,
    `ordinary-movement-500ms-${speed}`, { statusEffectDefs: {} },
  );
  const moves = result.log.events.filter(event => event.actor === 'character' && event.action === 'move');
  assert.equal(moves[0]?.tick, firstMove, `Move Speed ${speed} first movement tick`);
  assert(moves.length >= 2, `Move Speed ${speed} produces repeat movement while approach remains required`);
  assert(moves.every(event => event.spacesMoved === 1 && Math.abs(event.toPosition - event.fromPosition) === 1), `Move Speed ${speed} never skips a lane slot`);
  assert(moves.slice(1).every((event, index) => event.tick - moves[index].tick >= 1), `Move Speed ${speed} moves at most one space per tick`);
  if (speed >= 200) assert.equal(moves[1].tick, firstMove + 1, `Move Speed ${speed} retains overflow for the next tick`);
}

console.log('battle-movement-500ms: threshold, per-tick cadence, overflow and adjacent-only movement passed');
