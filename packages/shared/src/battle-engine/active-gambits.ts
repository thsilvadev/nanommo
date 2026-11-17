import type { GroupGambitPage, GroupGambitLine } from '../types/group-battle';

/** Disabled lines remain persisted for the editor but must never execute. */
export function activeGambitLines(page: GroupGambitPage): GroupGambitLine[] {
  const lines = Array.isArray(page) ? page : page?.lines ?? [];
  return lines.filter(line => (line as GroupGambitLine & { enabled?: boolean; disabled?: boolean }).enabled !== false && (line as GroupGambitLine & { disabled?: boolean }).disabled !== true);
}
