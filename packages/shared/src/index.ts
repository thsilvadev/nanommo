export * from './enums';
export * from './types';
export * from './dto';
export * from './battle-engine';
export const TOWN_MAP_ID = 'map_town' as const;
export type PendingMapTransitionReason = 'town_request';
export interface PendingMapTransition { destinationMapId: typeof TOWN_MAP_ID; reason: PendingMapTransitionReason; }
