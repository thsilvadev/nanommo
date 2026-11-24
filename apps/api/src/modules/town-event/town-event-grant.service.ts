import { Injectable } from '@nestjs/common';
import type { TownEventPrize } from './smashing-spree.types';

export type PrizeDelivery = 'bag' | 'mail' | 'pending';

/** Delivers a Smashing Spree prize exactly once per vase (implemented in the next task). */
@Injectable()
export class TownEventGrantService {
  async grant(_characterId: string, _eventKey: string, _mapId: string, _vaseId: string, _prize: TownEventPrize): Promise<PrizeDelivery> {
    throw new Error('TownEventGrantService.grant is not implemented');
  }
}
