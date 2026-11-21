/**
 * World map art: apps/frontend/assets/maps/map-background.png (the source,
 * 2295×1989, ~9 MB, no longer requested by the app) -> map-background.webp next
 * to it (~1 MB). project/map-background.png is an older version of the art. The map view keeps this
 * image on screen, so its size is download and decode time on every visit.
 *
 *   cd tools/character-assets && node build-map-art.mjs
 *
 * After regenerating, bump MAP_ART_VERSION in apps/frontend/src/app/features/play/map-art.ts
 * (/assets/maps is cached by browsers for days, see vercel.json).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(ROOT, 'apps/frontend/assets/maps/map-background.png');
const target = path.join(ROOT, 'apps/frontend/assets/maps/map-background.webp');

const info = await sharp(source).webp({ quality: 90, effort: 6, smartSubsample: true }).toFile(target);
console.log(`map-background.webp ${info.width}x${info.height} ${(info.size / 1e6).toFixed(2)} MB`);
