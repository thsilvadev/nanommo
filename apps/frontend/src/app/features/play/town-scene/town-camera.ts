import * as THREE from 'three';
import type { TownSceneDef } from '@nanommo/shared';

export const TOWN_CAMERA_FOV = 30;
export const TOWN_CAMERA_PITCH_DEG = 55;
export const TOWN_CAMERA_YAW_DEG = 45;
export const TOWN_CAMERA_MIN_DISTANCE = 18;
export const TOWN_CAMERA_MAX_DISTANCE = 70;

/**
 * Close-up ("lateral") levels past the closest top-down zoom, nearest first:
 * the camera drops near the ground and looks at the characters from the front.
 * `width` is how much of the town fits across the view (about 5, 9 and 15
 * characters side by side), `pitch` how far it still looks down, `lift` the
 * height it looks at (chest height, so standing characters fill the frame).
 */
export const TOWN_CAMERA_CLOSE_LEVELS: readonly { width: number; pitchDeg: number; lift: number }[] = [
  { width: 6, pitchDeg: 5, lift: 1.05 },
  { width: 10.5, pitchDeg: 8, lift: 1 },
  { width: 17, pitchDeg: 12, lift: 0.9 },
];
/** At least this much height (a character plus its name plate) stays in view, however narrow the screen. */
const CLOSE_MIN_VIEW_HEIGHT = 3;
/** Accumulated log-zoom (a mouse notch is ~0.15) that moves one close-up level. */
const LEVEL_STEP = 0.1;
/** After a level change, further wheel input is ignored this long (a trackpad fling moves one level, not all). */
const LEVEL_COOLDOWN_MS = 280;
/** Time constant of the glide towards the goal pose. */
const GLIDE_MS = 110;

const PITCH = (TOWN_CAMERA_PITCH_DEG * Math.PI) / 180;
const YAW = (TOWN_CAMERA_YAW_DEG * Math.PI) / 180;
const VFOV = (TOWN_CAMERA_FOV * Math.PI) / 180;
/** Screen-right and screen-up projected on the ground. */
const GROUND_RIGHT = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
const GROUND_FORWARD = new THREE.Vector3(-Math.sin(YAW), 0, -Math.cos(YAW));
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

interface Pose { distance: number; pitch: number; lift: number }

/** Unit vector from the target towards the camera for a pitch (yaw is fixed). */
function back(pitch: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(YAW) * Math.cos(pitch), Math.sin(pitch), Math.cos(YAW) * Math.cos(pitch));
}

/**
 * Town camera (MU-like): perspective with a low FOV and a fixed 45° yaw.
 * Top-down it looks 55° down from [18, 70] away; zooming in past 18 it glides
 * down to three close-up levels near the ground (TOWN_CAMERA_CLOSE_LEVELS),
 * one per wheel notch. Every change glides: call `step(dt)` each frame.
 */
export class TownCamera {
  readonly camera = new THREE.PerspectiveCamera(TOWN_CAMERA_FOV, 1, 0.3, 400);
  readonly target = new THREE.Vector3();
  /** null: top-down; 0..2: close-up level (0 nearest). */
  private _level: number | null = null;
  private goalDistance = 40;
  private readonly pose: Pose = { distance: 40, pitch: PITCH, lift: 0 };
  /** Zoom at the cursor: this ground point stays under this pixel while the zoom glides. */
  private anchor: { px: [number, number]; ground: THREE.Vector3 } | null = null;
  /** Entering the close-up: the target glides to the ground point that was under the cursor. */
  private glideTo: THREE.Vector3 | null = null;
  private pull = 0;
  private cooldownUntil = -Infinity;
  private viewW: number;
  private viewH: number;
  private readonly raycaster = new THREE.Raycaster();

  constructor(viewW: number, viewH: number, private readonly def: Pick<TownSceneDef, 'size'>) {
    this.viewW = Math.max(1, viewW);
    this.viewH = Math.max(1, viewH);
    this.camera.aspect = this.viewW / this.viewH;
    this.target.set(def.size.w / 2, 0, def.size.h / 2);
    this.update();
  }

  /** Top-down distance the zoom is heading to (the closest, 18, while in a close-up). */
  get distance(): number { return this.goalDistance; }
  /** Current (gliding) distance from the camera to the point it looks at. */
  get viewDistance(): number { return this.pose.distance; }
  /** Current (gliding) pitch in degrees: 55 top-down, near 0 in the close-up. */
  get pitchDeg(): number { return (this.pose.pitch * 180) / Math.PI; }
  /** null top-down, else the close-up level (0 = nearest). */
  get level(): number | null { return this._level; }
  /** Whether the camera is still gliding towards its goal. */
  get moving(): boolean {
    const goal = this.goal();
    return Math.abs(goal.distance - this.pose.distance) > 1e-3 || Math.abs(goal.pitch - this.pose.pitch) > 1e-5
      || Math.abs(goal.lift - this.pose.lift) > 1e-4 || this.glideTo !== null;
  }

  resize(viewW: number, viewH: number): void {
    this.viewW = Math.max(1, viewW);
    this.viewH = Math.max(1, viewH);
    this.camera.aspect = this.viewW / this.viewH;
    this.update();
  }

  centerOn(x: number, z: number): void {
    this.anchor = this.glideTo = null;
    this.target.set(x, 0, z);
    this.update();
  }

  /** Drag by (dx, dy) screen pixels: the ground follows the pointer. */
  pan(dxPx: number, dyPx: number): void {
    this.anchor = this.glideTo = null;
    const perPx = (2 * this.pose.distance * Math.tan(VFOV / 2)) / this.viewH;
    this.target.addScaledVector(GROUND_RIGHT, -dxPx * perPx);
    // Ground distance per vertical pixel is stretched by the pitch (capped near the ground, where it would explode).
    this.target.addScaledVector(GROUND_FORWARD, (dyPx * perPx) / Math.sin(Math.max(this.pose.pitch, PITCH)));
    this.update();
  }

  /**
   * Zoom by `factor` (<1 zooms in). Top-down it multiplies the distance, the
   * ground point under `atPx` staying put; past the closest distance (and in
   * the close-up) the input accumulates and moves one level at a time.
   */
  zoomBy(factor: number, atPx?: [number, number], nowMs = performance.now()): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const log = Math.log(factor);
    if (this._level === null) {
      if (log < 0 && this.goalDistance <= TOWN_CAMERA_MIN_DISTANCE + 1e-6) {
        if (!this.accumulate(log, nowMs)) return;
        const ground = atPx ? this.groundAt(atPx[0], atPx[1]) : null;
        this.anchor = null;
        this.glideTo = ground ? this.clamped(ground) : null;
        this._level = TOWN_CAMERA_CLOSE_LEVELS.length - 1;
        return;
      }
      this.pull = 0;
      this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * factor, TOWN_CAMERA_MIN_DISTANCE, TOWN_CAMERA_MAX_DISTANCE);
      const ground = atPx && !this.glideTo ? this.groundAt(atPx[0], atPx[1]) : null;
      this.anchor = ground && atPx ? { px: atPx, ground } : null;
      return;
    }
    if (!this.accumulate(log, nowMs)) return;
    const next = this._level + Math.sign(log);
    if (next < 0) return;
    this._level = next >= TOWN_CAMERA_CLOSE_LEVELS.length ? null : next;
    if (this._level === null) this.goalDistance = TOWN_CAMERA_MIN_DISTANCE;
  }

  /** Glide towards the goal pose; `dtMs` = Infinity jumps there. */
  step(dtMs: number): void {
    if (!this.moving) return;
    const k = Number.isFinite(dtMs) ? 1 - Math.exp(-Math.max(0, dtMs) / GLIDE_MS) : 1;
    const goal = this.goal();
    const pose = this.pose;
    pose.distance += (goal.distance - pose.distance) * k;
    pose.pitch += (goal.pitch - pose.pitch) * k;
    pose.lift += (goal.lift - pose.lift) * k;
    if (this.glideTo) {
      this.target.lerp(this.glideTo, k);
      if (this.target.distanceTo(this.glideTo) < 1e-3 || k === 1) { this.target.copy(this.glideTo); this.glideTo = null; }
    }
    if (!this.moving) Object.assign(pose, goal);
    this.update();
    if (this.anchor) {
      const after = this.groundAt(this.anchor.px[0], this.anchor.px[1]);
      if (after) {
        this.target.add(this.anchor.ground.clone().sub(after));
        this.update();
      }
      if (!this.moving) this.anchor = null;
    }
  }

  /** Ground (y = 0) point under a pixel of the view, or null. */
  groundAt(px: number, py: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2((px / this.viewW) * 2 - 1, -(py / this.viewH) * 2 + 1), this.camera);
    return this.raycaster.ray.intersectPlane(GROUND, new THREE.Vector3());
  }

  /** Adds to the level pull; true (and reset) once it reaches a full step outside the cooldown. */
  private accumulate(log: number, nowMs: number): boolean {
    if (nowMs < this.cooldownUntil) { this.pull = 0; return false; }
    if (Math.sign(log) !== Math.sign(this.pull)) this.pull = 0;
    this.pull += log;
    if (Math.abs(this.pull) < LEVEL_STEP) return false;
    this.pull = 0;
    this.cooldownUntil = nowMs + LEVEL_COOLDOWN_MS;
    return true;
  }

  private goal(): Pose {
    if (this._level === null) return { distance: this.goalDistance, pitch: PITCH, lift: 0 };
    const level = TOWN_CAMERA_CLOSE_LEVELS[this._level];
    const hfov = 2 * Math.atan(Math.tan(VFOV / 2) * this.camera.aspect);
    const distance = Math.max(level.width / (2 * Math.tan(hfov / 2)), CLOSE_MIN_VIEW_HEIGHT / (2 * Math.tan(VFOV / 2)));
    return { distance, pitch: (level.pitchDeg * Math.PI) / 180, lift: level.lift };
  }

  private clamped(point: THREE.Vector3): THREE.Vector3 {
    return point.set(THREE.MathUtils.clamp(point.x, 0, this.def.size.w), 0, THREE.MathUtils.clamp(point.z, 0, this.def.size.h));
  }

  private update(): void {
    this.clamped(this.target);
    const look = this.target.clone().setY(this.pose.lift);
    this.camera.position.copy(look).addScaledVector(back(this.pose.pitch), this.pose.distance);
    this.camera.lookAt(look);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }
}
