const assert = require('node:assert/strict');
const { BattleEngine, GambitEvaluator, effectiveFoodStatValue } = require('../../../packages/shared/dist');

describe('Diet food digestion rules', () => {
  const food = { id:'food_bread', type:'consumable', stackable:true, effect:{type:'food_buff',durationSeconds:3600,hpRegenPerTenTicks:4,spRegenPerTenTicks:1} };
  it('applies the Diet level as a flat +1 per regeneration stat', () => {
    assert.equal(effectiveFoodStatValue(8, 0), 8);
    assert.equal(effectiveFoodStatValue(8, 1), 9);
    assert.equal(effectiveFoodStatValue(8, 2), 10);
    assert.equal(effectiveFoodStatValue(8, 3), 11);
    assert.equal(effectiveFoodStatValue(8, 99), 11);
  });

  const character = { level:1,hp:100,sp:50,maxHp:100,maxSp:50,atk:20,matk:10,def:0,mdefPercent:0,accuracy:100,evasion:0,critChance:0,hpRegenPerTenTicks:0,spRegenPerTenTicks:0,agi:5,dex:5,foodDigestRemainingTicksByItem:{food_bread:10},dietLevelByFood:{food_bread:0} };

  it('rejects the same food while digestion is active', () => {
    assert.equal(GambitEvaluator.isActionLegal({id:'use_item',itemId:'food_bread'},character,{food_bread:1}),false);
    assert.equal(GambitEvaluator.isActionLegal({id:'use_item',itemId:'food_bread'},{...character,foodDigestRemainingTicksByItem:{food_bread:0}},{food_bread:1}),true);
  });

  it('applies the persisted Diet level when food is used by the battle engine', () => {
    const result = BattleEngine.simulateBattle(
      {...character,foodDigestRemainingTicksByItem:{food_bread:0},dietLevelByFood:{food_bread:2}},
      {id:'training_dummy',hp:35,maxHp:35,atk:1,matk:1,def:0,mdefPercent:0,accuracy:0,evasion:0,critChance:0,atkSpeedTicks:6,gambit:[{priority:1,condition:{type:'always'},action:{type:'attack'}}]},
      {lines:[{priority:1,conditions:[{id:'always'}],action:{id:'use_item',itemId:'food_bread'}},{priority:2,conditions:[{id:'always'}],action:{id:'attack'}}]},
      'diet-level-test-seed',
      {inventory:{food_bread:3},itemDefinitions:{food_bread:food},weaponBaseAttackTicks:6},
    );
    assert.equal(result.foodBuffAfter?.hpRegenPerTenTicks, 7);
    assert.equal(result.foodBuffAfter?.spRegenPerTenTicks, 4);
  });

  it('keeps generic food use available but cannot consume the same food twice during one digestion window', () => {
    const result = BattleEngine.simulateBattle(
      {...character,foodDigestRemainingTicksByItem:{food_bread:0}},
      {id:'training_dummy',hp:35,maxHp:35,atk:1,matk:1,def:0,mdefPercent:0,accuracy:0,evasion:0,critChance:0,atkSpeedTicks:6,gambit:[{priority:1,condition:{type:'always'},action:{type:'attack'}}]},
      {lines:[{priority:1,conditions:[{id:'always'}],action:{id:'use_item',itemId:'food_bread'}},{priority:2,conditions:[{id:'always'}],action:{id:'attack'}}]},
      'diet-test-seed',
      {inventory:{food_bread:3},itemDefinitions:{food_bread:food},weaponBaseAttackTicks:6},
    );
    const foodUses=result.log.events.filter(event=>event.action==='use_item'&&event.itemId==='food_bread');
    assert.equal(foodUses.length,1);
    assert.deepEqual(result.itemsConsumed,[{itemId:'food_bread',quantity:1}]);
  });
});
