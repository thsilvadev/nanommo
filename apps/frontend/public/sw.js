self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch { return; }
    if (!payload.id || !payload.token || !payload.characterId) return;
    const routeByTarget = { inventory: '/play/grind', character: '/play/character', inbox: '/play/grind' };
    const target = routeByTarget[payload.target] || '/play/grind';
    await self.registration.showNotification(payload.title || 'NanoMMO', {
      body: payload.body || '',
      icon: '/assets/lords-transparent.png',
      badge: '/assets/ui/notification_dot.png',
      tag: 'nanommo-' + payload.id,
      renotify: true,
      data: { ...payload, target }
    });
    // Confirm only after showNotification resolves. A lost receipt can safely be retried;
    // the stable notification tag replaces the same displayed notification.
    const apiBase = new URL(self.location.href).searchParams.get('api') || '';
    if (apiBase) {
      try {
        await fetch(apiBase.replace(/\/$/, '') + '/notifications/push/displayed', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId: payload.characterId, notificationId: payload.id, token: payload.token })
        });
      } catch { /* A later delivery retry uses the same tag and receipt. */ }
    }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = event.notification.data?.target || '/play/grind';
    const url = new URL(target, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
