import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { LocaleService } from './locale.service';
import { environment } from '../../environments/environment';

interface PushBootstrap { acknowledged: string[]; push: { enabled: boolean; publicKey: string | null }; }
@Injectable({ providedIn: 'root' })
export class BrowserNotificationsService {
  private readonly api = inject(ApiService);
  private readonly locale = inject(LocaleService);
  readonly enabled = signal(false);
  readonly supported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  readonly status = signal<'idle' | 'enabled' | 'denied' | 'unsupported' | 'unavailable'>('idle');

  async syncExistingSubscription(): Promise<void> {
    if (!this.supported || Notification.permission !== 'granted') return;
    try {
      const bootstrap = await this.api.get<PushBootstrap>('/notifications').toPromise();
      if (!bootstrap?.push.enabled || !bootstrap.push.publicKey) return;
      const registration = await navigator.serviceWorker.register('/sw.js?api=' + encodeURIComponent(environment.apiBaseUrl), { scope: '/' });
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      await this.api.post('/notifications/push/subscribe', { subscription: subscription.toJSON(), locale: this.locale.locale() }).toPromise();
      this.enabled.set(true); this.status.set('enabled');
    } catch { /* Push is optional and must never block gameplay startup. */ }
  }
  async enable(): Promise<void> {
    if (!this.supported) { this.status.set('unsupported'); return; }
    if (Notification.permission === 'denied') { this.status.set('denied'); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { this.status.set('denied'); return; }
      const bootstrap = await this.api.get<PushBootstrap>('/notifications').toPromise();
      if (!bootstrap?.push.enabled || !bootstrap.push.publicKey) { this.status.set('unavailable'); return; }
      const registration = await navigator.serviceWorker.register('/sw.js?api=' + encodeURIComponent(environment.apiBaseUrl), { scope: '/' });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this.urlBase64ToUint8Array(bootstrap.push.publicKey) as BufferSource });
      await this.api.post('/notifications/push/subscribe', { subscription: subscription.toJSON(), locale: this.locale.locale() }).toPromise();
      this.enabled.set(true); this.status.set('enabled');
    } catch (error) {
      console.error('Unable to enable browser notifications', error);
      this.status.set('unavailable');
    }
  }
  private urlBase64ToUint8Array(value: string): Uint8Array {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
  }
}
