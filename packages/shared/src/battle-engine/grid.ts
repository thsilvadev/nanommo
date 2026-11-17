import type { GridPosition } from '../types/group-battle';
export const BATTLE_GRID_SIZE = 10;
export const gridKey = (p: GridPosition): string => `${p.row}:${p.column}`;
export const validGridPosition = (p: GridPosition): boolean => Number.isInteger(p?.row) && Number.isInteger(p?.column) && p.row >= 0 && p.column >= 0 && p.row < 10 && p.column < 10;
/** Stable cardinal order is up, left, right, down. */
export function gridNeighbors(p: GridPosition): GridPosition[] {
  return [{row:p.row-1,column:p.column},{row:p.row,column:p.column-1},{row:p.row,column:p.column+1},{row:p.row+1,column:p.column}].filter(validGridPosition);
}
export const gridDistance = (a: GridPosition,b: GridPosition): number => Math.max(Math.abs(a.row-b.row),Math.abs(a.column-b.column));
/** Path excludes its starting square and includes its destination. */
export function findGridPath(from:GridPosition,to:GridPosition,blocked:GridPosition[]):GridPosition[]|null {
  return findGridPathToRange(from,to,blocked,0);
}
export function findGridPathToRange(from:GridPosition,to:GridPosition,blocked:GridPosition[],range=1):GridPosition[]|null {
  if(!validGridPosition(from)||!validGridPosition(to)) return null;
  const occupied=new Set(blocked.map(gridKey)); occupied.delete(gridKey(from));
  const queue:Array<{p:GridPosition;path:GridPosition[]}>= [{p:from,path:[]}]; const seen=new Set([gridKey(from)]);
  for(let i=0;i<queue.length;i++) {
    const {p,path}=queue[i];
    if(gridDistance(p,to)<=range && (!occupied.has(gridKey(p)) || gridKey(p)===gridKey(from))) return path;
    for(const next of gridNeighbors(p)) { const key=gridKey(next); if(seen.has(key)||occupied.has(key)) continue; seen.add(key); queue.push({p:next,path:[...path,next]}); }
  }
  return null;
}
export function nearestFreeGridPosition(origin:GridPosition,blocked:GridPosition[]):GridPosition {
  const occupied=new Set(blocked.map(gridKey)); const queue=[origin];const seen=new Set([gridKey(origin)]);
  for(let i=0;i<queue.length;i++) { const p=queue[i]; if(!occupied.has(gridKey(p))) return {...p};for(const n of gridNeighbors(p)) if(!seen.has(gridKey(n))){seen.add(gridKey(n));queue.push(n);} }
  throw new Error('Battle grid has no free position');
}

/** One breadth-first distance field services all candidate targets for an action. */
export function gridDistanceField(from:GridPosition,blocked:GridPosition[]):Map<string,number> {
  const occupied=new Set(blocked.map(gridKey));occupied.delete(gridKey(from));
  const distances=new Map<string,number>([[gridKey(from),0]]);const queue=[from];
  for(let i=0;i<queue.length;i++)for(const next of gridNeighbors(queue[i])){
    const key=gridKey(next);if(occupied.has(key)||distances.has(key))continue;
    distances.set(key,distances.get(gridKey(queue[i]))!+1);queue.push(next);
  }
  return distances;
}
