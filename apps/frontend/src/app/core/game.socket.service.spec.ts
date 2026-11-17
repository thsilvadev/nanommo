import { TestBed } from '@angular/core/testing';
import { AuthStore } from './auth.store';
import { GameSocketService } from './game.socket.service';

describe('GameSocketService connection identity',()=>{
  it('preserves subscriptions on the socket that is already connecting or reconnecting',()=>{
    TestBed.configureTestingModule({providers:[GameSocketService,{provide:AuthStore,useValue:{accessToken:()=> 'test-token'}}]});
    const service=TestBed.inject(GameSocketService);
    const connecting={connected:false,disconnect:jasmine.createSpy('disconnect')};
    (service as any).socket=connecting;
    service.connect();
    expect((service as any).socket).toBe(connecting);
    service.disconnect();
  });
});
