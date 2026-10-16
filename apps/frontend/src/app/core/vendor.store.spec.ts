import { sellModalMaxQuantity } from './vendor.store';

describe('Vendor sell modal stack-scoped quantity', () => {
  it('limits All to the dragged stack instead of aggregating matching stacks', () => {
    // 80 potions are owned across four stacks of 20; only one row was dragged.
    expect(sellModalMaxQuantity(80, 20, true)).toBe(20);
  });

  it('caps the dragged quantity by the current owned total', () => {
    expect(sellModalMaxQuantity(12, 20, true)).toBe(12);
  });

  it('keeps non-stackable items limited to one', () => {
    expect(sellModalMaxQuantity(8, 8, false)).toBe(1);
  });

  it('preserves aggregate maximum when no selected stack quantity is supplied', () => {
    expect(sellModalMaxQuantity(80, undefined, true)).toBe(80);
  });
});
