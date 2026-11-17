const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// rxjs is a transitive dependency of Nest in this workspace; resolve it from Nest's own context.
const { of, lastValueFrom } = require(require.resolve('rxjs', { paths: [path.dirname(require.resolve('@nestjs/common'))] }));
const { ForbiddenException } = require('@nestjs/common');
const { WsException } = require('@nestjs/websockets');
const { Reflector } = require('@nestjs/core');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const {
  AppearanceRequiredInterceptor, AllowWithoutAppearance, APPEARANCE_REQUIRED, isAppearancePending,
} = require('../dist/apps/api/src/modules/character/appearance-required.interceptor.js');

assert.equal(APPEARANCE_REQUIRED, 'APPEARANCE_REQUIRED');
assert.equal(isAppearancePending({ appearance: null }), true);
assert.equal(isAppearancePending({ appearance: undefined }), true);
assert.equal(isAppearancePending({ appearance: { v: 1 } }), false);

class Plain { mutate() {} read() {} }
class Marked { mutate() {} }
AllowWithoutAppearance()(Marked);
class Partly { allowed() {} blocked() {} }
AllowWithoutAppearance()(Partly.prototype, 'allowed', Object.getOwnPropertyDescriptor(Partly.prototype, 'allowed'));

function makeInterceptor(charactersByUser) {
  const queries = [];
  const dataSource = {
    query: async (sql, params) => {
      queries.push([sql, params]);
      const row = charactersByUser[params[0]];
      return row === undefined ? [] : [{ pending: row.appearance == null }];
    },
  };
  return { interceptor: new AppearanceRequiredInterceptor(new Reflector(), dataSource), queries, charactersByUser };
}
function http(method, userId, controller = Plain, handler = 'mutate') {
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => controller.prototype[handler],
    switchToHttp: () => ({ getRequest: () => ({ method, user: userId ? { userId } : undefined }) }),
  };
}
function ws(userId, controller = Plain, handler = 'mutate') {
  return {
    getType: () => 'ws',
    getClass: () => controller,
    getHandler: () => controller.prototype[handler],
    switchToWs: () => ({ getClient: () => ({ userId }) }),
  };
}
const next = () => { const state = { called: 0 }; return { state, handle: () => { state.called += 1; return of('handled'); } }; };
async function run(interceptor, context) {
  const n = next();
  const result = await lastValueFrom(await interceptor.intercept(context, n));
  return { result, called: n.state.called };
}
async function blocked(interceptor, context, type) {
  const n = next();
  await assert.rejects(async () => lastValueFrom(await interceptor.intercept(context, n)), (error) => {
    assert.ok(error instanceof type, `expected ${type.name}, got ${error?.constructor?.name}`);
    const body = type === WsException ? error.getError() : error.getResponse();
    assert.equal(body.code, 'APPEARANCE_REQUIRED');
    return true;
  });
  assert.equal(n.state.called, 0, 'the handler never runs');
}

(async () => {
  const users = { pending: { appearance: null }, done: { appearance: { v: 1 } } };

  // Mutations are refused for a character without appearance.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { interceptor } = makeInterceptor(users);
    await blocked(interceptor, http(method, 'pending'), ForbiddenException);
  }
  // Reads are always allowed and cost no query.
  {
    const { interceptor, queries } = makeInterceptor(users);
    for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.deepEqual(await run(interceptor, http(method, 'pending')), { result: 'handled', called: 1 });
    assert.equal(queries.length, 0);
  }
  // Characters with appearance, users with no character yet, and anonymous requests pass.
  {
    const { interceptor, queries } = makeInterceptor(users);
    assert.equal((await run(interceptor, http('POST', 'done'))).called, 1);
    assert.equal((await run(interceptor, http('POST', 'no-character-yet'))).called, 1);
    assert.equal((await run(interceptor, http('POST', undefined))).called, 1);
    assert.match(queries[0][0], /"appearance" IS NULL/);
    assert.match(queries[0][0], /"userId" = \$1/);
    assert.deepEqual(queries[0][1], ['done']);
  }
  // Explicitly allowed controllers and handlers pass without a query.
  {
    const { interceptor, queries } = makeInterceptor(users);
    assert.equal((await run(interceptor, http('POST', 'pending', Marked))).called, 1);
    assert.equal((await run(interceptor, http('POST', 'pending', Partly, 'allowed'))).called, 1);
    assert.equal(queries.length, 0);
    await blocked(interceptor, http('POST', 'pending', Partly, 'blocked'), ForbiddenException);
  }
  // "Has appearance" is permanent, so it is cached; "pending" is re-checked every time.
  {
    const { interceptor, queries, charactersByUser } = makeInterceptor({ flips: { appearance: null }, done: { appearance: { v: 1 } } });
    await run(interceptor, http('POST', 'done'));
    await run(interceptor, http('POST', 'done'));
    assert.equal(queries.length, 1, 'a cleared user is not queried again');
    await blocked(interceptor, http('POST', 'flips'), ForbiddenException);
    charactersByUser.flips.appearance = { v: 1 };
    assert.equal((await run(interceptor, http('POST', 'flips'))).called, 1, 'allowed as soon as the appearance is saved');
  }
  // Socket handlers get a WsException carrying the same code.
  {
    const { interceptor } = makeInterceptor(users);
    await blocked(interceptor, ws('pending'), WsException);
    assert.equal((await run(interceptor, ws('done'))).called, 1);
    assert.equal((await run(interceptor, ws('pending', Partly, 'allowed'))).called, 1);
    assert.equal((await run(interceptor, ws(undefined))).called, 1);
  }

  // --- Wiring -------------------------------------------------------------------
  const appModule = read('apps/api/src/app.module.ts');
  assert.match(appModule, /provide: APP_INTERCEPTOR,\s+useClass: AppearanceRequiredInterceptor/, 'registered globally: every current and future route is covered by default');
  const gateway = read('apps/api/src/modules/gateway/nanommo.gateway.ts');
  assert.match(gateway, /@UseInterceptors\(AppearanceRequiredInterceptor\)\s+@WebSocketGateway/);
  for (const event of ['ping', 'map:syncPresence']) {
    assert.match(gateway, new RegExp(`@AllowWithoutAppearance\\(\\)\\s+@SubscribeMessage\\('${event}'\\)`), `${event} stays available`);
  }
  for (const event of ['map:enter', 'map:leave', 'gambit:setActivePage', 'chat:send', 'chat:report']) {
    assert.ok(!new RegExp(`@AllowWithoutAppearance\\(\\)\\s+@SubscribeMessage\\('${event}'\\)`).test(gateway), `${event} is blocked`);
  }
  const allowed = (file) => (read(file).match(/@AllowWithoutAppearance\(\)/g) ?? []).length;
  assert.match(read('apps/api/src/modules/auth/auth.controller.ts'), /@AllowWithoutAppearance\(\)\s+@Controller\('auth'\)/);
  assert.match(read('apps/api/src/modules/auth/google-oauth.controller.ts'), /@AllowWithoutAppearance\(\)\s+@Controller\('auth\/google'\)/);
  assert.match(read('apps/api/src/modules/notifications/notifications.controller.ts'), /@AllowWithoutAppearance\(\)\s+@Controller\('notifications'\)/);
  const characters = read('apps/api/src/modules/character/character.controller.ts');
  assert.match(characters, /@AllowWithoutAppearance\(\)\s+@Post\(\)/);
  assert.match(characters, /@AllowWithoutAppearance\(\)\s+@Post\('appearance'\)/);
  assert.equal(allowed('apps/api/src/modules/character/character.controller.ts'), 2, 'only create and appearance are exempt on /characters');
  // Nothing else in the API opts out.
  const optOuts = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && entry.name !== 'appearance-required.interceptor.ts' && /@AllowWithoutAppearance\(\)/.test(fs.readFileSync(full, 'utf8'))) optOuts.push(path.relative(path.join(root, 'apps/api/src/modules'), full));
    }
  })(path.join(root, 'apps/api/src/modules'));
  assert.deepEqual(optOuts.sort(), ['auth/auth.controller.ts', 'auth/google-oauth.controller.ts', 'character/character.controller.ts', 'gateway/nanommo.gateway.ts', 'notifications/notifications.controller.ts']);

  console.log('character-appearance-guard: mutations blocked without appearance, reads and exempt routes allowed, socket handlers covered, global wiring passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
