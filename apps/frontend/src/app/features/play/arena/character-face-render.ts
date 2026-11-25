/**
 * Renders the player's face (bare head: no equipment, so never a helmet) with the portrait rig, off
 * screen, once. No Angular here (the arena preview harness uses it too); three.js is imported on demand.
 */
import type { CharacterAppearance, Sex } from '@nanommo/shared';
import type { ViewerConfig } from '../../../shared/character-viewer/character-viewer.types';

/** What the face needs: the bare look (no equipment, so never a helmet). */
export interface FaceLook { sex: Sex; heightCm: number; appearance: CharacterAppearance; dominantHand: 'right' | 'left' }
export interface FaceRenderEnv {
  webglAvailable: () => boolean;
  /** Renders the face and returns a PNG data URL. */
  render: (look: FaceLook) => Promise<string>;
}

const FACE_PX = 128;
const ASSET_BASE = '/assets/character/';

/** Default: the portrait rig, off screen, once (three.js is already loaded by the loading screen). */
export async function renderFace(look: FaceLook, catalogUrl?: string): Promise<string> {
  const [{ CharacterRig }, { GLTFLoader }, { CharacterAssetCache }, { loadAppearanceCatalog }] = await Promise.all([
    import('../../../shared/character-viewer/character-rig'),
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('../../../shared/character-viewer/character-asset-cache'),
    import('../../../shared/character-viewer/appearance-catalog'),
  ]);
  const loader = new GLTFLoader();
  let rig: Awaited<ReturnType<typeof CharacterRig.create>> | null = null;
  const host = document.createElement('div');
  try {
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${FACE_PX}px;height:${FACE_PX}px;pointer-events:none`;
    document.body.appendChild(host);
    rig = await CharacterRig.create(host, {
      assetBase: ASSET_BASE, catalog: () => loadAppearanceCatalog(catalogUrl), load: (url) => loader.loadAsync(url),
      cache: CharacterAssetCache.shared(ASSET_BASE, (url) => loader.loadAsync(url)), onContextLost: () => undefined,
    });
    const config: ViewerConfig = {
      sex: look.sex, heightCm: look.heightCm, appearance: look.appearance, hands: { right: null, left: null },
      dominantHand: look.dominantHand, interactive: false, framing: 'face', equipment: null, refinement: null,
    };
    await rig.apply(config);
    return rig.snapshot(FACE_PX);
  } finally {
    rig?.dispose();
    host.remove();
  }
}

