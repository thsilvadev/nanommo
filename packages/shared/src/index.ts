export * from './enums';
export * from './types';
export * from './dto';
export * from './attributes';
export * from './battle-engine';
export * from './equipment/hands';
export const TOWN_MAP_ID = 'map_town' as const;
export type PendingMapTransitionReason = 'town_request' | 'map_request';
export interface PendingMapTransition { destinationMapId: string; reason: PendingMapTransitionReason; requestedAt?: string; }
export * from './world-activity';

/** Maximum gross value for a Market order/purchase and a single Mail gold attachment. */
export const MAX_MARKET_ORDER_GOLD = 999_999_999 as const;
