/**
 * Boots a real (database-free) Nest application to prove what unit tests with
 * fake contexts cannot: the globally registered interceptor runs after the
 * route's auth guard on HTTP, and on socket handlers of a gateway.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { Controller, Post, Get, UseGuards, UseInterceptors, Module, Logger } = require('@nestjs/common');
const { APP_INTERCEPTOR, NestFactory } = require('@nestjs/core');
const { getDataSourceToken } = require('@nestjs/typeorm');
const { WebSocketGateway, SubscribeMessage } = require('@nestjs/websockets');
const { io } = require('socket.io-client');
const {
  AppearanceRequiredInterceptor, AllowWithoutAppearance,
} = require('../dist/apps/api/src/modules/character/appearance-required.interceptor.js');

const decorate = (decorators, target, key) => {
  const descriptor = key ? Object.getOwnPropertyDescriptor(target, key) : undefined;
  for (const decorator of [...decorators].reverse()) key ? decorator(target, key, descriptor) : decorator(target);
};

// Stand-in for AuthGuard('jwt'): authenticates from a header, like the real guard populates req.user.
class HeaderAuthGuard {
  canActivate(context) {
    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-user'];
    if (!userId) return false;
    request.user = { userId };
    return true;
  }
}

class GameController {
  act() { return { ok: 'acted' }; }
  read() { return { ok: 'read' }; }
  appearance() { return { ok: 'appearance' }; }
  open() { return { ok: 'open' }; }
}
decorate([Post('act'), UseGuards(HeaderAuthGuard)], GameController.prototype, 'act');
decorate([Get('read'), UseGuards(HeaderAuthGuard)], GameController.prototype, 'read');
decorate([AllowWithoutAppearance(), Post('appearance'), UseGuards(HeaderAuthGuard)], GameController.prototype, 'appearance');
decorate([Post('open')], GameController.prototype, 'open');
decorate([Controller('game')], GameController);

class GameGateway {
  handleConnection(client) { client.userId = client.handshake.auth?.userId; }
  enter() { return { event: 'entered', data: { ok: true } }; }
  ping() { return { event: 'pong', data: { ok: true } }; }
}
decorate([SubscribeMessage('map:enter')], GameGateway.prototype, 'enter');
decorate([AllowWithoutAppearance(), SubscribeMessage('ping')], GameGateway.prototype, 'ping');
decorate([UseInterceptors(AppearanceRequiredInterceptor), WebSocketGateway({ namespace: '/game' })], GameGateway);

const characters = { pending: { appearance: null }, done: { appearance: { v: 1 } } };
const fakeDataSource = {
  query: async (_sql, [userId]) => (characters[userId] ? [{ pending: characters[userId].appearance == null }] : []),
};

class TestModule {}
decorate([Module({
  controllers: [GameController],
  providers: [
    GameGateway,
    { provide: getDataSourceToken(), useValue: fakeDataSource },
    { provide: APP_INTERCEPTOR, useClass: AppearanceRequiredInterceptor },
  ],
})], TestModule);

function socketCall(base, userId, event) {
  return new Promise((resolve, reject) => {
    const socket = io(`${base}/game`, { auth: { userId }, transports: ['websocket'], reconnection: false });
    const finish = (value) => { socket.close(); resolve(value); };
    const timer = setTimeout(() => { socket.close(); reject(new Error(`no reply to ${event} for ${userId}`)); }, 4000);
    socket.on('connect', () => socket.emit(event, {}));
    socket.on('connect_error', (error) => { clearTimeout(timer); socket.close(); reject(error); });
    socket.on('exception', (payload) => { clearTimeout(timer); finish({ exception: payload }); });
    for (const reply of ['entered', 'pong']) socket.on(reply, (payload) => { clearTimeout(timer); finish({ reply, payload }); });
  });
}

(async () => {
  Logger.overrideLogger(false);
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const call = async (method, route, user) => {
    const response = await fetch(`${base}/game/${route}`, { method, headers: user ? { 'x-user': user } : {} });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  try {
    // HTTP: the interceptor sees req.user set by the route guard.
    const blocked = await call('POST', 'act', 'pending');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'APPEARANCE_REQUIRED');
    assert.deepEqual(await call('POST', 'act', 'done'), { status: 201, body: { ok: 'acted' } });
    assert.deepEqual(await call('GET', 'read', 'pending'), { status: 200, body: { ok: 'read' } });
    assert.deepEqual(await call('POST', 'appearance', 'pending'), { status: 201, body: { ok: 'appearance' } });
    assert.deepEqual(await call('POST', 'act', 'no-character'), { status: 201, body: { ok: 'acted' } });
    assert.deepEqual(await call('POST', 'open'), { status: 201, body: { ok: 'open' } }, 'unauthenticated routes are untouched');
    assert.equal((await call('POST', 'act')).status, 403, 'the auth guard still rejects anonymous callers first');

    // Unblocked the moment the appearance exists.
    characters.pending.appearance = { v: 1 };
    assert.equal((await call('POST', 'act', 'pending')).status, 201);
    characters.pending.appearance = null;

    // Socket handlers.
    const wsBlocked = await socketCall(base, 'pending', 'map:enter');
    assert.equal(wsBlocked.exception?.code, 'APPEARANCE_REQUIRED', `socket handler must be refused, got ${JSON.stringify(wsBlocked)}`);
    assert.equal((await socketCall(base, 'done', 'map:enter')).reply, 'entered');
    assert.equal((await socketCall(base, 'pending', 'ping')).reply, 'pong');

    console.log('character-appearance-guard-integration: real Nest app blocks HTTP mutations and socket handlers without appearance');
  } finally {
    await app.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
