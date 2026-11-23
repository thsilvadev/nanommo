import { monsterManifestKey } from './monster-viewer.component';

describe('monsterManifestKey', () => {
  it('maps battle monster ids (mon_<name>) to manifest keys', () => {
    expect(monsterManifestKey('mon_slime')).toBe('slime');
    expect(monsterManifestKey('mon_mirageStalker')).toBe('mirageStalker');
    expect(monsterManifestKey('slime')).toBe('slime');
  });
});
