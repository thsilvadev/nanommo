import * as THREE from 'three';
import { applyAnimationState, STUN_HOLD_SECONDS, type AnimatedBody } from './apply-animation-state';
import { CLIP_SECONDS, type AnimationState } from './animation-state';

const LENGTHS: Record<string, number> = {
  Idle: 2.5, Walk: 1.333, CombatIdle: 1.667, Sprint: 0.667,
  Attack: CLIP_SECONDS.Attack, Dead: CLIP_SECONDS.Dead, Gather: 5.2, CastStart: 0.533, CastLoop: 2.1,
  Damage: CLIP_SECONDS.Damage, Damage2: CLIP_SECONDS.Damage2,
};
const LOOPS = ['Idle', 'Walk', 'CombatIdle', 'Sprint'];

/** A one-bone skeleton with one rotation track per clip, built like body-asset.ts builds its actions. */
function makeBody(names = Object.keys(LENGTHS)): AnimatedBody {
  const root = new THREE.Object3D();
  const bone = new THREE.Bone();
  bone.name = 'pelvis';
  root.add(bone);
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const name of names) {
    const d = LENGTHS[name];
    const clip = new THREE.AnimationClip(name, d, [new THREE.QuaternionKeyframeTrack('pelvis.quaternion', [0, d], [0, 0, 0, 1, 0, 0, 0.7071, 0.7071])]);
    const action = mixer.clipAction(clip);
    if (!LOOPS.includes(name)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    action.timeScale = 0;
    action.setEffectiveWeight(name === 'Idle' ? 1 : 0);
    action.play();
    actions.set(name, action);
  }
  return { actions, mixer, weights: new Map(names.map((n) => [n, n === 'Idle' ? 1 : 0])), animatedAtMs: null };
}
const weight = (body: AnimatedBody, name: string) => body.actions.get(name)!.getEffectiveWeight();
const time = (body: AnimatedBody, name: string) => body.actions.get(name)!.time;
const sum = (body: AnimatedBody) => [...body.actions.values()].reduce((s, a) => s + a.getEffectiveWeight(), 0);

describe('applyAnimationState', () => {
  it('base Walk alone has weight 1 on the first frame', () => {
    const body = makeBody();
    applyAnimationState(body, { base: 'Walk' }, 10_000);
    expect(weight(body, 'Walk')).toBeCloseTo(1, 6);
    expect(weight(body, 'Idle')).toBe(0);
  });

  it('base Sprint is a loop like Walk', () => {
    const body = makeBody();
    applyAnimationState(body, { base: 'Sprint' }, 10_000);
    expect(weight(body, 'Sprint')).toBeCloseTo(1, 6);
  });

  it('oneShot Attack at its middle plays the middle of the clip', () => {
    const body = makeBody();
    const start = 10_000;
    const now = start + (CLIP_SECONDS.Attack / 2) * 1000;
    applyAnimationState(body, { base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: start, speed: 1 } }, now);
    expect(weight(body, 'Attack')).toBeCloseTo(1, 6);
    expect(time(body, 'Attack')).toBeCloseTo(CLIP_SECONDS.Attack / 2, 3);
  });

  it('oneShot Gather plays the kneel clip', () => {
    const body = makeBody();
    applyAnimationState(body, { base: 'Walk', oneShot: { clip: 'Gather', startedAtMs: 10_000, speed: 2 } }, 11_000);
    expect(weight(body, 'Gather')).toBeCloseTo(1, 6);
    expect(time(body, 'Gather')).toBeCloseTo(2, 3);
  });

  it('weights sum to 1 during a hit', () => {
    const body = makeBody();
    applyAnimationState(body, { base: 'CombatIdle', hit: { clip: 'Damage', startedAtMs: 10_000 } }, 10_100);
    expect(weight(body, 'Damage')).toBeGreaterThan(0);
    expect(sum(body)).toBeCloseTo(1, 6);
  });

  it('freezeAtMs holds every clip time', () => {
    const body = makeBody();
    const state: AnimationState = { base: 'CombatIdle', oneShot: { clip: 'Attack', startedAtMs: 10_000, speed: 1 }, freezeAtMs: 10_300 };
    applyAnimationState(body, state, 10_300);
    const at = { idle: time(body, 'CombatIdle'), attack: time(body, 'Attack') };
    applyAnimationState(body, state, 12_300);
    expect(time(body, 'CombatIdle')).toBeCloseTo(at.idle, 6);
    expect(time(body, 'Attack')).toBeCloseTo(at.attack, 6);
  });

  it('Stun holds its pose on the Damage2 action', () => {
    const body = makeBody();
    const state: AnimationState = { base: 'CombatIdle', oneShot: { clip: 'Stun', startedAtMs: 10_000, speed: 1 } };
    applyAnimationState(body, state, 10_100);
    expect(time(body, 'Damage2')).toBeCloseTo(STUN_HOLD_SECONDS, 6);
    applyAnimationState(body, state, 15_000);
    expect(time(body, 'Damage2')).toBeCloseTo(STUN_HOLD_SECONDS, 6);
    expect(weight(body, 'Damage2')).toBeCloseTo(1, 6);
  });

  it('a body without the arena clips falls back instead of throwing', () => {
    const body = makeBody(['Idle', 'Walk', 'CombatIdle', 'Attack', 'Dead', 'CastStart', 'CastLoop', 'Damage', 'Damage2']);
    expect(() => applyAnimationState(body, { base: 'Sprint', oneShot: { clip: 'Gather', startedAtMs: 0, speed: 1 } }, 100)).not.toThrow();
    expect(weight(body, 'Walk')).toBeCloseTo(1, 6);
  });
});
