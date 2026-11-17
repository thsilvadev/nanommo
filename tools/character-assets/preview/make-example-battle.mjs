#!/usr/bin/env node
/**
 * Writes preview/example-battle.json: a battle queue entry simulated by the real
 * engine (packages/shared must be built). The character alternates basic attacks
 * and Fire Ball (a 3 s cast) against a monster that hits back until the
 * character dies, so one log holds every pose: walk before the start, combat
 * guard, attack, cast, damage and death.
 *
 *   node preview/make-example-battle.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const { BattleEngine } = require(path.join(repo, 'packages/shared/dist/battle-engine'));
const read = (file) => JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'));

const tree = read('skill_trees.json');
const skills = Object.fromEntries([...Object.values(tree.trees).flat(), ...(tree.legacySkills ?? [])].map((s) => [s.id, s]));
const statusEffectDefs = Object.fromEntries(read('status_effects.json').statusEffects.map((s) => [s.id, s]));
// Longer cooldown than the catalogue's, so basic attacks happen between casts.
const fireBall = { ...skills.fire_ball, cooldownTicks: 20, effect: { ...skills.fire_ball.effect }, masteryRank: 1 };

const character = {
  characterName: 'Preview', level: 5, hp: 260, maxHp: 260, sp: 400, maxSp: 400, atk: 12, matk: 18, def: 2, mdefPercent: 0,
  accuracy: 100, evasion: 0, critChance: 0, agi: 5, dex: 5, attackSpeed: 100, hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0,
  combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0, statusEffects: [],
  skills: { fire_ball: fireBall }, skillDefs: { fire_ball: fireBall }, masteryEquipment: [],
};
const monster = {
  id: 'preview_brute', name: 'Brute', level: 5, hp: 100000, atk: 30, matk: 0, def: 0, mdefPercent: 0, accuracy: 100, evasion: 0,
  critChance: 0, atkSpeedTicks: 5, moveSpd: 40, combatStyle: 'melee', basicAttackDamageType: 'melee', basicAttackRange: 0,
  gambit: { lines: [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } }] },
};
const gambit = { lines: [
  { priority: 1, conditions: [{ id: 'always' }], action: { id: 'use_skill', params: { skillId: 'fire_ball' } } },
  { priority: 2, conditions: [{ id: 'always' }], action: { id: 'attack' } },
] };

const result = BattleEngine.simulateBattle(character, monster, gambit, 'portrait-preview', { statusEffectDefs, itemDefinitions: {} });
const events = result.log.events;
const tickDurationMs = 500;
const lastTick = Math.max(...events.map((e) => Number(e.tick ?? 0)));
const startAt = '2026-01-01T00:00:00.000Z';
const entry = {
  startAt,
  endAt: new Date(Date.parse(startAt) + (lastTick + 1) * tickDurationMs).toISOString(),
  tickDurationMs,
  outcome: events.some((e) => Number(e.hpRemaining?.character) <= 0) ? 'loss' : 'win',
  log: { events },
};
fs.writeFileSync(path.join(here, 'example-battle.json'), JSON.stringify(entry, null, 1) + '\n');

const mine = events.filter((e) => e.actor === 'character' && ['attack', 'use_skill'].includes(e.action));
console.log(`${events.length} events, ${lastTick + 1} ticks, outcome ${entry.outcome}`);
console.log('character actions:', mine.map((e) => `${e.action}@${e.castStartedAtTick ?? ''}${e.castStartedAtTick !== undefined ? '..' : ''}${e.tick}`).join(' '));
console.log('hits taken at ticks:', events.filter((e) => e.target === 'character' && e.actor !== 'character' && e.damage > 0).map((e) => e.tick).join(' '));
