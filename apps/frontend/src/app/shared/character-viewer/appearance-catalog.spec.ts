import { isWebglAvailable } from './appearance-catalog';

describe('isWebglAvailable', () => {
  it('probes WebGL once per page (each probe would hold a context: browsers cap them)', () => {
    isWebglAvailable();
    const create = spyOn(document, 'createElement').and.callThrough();
    const first = isWebglAvailable();
    const second = isWebglAvailable();
    expect(second).toBe(first);
    expect(create.calls.allArgs().filter(([tag]) => tag === 'canvas').length).toBe(0);
  });
});
