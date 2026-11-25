/** Appearance catalogue and WebGL detection: plain functions, no Angular (shared by the viewers, the town and the battle arena). */
import type { AppearanceCatalog } from '@nanommo/shared';

let webgl: boolean | null = null;
/** Probed once per page: each probe holds a WebGL context (browsers cap them), so it is freed and cached. */
export function isWebglAvailable(): boolean {
  if (webgl !== null) return webgl;
  try {
    const canvas = document.createElement('canvas');
    const context = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    webgl = !!context;
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

export const DEFAULT_CATALOG_URL = '/data/appearance_catalog.json';
const catalogs = new Map<string, Promise<AppearanceCatalog>>();
/** Appearance catalogue mirror, fetched once and shared by every viewer and the creator. */
export function loadAppearanceCatalog(url = DEFAULT_CATALOG_URL): Promise<AppearanceCatalog> {
  let pending = catalogs.get(url);
  if (!pending) {
    pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error('Unable to load the appearance catalogue');
      return response.json() as Promise<AppearanceCatalog>;
    });
    pending.catch(() => catalogs.delete(url));
    catalogs.set(url, pending);
  }
  return pending;
}

