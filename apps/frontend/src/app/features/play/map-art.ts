/**
 * World map art. /assets/maps is cached by browsers for a day plus a week of
 * stale-while-revalidate (vercel.json): bump the version whenever the image is
 * rebuilt (tools/character-assets/build-map-art.mjs), or players keep the old one.
 */
export const MAP_ART_VERSION = 1;
export const MAP_ART_URL = `/assets/maps/map-background.webp?v=${MAP_ART_VERSION}`;
