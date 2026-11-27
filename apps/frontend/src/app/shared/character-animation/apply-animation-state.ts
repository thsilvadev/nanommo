/**
 * AnimationState → clip times and weights on an animation mixer. Renderer-free:
 * the Character Summary rig (one body, its own canvas) and the battle arena
 * (many bodies in one scene) share it, so a pose reads the same in both.
 *
 * Every action plays at time scale 0: this function places each clip by the
 * clock and decides its weight; only the crossfade weights carry over between
 * frames (in `body.weights`), so a pose is a function of the state and time.
 *
 * Only three.js types are imported here.
 */
import type { AnimationAction, AnimationMixer } from 'three';
import type { AnimationState } from './animation-state';

export interface AnimatedBody {
  actions: Map<string, AnimationAction>;
  /** Smoothed (crossfaded) layer weights, before composition. */
  weights: Map<string, number>;
  mixer: AnimationMixer;
  /** Clock of the last applied frame; null snaps the next frame straight to its pose. */
  animatedAtMs: number | null;
}

/** Background loops, phased by the absolute clock. */
const LOOPS = ['Idle', 'Walk', 'CombatIdle', 'Sprint'] as const;
/** Full-body layers that take over from the loop. `Stun` is played on the Damage2 action. */
const OVERLAYS = ['Attack', 'Dead', 'Gather', 'CastStart', 'CastLoop', 'Stun', 'Kneel'] as const;
const HITS = ['Damage', 'Damage2'] as const;
const OVERLAY_ACTION: Record<string, string> = { Stun: 'Damage2', Kneel: 'Gather' };
/** Loops absent from an older animation file fall back to these. */
const LOOP_FALLBACK: Record<string, string> = { Sprint: 'Walk' };

const FADE_IN_SECONDS = 0.12;
const FADE_OUT_SECONDS = 0.2;
/** Peak weight of a flinch: enough to read as a hit, not enough to cut the action under it. */
const HIT_PEAK = 0.4;
/** Stun holds this instant of the Damage2 (Hit_Head) take: the head snapped back. */
export const STUN_HOLD_SECONDS = 0.17;
/** Kneel (teleport) plays the Gather take (Fixing_Kneeling) down to this instant and holds: the pelvis is lowest from ~0.9 s to ~3.7 s. */
export const KNEEL_HOLD_SECONDS = 2.0;

export function applyAnimationState(body: AnimatedBody, state: AnimationState, nowMs: number): void {
  const snap = body.animatedAtMs === null;
  const dt = snap ? 0 : Math.max(0, (nowMs - body.animatedAtMs!) / 1000);
  body.animatedAtMs = nowMs;
  // Frozen: clips stop where they were; weights still settle with real time.
  const t = state.freezeAtMs !== undefined ? Math.min(nowMs, state.freezeAtMs) : nowMs;
  const has = (name: string) => body.actions.has(name);
  const action = (name: string) => body.actions.get(name)!;
  const duration = (name: string) => action(name).getClip().duration;
  const hold = (name: string, seconds: number) => { action(name).time = Math.max(0, Math.min(duration(name), seconds)); };

  const loops = LOOPS.filter(has);
  const base = has(state.base) ? state.base : LOOP_FALLBACK[state.base] ?? 'Idle';
  for (const name of loops) action(name).time = ((t / 1000) % duration(name) + duration(name)) % duration(name);

  let overlay: string | null = null;
  if (state.oneShot) {
    const clip = state.oneShot.clip;
    const target = OVERLAY_ACTION[clip] ?? clip;
    if (has(target)) {
      overlay = clip;
      if (clip === 'Stun') hold(target, STUN_HOLD_SECONDS);
      else if (clip === 'Kneel') hold(target, Math.min(KNEEL_HOLD_SECONDS, Math.max(0, ((t - state.oneShot.startedAtMs) / 1000) * state.oneShot.speed)));
      else hold(target, ((t - state.oneShot.startedAtMs) / 1000) * state.oneShot.speed);
    }
  } else if (state.cast && has('CastStart') && has('CastLoop')) {
    const elapsed = (t - state.cast.startedAtMs) / 1000;
    const enter = duration('CastStart');
    if (elapsed < enter) {
      overlay = 'CastStart';
      hold('CastStart', elapsed);
    } else {
      overlay = 'CastLoop';
      hold('CastLoop', (elapsed - enter) % duration('CastLoop'));
    }
  }
  // Clips that leave the state keep their last time while they fade out.

  const ease = (name: string, target: number) => {
    const from = body.weights.get(name) ?? 0;
    const next = snap ? target : target > from ? Math.min(target, from + dt / FADE_IN_SECONDS) : Math.max(target, from - dt / FADE_OUT_SECONDS);
    body.weights.set(name, next);
    return next;
  };
  const overlays = OVERLAYS.filter((name) => has(OVERLAY_ACTION[name] ?? name));
  const baseWeights = loops.map((name) => ease(name, name === base ? 1 : 0));
  const overlayWeights = overlays.map((name) => ease(name, name === overlay ? 1 : 0));

  // Compose so the weights always sum to one: a deficit would blend in the bind pose.
  const overlaySum = overlayWeights.reduce((a, b) => a + b, 0);
  const overlayScale = overlaySum > 1 ? 1 / overlaySum : 1;
  const overlayTotal = Math.min(1, overlaySum);
  const baseSum = baseWeights.reduce((a, b) => a + b, 0) || 1;
  // While stunned the Damage2 action holds the stun pose, so a flinch uses Damage.
  const stunWeight = overlayWeights[overlays.indexOf('Stun')] ?? 0;
  const hitClip = state.hit ? (stunWeight > 0 && state.hit.clip === 'Damage2' ? 'Damage' : state.hit.clip) : null;
  let hitWeight = 0;
  if (state.hit && hitClip && has(hitClip)) {
    const elapsed = (t - state.hit.startedAtMs) / 1000;
    const length = duration(hitClip);
    if (elapsed >= 0 && elapsed < length) {
      hitWeight = HIT_PEAK * Math.sin((Math.PI * elapsed) / length);
      hold(hitClip, elapsed);
    }
  }
  const rest = 1 - hitWeight;
  loops.forEach((name, i) => action(name).setEffectiveWeight(rest * (1 - overlayTotal) * (baseWeights[i] / baseSum)));
  for (const name of HITS) if (has(name)) action(name).setEffectiveWeight(hitClip === name ? hitWeight : 0);
  overlays.forEach((name, i) => {
    const target = OVERLAY_ACTION[name] ?? name;
    const w = rest * overlayWeights[i] * overlayScale;
    // Stun shares Damage2 with the flinch: its weight adds to whatever the flinch set.
    action(target).setEffectiveWeight(target === name ? w : action(target).getEffectiveWeight() + w);
  });
  body.mixer.update(0);
}
