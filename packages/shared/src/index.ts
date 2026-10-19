export * from './enums';
export * from './types';
export * from './dto';
export * from './attributes';
export * from './battle-engine';
export * from './equipment/hands';
export const TOWN_MAP_ID = 'map_town' as const;
export type PendingMapTransitionReason = 'town_request' | 'map_request';
export interface PendingMapTransition { destinationMapId: string; reason: PendingMapTransitionReason; requestedAt?: string; }
