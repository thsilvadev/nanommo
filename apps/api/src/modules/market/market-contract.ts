import { BadRequestException } from '@nestjs/common';
import { MAX_MARKET_ORDER_GOLD } from '@nanommo/shared';

export function marketGrossValue(quantity: number, pricePerUnit: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new BadRequestException('Quantity must be a positive safe integer');
  if (!Number.isSafeInteger(pricePerUnit) || pricePerUnit < 1) throw new BadRequestException('Unit price must be a positive safe integer');
  const gross = quantity * pricePerUnit;
  if (!Number.isSafeInteger(gross) || gross > MAX_MARKET_ORDER_GOLD) {
    throw new BadRequestException('Market listing/purchase value exceeds ' + MAX_MARKET_ORDER_GOLD + ' gold');
  }
  return gross;
}

export function marketListingFee(gross: number): number {
  if (!Number.isSafeInteger(gross) || gross < 1 || gross > MAX_MARKET_ORDER_GOLD) {
    throw new BadRequestException('Invalid gross Market listing value');
  }
  return Math.max(1, Math.ceil(gross * 0.01));
}

export function validateAttachedGold(gold: number): number {
  if (!Number.isSafeInteger(gold) || gold < 0 || gold > MAX_MARKET_ORDER_GOLD) {
    throw new BadRequestException('Attached gold must be an integer between 0 and ' + MAX_MARKET_ORDER_GOLD);
  }
  return gold;
}
