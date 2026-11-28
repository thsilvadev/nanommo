const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const webpush = require('web-push');
const { NotificationsService } = require('../dist/apps/api/src/modules/notifications/notifications.service');
const now = Date.parse('2026-11-27T15:00:00Z');
const realNow = Date.now;
const realSend = webpush.sendNotification;
Date.now = () => now;
const event = { kind: 'town_event', title: { 'pt-BR': 'Quebra-Quebra', 'en-US': 'Smashing Spree' }, body: { 'pt-BR': 'Começou!', 'en-US': 'Started!' }, target: 'town', data: { mapId: 'map_town' } };
const options = { id: 'ss-123:started', expiresAt: now + 120000 };
(async () => {
  const sent = []; const deleted = []; const warnings = [];
  const rows = Array.from({ length: 102 }, (_, i) => ({ id: String(i).padStart(3, '0'), characterId: `hero-${i}`, locale: i === 0 ? 'pt-BR' : 'en-US', endpoint: `https://push.example/${i}`, p256dh: 'key', auth: 'auth' }));
  const service = Object.create(NotificationsService.prototype);
  Object.assign(service, { vapidReady: true, logger: { warn: msg => warnings.push(msg) },
    dataSource: { transaction: () => { throw Error('must preserve pending character pushes'); } },
    characters: { findOne: () => { throw Error('must query subscribed endpoints only'); } },
    subscriptions: { find: async ({ where, take }) => rows.filter(row => !where.id || row.id > where.id.value).slice(0, take), delete: async row => { deleted.push(row); const index = rows.findIndex(item => item.id === row.id); if (index >= 0) rows.splice(index, 1); } } });
  webpush.sendNotification = async (subscription, payload, config) => {
    sent.push({ subscription, payload: JSON.parse(payload), config });
    if (subscription.endpoint.endsWith('/2')) throw { statusCode: 410 };
    if (subscription.endpoint.endsWith('/3')) throw { statusCode: 503 };
  };
  await service.broadcast(event, options);
  assert.equal(sent.length, 102, 'every subscribed endpoint, including subsequent pages');
  assert.equal(sent[0].payload.title, 'Quebra-Quebra');
  assert.equal(sent[1].payload.body, 'Started!');
  assert.equal(sent[0].payload.characterId, 'hero-0');
  assert.equal(sent[0].payload.id, options.id);
  assert.equal(sent[0].payload.expiresAt, options.expiresAt);
  assert.equal(sent[0].payload.receiptRequired, false);
  assert.equal(sent[0].payload.target, 'town');
  assert.equal(sent[0].config.TTL, 120);
  assert.deepEqual(deleted, [{ id: '002' }]);
  assert.equal(warnings.length, 1);
  await service.broadcast(event, { ...options, expiresAt: now });
  assert.equal(sent.length, 102, 'expired events never sent');
  service.vapidReady = false;
  await service.broadcast(event, options);
  assert.equal(sent.length, 102, 'disabled VAPID never sends');

  // A push wakes the service worker without any page/window running.
  const listeners = {}; const displayed = []; const receipts = [];
  const self = { addEventListener: (name, handler) => listeners[name] = handler,
    registration: { showNotification: async (...args) => displayed.push(args) }, location: { href: 'https://game.example/sw.js?api=https://api.example', origin: 'https://game.example' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../frontend/public/sw.js'), 'utf8'), { self, URL, Date, fetch: async (...args) => receipts.push(args) });
  async function push(payload) { let done; listeners.push({ data: { json: () => payload }, waitUntil: p => done = p }); await done; }
  const payload = sent[0].payload;
  await push(payload);
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0][1].tag, `nanommo-${options.id}`);
  assert.equal(displayed[0][1].data.target, '/play/grind');
  assert.equal(receipts.length, 0, 'transient events do not consume pending-push receipts');
  await push({ ...payload, expiresAt: now - 1 });
  assert.equal(displayed.length, 1, 'queued expired event suppressed by service worker');
  await push({ ...payload, id: 'inventory-receipt', token: 'secret', expiresAt: undefined, receiptRequired: undefined, target: 'inventory' });
  assert.equal(receipts.length, 1, 'existing inventory display receipts retained');
  console.log('town-event-push passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Date.now = realNow; webpush.sendNotification = realSend; });
