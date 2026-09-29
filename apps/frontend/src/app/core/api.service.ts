import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpContext, HttpContextToken } from '@angular/common/http';
import { catchError, Observable, switchMap, throwError } from 'rxjs';
import { AuthStore } from './auth.store';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

export const SKIP_AUTH_REFRESH = new HttpContextToken<boolean>(() => false);
export const AUTH_RETRY = new HttpContextToken<boolean>(() => false);

export const apiInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  if (req.context.get(SKIP_AUTH_REFRESH)) return next(req);

  const accessToken = authStore.accessToken();
  
  let authReq = req;
  if (accessToken) {
    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401) return throwError(() => error);
      const errorCode = error.error?.code || error.error?.message;
      const finalUnauthorized = () => {
        authStore.clearTokens();
        void router.navigate(['/login'], { queryParams: { reason: 'session_expired' } });
      };
      if (errorCode === 'SESSION_INVALIDATED' || req.context.get(AUTH_RETRY) || !authStore.refreshToken()) {
        finalUnauthorized();
        return throwError(() => error);
      }
      return authStore.refreshAccessToken().pipe(
        switchMap(() => {
          const token = authStore.accessToken();
          if (!token) { finalUnauthorized(); return throwError(() => error); }
          return next(req.clone({
            context: req.context.set(AUTH_RETRY, true),
            setHeaders: { Authorization: 'Bearer ' + token },
          }));
        }),
        catchError(refreshError => { finalUnauthorized(); return throwError(() => refreshError); }),
      );
    })
  );
};

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  get<T>(endpoint: string, options?: { headers?: HttpHeaders; context?: HttpContext }): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${endpoint}`, options);
  }

  post<T>(endpoint: string, body: unknown, options?: { headers?: HttpHeaders; context?: HttpContext }): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${endpoint}`, body, options);
  }

  put<T>(endpoint: string, body: unknown, options?: { headers?: HttpHeaders; context?: HttpContext }): Observable<T> {
    return this.http.put<T>(`${this.baseUrl}${endpoint}`, body, options);
  }

  patch<T>(endpoint: string, body: unknown, options?: { headers?: HttpHeaders; context?: HttpContext }): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${endpoint}`, body, options);
  }

  delete<T>(endpoint: string, options?: { headers?: HttpHeaders; context?: HttpContext; body?: unknown }): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${endpoint}`, options);
  }
}