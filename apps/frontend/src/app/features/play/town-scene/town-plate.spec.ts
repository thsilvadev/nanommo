import { HEIGHT_CM_MAX } from '@nanommo/shared';
import { PLATE_SPRITE_HEIGHT, townPlateY } from './town-character';

describe('town name plates', () => {
  it('clear the tallest character (plus hair or a helmet) at every zoom', () => {
    const head = HEIGHT_CM_MAX / 100 + 0.08;
    for (let scale = 0.05; scale <= 1.0001; scale += 0.05) {
      expect(townPlateY(scale) - (PLATE_SPRITE_HEIGHT / 2) * scale).withContext(`scale ${scale.toFixed(2)}`).toBeGreaterThan(head);
    }
  });
});
