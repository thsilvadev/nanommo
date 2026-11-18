import * as THREE from 'three';
import type { TownSceneDef } from '@nanommo/shared';

export const TOWN_CAMERA_FOV = 30;
export const TOWN_CAMERA_PITCH_DEG = 55;
export const TOWN_CAMERA_YAW_DEG = 45;
export const TOWN_CAMERA_MIN_DISTANCE = 18;
export const TOWN_CAMERA_MAX_DISTANCE = 70;

const PITCH = (TOWN_CAMERA_PITCH_DEG * Math.PI) / 180;
const YAW = (TOWN_CAMERA_YAW_DEG * Math.PI) / 180;
/** Unit vector from the target to the camera (fixed: pitch and yaw never change, so the sky never shows). */
const BACK = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH));
/** Screen-right and screen-up projected on the ground. */
const GROUND_RIGHT = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
const GROUND_FORWARD = new THREE.Vector3(-Math.sin(YAW), 0, -Math.cos(YAW));
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Fixed-angle town camera (MU-like): perspective with a low FOV, pitch 55°
 * down and yaw 45°. Only the target (clamped to the town rectangle) and the
 * distance (clamped to [18, 70]) change.
 */
export class TownCamera {
  readonly camera = new THREE.PerspectiveCamera(TOWN_CAMERA_FOV, 1, 0.5, 400);
  readonly target = new THREE.Vector3();
  private _distance = 40;
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

  get distance(): number { return this._distance; }

  resize(viewW: number, viewH: number): void {
    this.viewW = Math.max(1, viewW);
    this.viewH = Math.max(1, viewH);
    this.camera.aspect = this.viewW / this.viewH;
    this.update();
  }

  centerOn(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.update();
  }

  /** Drag by (dx, dy) screen pixels: the ground follows the pointer. */
  pan(dxPx: number, dyPx: number): void {
    const perPx = (2 * this._distance * Math.tan((TOWN_CAMERA_FOV * Math.PI) / 360)) / this.viewH;
    this.target.addScaledVector(GROUND_RIGHT, -dxPx * perPx);
    // Ground distance per vertical pixel is stretched by the pitch.
    this.target.addScaledVector(GROUND_FORWARD, (dyPx * perPx) / Math.sin(PITCH));
    this.update();
  }

  /** Multiply the distance by `factor` (<1 zooms in); with `atPx`, the ground point under it stays put. */
  zoomBy(factor: number, atPx?: [number, number]): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const before = atPx ? this.groundAt(atPx[0], atPx[1]) : null;
    this._distance = THREE.MathUtils.clamp(this._distance * factor, TOWN_CAMERA_MIN_DISTANCE, TOWN_CAMERA_MAX_DISTANCE);
    this.update();
    if (before && atPx) {
      const after = this.groundAt(atPx[0], atPx[1]);
      if (after) {
        this.target.add(before.sub(after));
        this.update();
      }
    }
  }

  /** Ground (y = 0) point under a pixel of the view, or null. */
  groundAt(px: number, py: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2((px / this.viewW) * 2 - 1, -(py / this.viewH) * 2 + 1), this.camera);
    return this.raycaster.ray.intersectPlane(GROUND, new THREE.Vector3());
  }

  private update(): void {
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.def.size.w);
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, this.def.size.h);
    this.target.y = 0;
    this.camera.position.copy(this.target).addScaledVector(BACK, this._distance);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }
}
