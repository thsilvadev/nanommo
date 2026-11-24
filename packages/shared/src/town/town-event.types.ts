/** Smashing Spree (pt-BR: Quebra-Quebra) town event: public shapes shared by API and client. */

/** One vase as every client sees it. Prize data never travels in this shape. */
export interface TownEventVase { id: string; x: number; z: number; rot: number; variant: number }

/** Live event state of one town (only unbroken vases). */
export interface TownEventSnapshot { eventKey: string; mapId: string; endsAt: number; vases: TownEventVase[] }

export interface TownEventVaseBroken { mapId: string; eventKey: string; vaseId: string; byCharacterId: string; at: number; prize: boolean }

export type TownEventEndReason = 'timeout' | 'all-prizes-found';
