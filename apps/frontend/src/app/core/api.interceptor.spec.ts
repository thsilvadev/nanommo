import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { apiInterceptor } from './api.service';
import { AuthStore } from './auth.store';

describe('apiInterceptor: APPEARANCE_REQUIRED', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
        { provide: AuthStore, useValue: { accessToken: () => 'token', refreshToken: () => null, clearTokens: () => undefined } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  it('sends the player to the character creator and still reports the error', () => {
    let failed = false;
    http.post('/equipment/equip', {}).subscribe({ error: () => { failed = true; } });
    backend.expectOne('/equipment/equip').flush({ code: 'APPEARANCE_REQUIRED', message: 'Create your 3D character before playing' }, { status: 403, statusText: 'Forbidden' });
    expect(router.navigate).toHaveBeenCalledWith(['/create-character']);
    expect(failed).toBeTrue();
  });

  it('leaves other 403 responses alone', () => {
    http.post('/market/buy', {}).subscribe({ error: () => undefined });
    backend.expectOne('/market/buy').flush({ message: 'Email must be verified' }, { status: 403, statusText: 'Forbidden' });
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
