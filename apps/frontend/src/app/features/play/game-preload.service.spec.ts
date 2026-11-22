import { GamePreloadService } from './game-preload.service';

describe('GamePreloadService', () => {
  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  it('stays loading while the preload runs, reports progress, and enters the game when it ends', async () => {
    const service = new GamePreloadService();
    let report!: (done: number, total: number) => void;
    let finish!: () => void;
    service.start((onProgress) => { report = onProgress!; return new Promise<void>((resolve) => { finish = resolve; }); });
    expect(service.ready()).toBeFalse();
    report(3, 12);
    expect(service.progress()).toBeCloseTo(0.25, 5);
    finish();
    await Promise.resolve(); await Promise.resolve();
    expect(service.ready()).toBeTrue();
    expect(service.progress()).toBe(1);
  });

  it('gives up after 20 s and enters the game anyway (slow or offline CDN)', () => {
    const service = new GamePreloadService();
    service.start(() => new Promise<void>(() => undefined));
    jasmine.clock().tick(19_999);
    expect(service.ready()).toBeFalse();
    jasmine.clock().tick(1);
    expect(service.ready()).toBeTrue();
  });

  it('enters the game when the preload fails, and when there is nothing to preload', async () => {
    const failing = new GamePreloadService();
    failing.start(() => Promise.reject(new Error('404')));
    await Promise.resolve(); await Promise.resolve();
    expect(failing.ready()).toBeTrue();
    const none = new GamePreloadService();
    none.start(undefined);
    expect(none.ready()).toBeTrue();
  });
});
