import { TestBed } from '@angular/core/testing';
import { GameSocketService } from './game.socket.service';
import { ServerClockService } from './server-clock.service';

describe('ServerClockService', () => {
  const SKEW = 5000;
  const ONE_WAY = 50; // RTT 100 ms

  function setup() {
    const socket = {
      emit: jasmine.createSpy('emit').and.callFake((event: string) => {
        expect(event).toBe('time:sync');
        // The server samples its clock halfway through the round trip.
        return new Promise(resolve => setTimeout(() => {
          const serverNow = Date.now() + SKEW;
          setTimeout(() => resolve({ serverNow }), ONE_WAY);
        }, ONE_WAY));
      }),
    };
    TestBed.configureTestingModule({ providers: [ServerClockService, { provide: GameSocketService, useValue: socket }] });
    return { clock: TestBed.inject(ServerClockService), socket };
  }

  it('estimates the server offset from 5 time:sync samples (RTT/2, median)', async () => {
    const { clock, socket } = setup();
    await clock.sync();
    expect(socket.emit).toHaveBeenCalledTimes(5);
    expect(Math.abs(clock.now() - (Date.now() + SKEW))).toBeLessThanOrEqual(60);
  });

  it('uses a roster serverNow as a first estimate until a sync completes', () => {
    const { clock } = setup();
    clock.seed(Date.now() + SKEW);
    expect(Math.abs(clock.now() - (Date.now() + SKEW))).toBeLessThanOrEqual(60);
  });

  it('keeps the previous offset when the socket fails', async () => {
    const { clock, socket } = setup();
    clock.seed(Date.now() + SKEW);
    socket.emit.and.returnValue(Promise.reject(new Error('Game socket not connected')));
    await clock.sync();
    expect(Math.abs(clock.now() - (Date.now() + SKEW))).toBeLessThanOrEqual(60);
  });
});
