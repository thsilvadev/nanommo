import { CharacterSummary } from './components';

describe('CharacterSummary paper-doll layout', () => {
  const createSummary = (dominantHand: 'left' | 'right'): CharacterSummary => {
    const summary = Object.create(CharacterSummary.prototype) as CharacterSummary;
    Object.defineProperty(summary, 'character', {
      value: { character: () => ({ dominantHand }) },
    });
    summary.slots = [
      { key: 'head', label: 'Head', icon: '' },
      { key: 'body', label: 'Body', icon: '' },
      { key: 'mainHand', label: 'Main Hand', icon: '' },
      { key: 'offHand', label: 'Off Hand', icon: '' },
      { key: 'shoes', label: 'Shoes', icon: '' },
      { key: 'cape', label: 'Cape', icon: '' },
      { key: 'accessoryLeft', label: 'Ring', icon: '' },
      { key: 'accessoryRight', label: 'Ring', icon: '' },
    ];
    return summary;
  };

  it('places the main hand in the physical right-hand position for right-handed characters', () => {
    const summary = createSummary('right');

    expect(summary.leftEquipmentSlots.map(slot => slot.key))
      .toEqual(['head', 'mainHand', 'cape', 'accessoryLeft']);
    expect(summary.rightEquipmentSlots.map(slot => slot.key))
      .toEqual(['body', 'offHand', 'shoes', 'accessoryRight']);
    expect(summary.isMirroredHandSlot('mainHand')).toBeFalse();
    expect(summary.isMirroredHandSlot('offHand')).toBeTrue();
    expect(summary.isMirroredHandSlot('head')).toBeFalse();
    expect(summary.isMirroredHandSlot('body')).toBeFalse();
    expect(summary.isMirroredHandSlot('shoes')).toBeFalse();
    expect(summary.isMirroredHandSlot('cape')).toBeFalse();
  });

  it('places the main hand in the physical left-hand position for left-handed characters', () => {
    const summary = createSummary('left');

    expect(summary.leftEquipmentSlots.map(slot => slot.key))
      .toEqual(['head', 'offHand', 'cape', 'accessoryLeft']);
    expect(summary.rightEquipmentSlots.map(slot => slot.key))
      .toEqual(['body', 'mainHand', 'shoes', 'accessoryRight']);
    expect(summary.isMirroredHandSlot('mainHand')).toBeTrue();
    expect(summary.isMirroredHandSlot('offHand')).toBeFalse();
  });
});
