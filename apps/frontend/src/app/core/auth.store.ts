import { Injectable, signal, computed, inject } from '@angular/core';
import { Observable, defer, shareReplay, tap, catchError, finalize, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { SKIP_AUTH_REFRESH } from './api.service';
import { HttpContext } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserPayload {
  userId: string;
  username: string;
  sessionId: string;
  type: 'access' | 'refresh';
}

@Injectable({
  providedIn: 'root',
})
export class AuthStore {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  private readonly _accessToken = signal<string | null>(null);
  private readonly _refreshToken = signal<string | null>(null);
  private readonly _userPayload = signal<UserPayload | null>(null);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private refreshInFlight$: Observable<AuthTokens> | null = null;

  readonly accessToken = this._accessToken.asReadonly();
  readonly refreshToken = this._refreshToken.asReadonly();
  readonly userPayload = this._userPayload.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isAuthenticated = computed(() => !!this._accessToken() && !!this._userPayload());

  constructor() {
    this.bootstrap();
  }

  private bootstrap(): void {
    const storedAccessToken = localStorage.getItem('accessToken');
    const storedRefreshToken = localStorage.getItem('refreshToken');
    if (storedAccessToken && storedRefreshToken) {
      this._accessToken.set(storedAccessToken);
      this._refreshToken.set(storedRefreshToken);
      const payload = this.parseJwt(storedAccessToken);
      if (payload) {
        this._userPayload.set(payload);
      }
    } else if (storedRefreshToken) {
      this._refreshToken.set(storedRefreshToken);
      this.refreshAccessToken().subscribe({
        next: () => {},
        error: () => {
          this.clearTokens();
        },
      });
    }
  }

  setTokens(tokens: AuthTokens): void {
    this._accessToken.set(tokens.accessToken);
    this._refreshToken.set(tokens.refreshToken);
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);

    const payload = this.parseJwt(tokens.accessToken);
    if (payload) {
      this._userPayload.set(payload);
    }
    window.dispatchEvent(new CustomEvent('nanommo:auth-refreshed'));
  }

  clearTokens(): void {
    this._accessToken.set(null);
    this._refreshToken.set(null);
    this._userPayload.set(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  private parseJwt(token: string): UserPayload | null {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

  register(username: string, email: string, password: string, cpf: string): Observable<AuthTokens> {
    this._isLoading.set(true);
    this._error.set(null);

    return new Observable<AuthTokens>((observer) => {
      this.api.post<AuthTokens>('/auth/register', { username, email, password, cpf }).subscribe({
        next: (tokens) => {
          this.setTokens(tokens);
          this._isLoading.set(false);
          observer.next(tokens);
          observer.complete();
        },
        error: (err) => {
          this._isLoading.set(false);
          const message = err.error?.message || 'Registration failed';
          this._error.set(message);
          observer.error(err);
        },
      });
    });
  }

  login(username: string, password: string): Observable<AuthTokens> {
    this._isLoading.set(true);
    this._error.set(null);

    return new Observable<AuthTokens>((observer) => {
      this.api.post<AuthTokens>('/auth/login', { username, password }).subscribe({
        next: (tokens) => {
          this.setTokens(tokens);
          this._isLoading.set(false);
          observer.next(tokens);
          observer.complete();
        },
        error: (err) => {
          this._isLoading.set(false);
          const message = err.error?.message || 'Login failed';
          this._error.set(message);
          observer.error(err);
        },
      });
    });
  }

  logout(): void {
    this.clearTokens();
    this.router.navigate(['/login']);
  }

  refreshAccessToken(): Observable<AuthTokens> {
    if (this.refreshInFlight$) return this.refreshInFlight$;
    const refreshToken = this._refreshToken();
    if (!refreshToken) return throwError(() => new Error('No refresh token'));
    this.refreshInFlight$ = defer(() => this.api.post<AuthTokens>('/auth/refresh', { refreshToken }, { context: new HttpContext().set(SKIP_AUTH_REFRESH, true) })).pipe(
      tap(tokens => this.setTokens(tokens)),
      catchError(err => { this.clearTokens(); return throwError(() => err); }),
      finalize(() => { this.refreshInFlight$ = null; }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.refreshInFlight$;
  }

  verifyEmail(token: string): Observable<{ success: boolean; message: string }> {
    return new Observable<{ success: boolean; message: string }>((observer) => {
      this.api.get<{ success: boolean; message: string }>(`/auth/verify-email?token=${token}`).subscribe({
        next: (response) => {
          observer.next(response);
          observer.complete();
        },
        error: (err) => {
          observer.error(err);
        },
      });
    });
  }

  resendVerificationEmail(): Observable<{ success: boolean; message: string }> {
    return new Observable<{ success: boolean; message: string }>((observer) => {
      this.api.post<{ success: boolean; message: string }>('/auth/resend-verification', {}).subscribe({
        next: (response) => {
          observer.next(response);
          observer.complete();
        },
        error: (err) => {
          observer.error(err);
        },
      });
    });
  }

  forgotPassword(email: string): Observable<{ success: boolean; message: string }> {
    this._isLoading.set(true);
    this._error.set(null);

    return new Observable<{ success: boolean; message: string }>((observer) => {
      this.api.post<{ success: boolean; message: string }>('/auth/forgot-password', { email }).subscribe({
        next: (response) => {
          this._isLoading.set(false);
          observer.next(response);
          observer.complete();
        },
        error: (err) => {
          this._isLoading.set(false);
          const message = err.error?.message || 'Failed to send reset email';
          this._error.set(message);
          observer.error(err);
        },
      });
    });
  }

  resetPassword(token: string, newPassword: string): Observable<{ success: boolean; message: string }> {
    this._isLoading.set(true);
    this._error.set(null);

    return new Observable<{ success: boolean; message: string }>((observer) => {
      this.api.post<{ success: boolean; message: string }>('/auth/reset-password', { token, newPassword }).subscribe({
        next: (response) => {
          this._isLoading.set(false);
          observer.next(response);
          observer.complete();
        },
        error: (err) => {
          this._isLoading.set(false);
          const message = err.error?.message || 'Failed to reset password';
          this._error.set(message);
          observer.error(err);
        },
      });
    });
  }
}