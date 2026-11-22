import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterAssetCache } from './character-asset-cache';
import { boneRegion, visibleBodyGeometry } from './gear-regions';
import type { BodyAsset } from './body-asset';

describe('gear regions', () => {
  let body: BodyAsset;
  beforeAll(async () => {
    const loader = new GLTFLoader();
    body = await new CharacterAssetCache((url) => loader.loadAsync(url), '/assets/character/').body('male');
  });

  const dominantNames = (geometry: THREE.BufferGeometry) => {
    const J = geometry.getAttribute('skinIndex'), W = geometry.getAttribute('skinWeight');
    return (v: number) => { let b = 0; for (let k = 1; k < 4; k++) if (W.getComponent(v, k) > W.getComponent(v, b)) b = k; return body.body.skeleton.bones[J.getComponent(v, b)].name; };
  };
  const trianglesWhere = (geometry: THREE.BufferGeometry, pred: (names: string[]) => boolean) => {
    const idx = geometry.getIndex()!, dom = dominantNames(body.body.geometry);
    let n = 0;
    for (let i = 0; i < idx.count; i += 3) if (pred([idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)].map(dom))) n++;
    return n;
  };

  it('maps bones to body regions like the gear pipeline', () => {
    expect(boneRegion('middle_02_l')).toBe('hands');
    expect(boneRegion('ball_leaf_r')).toBe('feet');
    expect(boneRegion('clavicle_r')).toBe('torso');
    expect(boneRegion('neck_01')).toBe('neck');
    expect(boneRegion('lowerarm_l')).toBe('forearms');
  });

  it('hides covered regions, never the head', () => {
    const original = body.body.geometry;
    const visible = visibleBodyGeometry('male', body.body, new Set(['torso', 'thighs']), []);
    const spine = (g: THREE.BufferGeometry) => trianglesWhere(g, (n) => n.every((x) => x === 'spine_02'));
    expect(spine(visible)).toBeLessThan(spine(original) * 0.1);
    expect(trianglesWhere(visible, (n) => n.every((x) => x === 'Head'))).toBe(trianglesWhere(original, (n) => n.every((x) => x === 'Head')));
    expect(visible.getAttribute('position')).toBe(original.getAttribute('position')); // deformation still applies
  });

  it('caches per (sex, covered, bands) and returns the original geometry when nothing is hidden', () => {
    const a = visibleBodyGeometry('male', body.body, new Set(['feet']), []);
    expect(visibleBodyGeometry('male', body.body, new Set(['feet']), [])).toBe(a);
    expect(visibleBodyGeometry('male', body.body, new Set(), [])).toBe(body.body.geometry);
  });

  it('a calves band hides the calf skin inside it, knee triangles mixing thigh and calf included', () => {
    const band = { region: 'calves' as const, minY: 0.23, maxY: 0.57 };
    const visible = visibleBodyGeometry('male', body.body, new Set(['thighs']), [band]);
    const P = body.body.geometry.getAttribute('position');
    const idx = visible.getIndex()!, dom = dominantNames(body.body.geometry);
    for (let i = 0; i < idx.count; i += 3) {
      const t = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      const inBand = t.every((v) => ['calf_l', 'calf_r', 'thigh_l', 'thigh_r'].includes(dom(v)) && P.getY(v) > band.minY && P.getY(v) < band.maxY);
      expect(inBand).toBeFalse();
    }
  });
});
