const assert = require('node:assert/strict');
const { projectStatusTimeline } = require('../../../packages/shared/dist');

const snapshot = [
  { type: 'freeze', appliedAtTick: 1, expiresAtTick: 8, sourceSkillId: 'ice_bolt' },
  { type: 'bleed', appliedAtTick: 2, sourceSkillId: 'heavy_swing' },
  { type: 'poison', appliedAtTick: 1, expiresAtTick: 5 },
];
const events = [
  { tick: 3, actor: 'monster', target: 'character', action: 'status_stack_applied', status: 'freeze', durationTicks: 10, expiresAtTick: 13, stackCount: 2, sourceSkillId: 'monster_skill_ice_bolt' },
  { tick: 4, actor: 'character', target: 'monster', action: 'status_applied', status: 'stun', durationTicks: 2 },
  { tick: 5, actor: 'monster', target: 'character', action: 'status_stack_lessened', status: 'freeze', stackCount: 1, expiredAtTick: 8, expiredAppliedAtTick: 1 },
  { tick: 6, actor: 'monster', target: 'character', action: 'status_ended', status: 'poison' },
  { tick: 7, actor: 'monster', target: 'character', action: 'status_refreshed', status: 'bleed', sourceSkillId: 'refresh_bleed' },
];
let projected = projectStatusTimeline(snapshot, events, 'character', 4);
assert.equal(projected.get('freeze').length, 2, 'snapshot and later stack are active before removal');
assert.equal(projected.has('stun'), false, 'status on the opposite target is ignored');
assert.equal(projected.get('bleed').length, 1, 'durationless snapshot status is indefinite');
assert.equal(projected.has('poison'), true, 'Poison remains before expiry/end tick');
projected = projectStatusTimeline(snapshot, events, 'character', 5);
assert.equal(projected.get('freeze').length, 1, 'stack removal identifies the exact expired stack');
assert.equal(projected.has('poison'), false, 'Poison is hidden at the exact expiresAtTick boundary');
projected = projectStatusTimeline(snapshot, events, 'character', 6);
assert.equal(projected.has('poison'), false, 'explicit end removes the status');
projected = projectStatusTimeline(snapshot, events, 'character', 7);
assert.equal(projected.get('bleed')[0].sourceSkillId, 'refresh_bleed', 'refresh replaces the previous application');
assert.equal(projected.get('bleed')[0].expiresAtTick, Infinity, 'durationless status remains until removed');
projected = projectStatusTimeline([], [{tick:0,target:'character',action:'status_applied',status:'future_status'}], 'character', 0);
assert.equal(projected.has('future_status'), true, 'unknown status IDs still project without catalogue coupling');
projected = projectStatusTimeline(snapshot, events, 'character', 8);
assert.equal(projected.get('freeze').length, 1, 'expired stack is filtered at the exact expiry boundary');
projected = projectStatusTimeline(snapshot, events, 'character', 13);
assert.equal(projected.has('freeze'), false, 'all stacks disappear at expiry boundary');
// Poison is applied to the character; same-tick status events preserve persisted array order.
const poisonSnapshot = [];
const poisonEvents = [
  { tick: 2, actor: 'monster', target: 'character', action: 'status_applied', status: 'poison', durationTicks: 5, sourceSkillId: 'poison_sting' },
  { tick: 2, actor: 'monster', target: 'character', action: 'damage_over_time', status: 'poison', damage: 7 },
  { tick: 2, actor: 'character', target: 'monster', action: 'status_applied', status: 'bleed', durationTicks: 5 },
];
projected = projectStatusTimeline(poisonSnapshot, poisonEvents, 'character', 1);
assert.equal(projected.has('poison'), false, 'status is not applied before its event tick');
projected = projectStatusTimeline(poisonSnapshot, poisonEvents, 'character', 2);
assert.equal(projected.get('poison')[0].expiresAtTick, 7, 'duration-only events derive their expiry from event tick');
assert.equal(projected.get('poison')[0].sourceSkillId, 'poison_sting');
assert.equal(projected.has('bleed'), false, 'opposite target is not affected by a status event');
projected = projectStatusTimeline(poisonSnapshot, poisonEvents, 'character', 7);
assert.equal(projected.has('poison'), false, 'poison is removed exactly at expiresAtTick');
projected = projectStatusTimeline([], [
  {tick:1,target:'monster',action:'status_applied',status:'slow',expiresAtTick:9,sourceSkillId:'first'},
  {tick:1,target:'monster',action:'status_refreshed',status:'slow',durationTicks:12,sourceSkillId:'second'},
  {tick:1,target:'monster',action:'status_stack_applied',status:'burn',expiresAtTick:4,stackCount:1,sourceSkillId:'burn-1'},
  {tick:2,target:'monster',action:'status_stack_applied',status:'burn',expiresAtTick:8,stackCount:2,sourceSkillId:'burn-2'},
], 'monster', 3);
assert.equal(projected.get('slow').length,1,'refresh replaces rather than adds another nonstacking instance');
assert.equal(projected.get('slow')[0].sourceSkillId,'second','later equal-tick refresh wins according to event array order');
assert.equal(projected.get('slow')[0].expiresAtTick,13);
assert.equal(projected.get('burn').length,2,'two differently timed stacks remain independently represented');
projected = projectStatusTimeline([], [
  {tick:0,target:'character',action:'status_stack_applied',status:'bleed',expiresAtTick:3,stackCount:1,sourceSkillId:'a'},
  {tick:1,target:'character',action:'status_stack_applied',status:'bleed',expiresAtTick:6,stackCount:2,sourceSkillId:'b'},
  {tick:2,target:'character',action:'status_stack_lessened',status:'bleed',stackCount:1,expiredAtTick:3,expiredAppliedAtTick:0},
], 'character', 2);
assert.deepEqual(projected.get('bleed').map(stack=>stack.sourceSkillId),['b'],'exact removal preserves the other stack even if expiry orders differ');
projected = projectStatusTimeline([], [
  {tick:0,target:'character',action:'status_stack_applied',status:'bleed',expiresAtTick:3,stackCount:1,sourceSkillId:'a'},
  {tick:1,target:'character',action:'status_stack_applied',status:'bleed',expiresAtTick:6,stackCount:2,sourceSkillId:'b'},
  {tick:2,target:'character',action:'status_stack_lessened',status:'bleed',stackCount:1,expiredAtTick:3,expiredAppliedAtTick:0},
], 'character', 4);
assert.deepEqual(projected.get('bleed').map(stack=>stack.sourceSkillId),['b'],'pre-filtering the opening snapshot by display tick must not erase historical stack identity or drop a later stack');
projected = projectStatusTimeline([], [
  {tick:0,target:'character',action:'status_applied',status:'zero_duration',durationTicks:0},
  {tick:1,target:'character',action:'status_ended',status:'zero_duration'},
  {tick:2,target:'character',action:'status_applied',status:'ended_explicitly'},
  {tick:3,target:'character',action:'status_expired',status:'ended_explicitly'},
], 'character', 0);
assert.equal(projected.get('zero_duration')[0].expiresAtTick,Infinity,'zero-duration status is untimed unless explicit removal occurs');
projected = projectStatusTimeline([], [
  {tick:0,target:'character',action:'status_applied',status:'zero_duration',durationTicks:0},
  {tick:1,target:'character',action:'status_ended',status:'zero_duration'},
  {tick:2,target:'character',action:'status_applied',status:'ended_explicitly'},
  {tick:3,target:'character',action:'status_expired',status:'ended_explicitly'},
], 'character', 3);
assert.equal(projected.has('zero_duration'),false,'explicit ended removes untimed status');
assert.equal(projected.has('ended_explicitly'),false,'explicit expired event removes status');
projected = projectStatusTimeline([], [
  {tick:1,target:'monster',action:'status_applied',status:'bleed',durationTicks:5},
  {tick:1,target:'monster',action:'damage_over_time',status:'bleed',damage:5},
], 'character', 2);
assert.equal(projected.has('bleed'),false,'status projection filters target ownership independently of source actor');
projected = projectStatusTimeline([], [
  {tick:1,target:'monster',actor:'character',action:'status_applied',status:'bleed',durationTicks:5},
], 'monster', 1);
assert.equal(projected.has('bleed'),true,'character can apply a status owned by the monster target');
console.log('status-timeline-projection: passed boundary, stack-duration, order, target, DoT, refresh, expiry, and untimed-effect cases');
