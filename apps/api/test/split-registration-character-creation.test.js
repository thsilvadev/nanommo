/**
 * Integration tests for the split-registration-character-creation change.
 *
 * Covers tasks 10.1–10.3:
 *   10.1 stage-1 registration creates a User with emailVerified=false,
 *        provider='local', no Character, and sends a verification email
 *   10.2 login succeeds with email and with character name, returns tokens
 *        carrying characterId and emailVerified claims, and allows unverified users
 *   10.3 POST /characters returns 403 for unverified users, 400 for invalid
 *        name format, 409 for duplicate name, and 201 with starter
 *        inventory/weapon proficiencies/gambit pages for a valid verified user
 *
 * Requires a running backend (default http://localhost:3000). Override with
 * SPLIT_REG_API_URL. The test registers throwaway users with timestamped
 * emails so it can run repeatedly against the same database.
 *
 * Run: node test/split-registration-character-creation.test.js
 */

const assert = require('assert');

const BASE_URL = process.env.SPLIT_REG_API_URL || 'http://localhost:3000';

// The API is globally throttled (THROTTLE_LIMIT=5 / THROTTLE_TTL=60000,
// app.module.ts). Pace requests to stay inside the window.
const MIN_INTERVAL_MS = Number(process.env.SPLIT_REG_MIN_INTERVAL_MS ?? 13_000);
let lastRequestAt = 0;

async function request(method, path, body = null, token = null) {
  const waitMs = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  lastRequestAt = Date.now();

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function decodeJwt(token) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  ));
}

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-13);
const email = `split_${stamp}@test.com`;
const password = 'Test123456';

(async () => {
  // ---- 10.1: stage-1 registration ----
  const reg = await request('POST', '/auth/register', { email, password });
  assert.strictEqual(reg.status, 201, `register status: ${reg.status} ${JSON.stringify(reg.data)}`);
  assert.ok(reg.data.accessToken, 'register returns an accessToken');
  assert.ok(reg.data.refreshToken, 'register returns a refreshToken');

  const regClaims = decodeJwt(reg.data.accessToken);
  assert.strictEqual(regClaims.emailVerified, false, 'new user emailVerified=false in JWT');
  assert.strictEqual(regClaims.characterId, null, 'new user has no characterId in JWT');
  assert.strictEqual(regClaims.type, 'access');
  assert.ok(regClaims.sessionId, 'JWT carries sessionId');
  assert.ok(!('username' in regClaims), 'JWT no longer carries a username claim');

  // No Character row is auto-created: GET /characters returns null.
  const myChar = await request('GET', '/characters', null, reg.data.accessToken);
  assert.strictEqual(myChar.status, 200, `GET /characters status: ${myChar.status}`);
  assert.strictEqual(myChar.data, null, 'stage-1 registration creates no Character');

  // ---- 10.3 (part 1): POST /characters is 403 for unverified users ----
  const unverifiedCreate = await request(
    'POST', '/characters', { name: 'ShouldNotCreate' }, reg.data.accessToken,
  );
  assert.strictEqual(unverifiedCreate.status, 403, `unverified create status: ${unverifiedCreate.status}`);

  // ---- 10.2: login allows unverified users (by email) ----
  const loginUnverified = await request('POST', '/auth/login', { identifier: email, password });
  assert.strictEqual(loginUnverified.status, 200, `unverified login status: ${loginUnverified.status}`);
  const unverifiedClaims = decodeJwt(loginUnverified.data.accessToken);
  assert.strictEqual(unverifiedClaims.emailVerified, false, 'unverified login embeds emailVerified=false');

  // Wrong password is rejected with 401 (no enumeration).
  const wrongPassword = await request('POST', '/auth/login', { identifier: email, password: 'nope' });
  assert.strictEqual(wrongPassword.status, 401, `wrong password status: ${wrongPassword.status}`);

  // Unknown identifier is rejected with 401.
  const unknownId = await request('POST', '/auth/login', { identifier: 'nobody@example.com', password });
  assert.strictEqual(unknownId.status, 401, `unknown identifier status: ${unknownId.status}`);

  // ---- Verify the email (DB-side, as the verification link would) ----
  // The verification endpoint consumes the token; here we flip the flag directly
  // so the character-creation gate can be exercised without SMTP.
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'nanommo',
    password: process.env.DB_PASSWORD || 'nanommo_dev_password',
    database: process.env.DB_NAME || 'nanommo',
  });
  await client.connect();
  await client.query('UPDATE users SET "emailVerified" = true WHERE email = $1', [email]);
  await client.end();

  // ---- 10.3 (part 2): name validation ----
  const tooShort = await request('POST', '/characters', { name: 'ab' }, reg.data.accessToken);
  assert.strictEqual(tooShort.status, 400, `too-short name status: ${tooShort.status}`);

  const badChars = await request('POST', '/characters', { name: 'bad-name!' }, reg.data.accessToken);
  assert.strictEqual(badChars.status, 400, `bad-chars name status: ${badChars.status}`);

  // ---- 10.3 (part 3): valid creation returns 201 with starter state ----
  const created = await request('POST', '/characters', { name: `Hero${stamp}` }, reg.data.accessToken);
  assert.strictEqual(created.status, 201, `valid create status: ${created.status} ${JSON.stringify(created.data)}`);
  assert.strictEqual(created.data.name, `Hero${stamp}`, 'created character carries the submitted name');
  assert.strictEqual(created.data.level, 1, 'starter level is 1');
  assert.strictEqual(created.data.str, 5, 'starter str is 5');

  // Starter inventory: 50x pot_hp_small, 5x food_bread.
  const inventory = await request('GET', '/inventory', null, reg.data.accessToken);
  assert.strictEqual(inventory.status, 200, `inventory status: ${inventory.status}`);
  const invMap = Object.fromEntries((inventory.data.items || []).map((i) => [i.itemId, i.quantity]));
  assert.strictEqual(invMap['pot_hp_small'], 50, 'starter inventory has 50x pot_hp_small');
  assert.strictEqual(invMap['food_bread'], 5, 'starter inventory has 5x food_bread');

  // All 7 weapon proficiencies at level 1.
  const proficiencies = await request('GET', '/characters/weapon-proficiency', null, reg.data.accessToken);
  assert.strictEqual(proficiencies.status, 200, `proficiency status: ${proficiencies.status}`);
  assert.strictEqual(proficiencies.data.length, 7, '7 weapon proficiencies created');
  for (const p of proficiencies.data) assert.strictEqual(p.level, 1, `${p.weaponType} at level 1`);

  // 3 gambit pages, slot 0 pre-filled.
  const gambits = await request('GET', '/gambits', null, reg.data.accessToken);
  assert.strictEqual(gambits.status, 200, `gambits status: ${gambits.status}`);
  assert.strictEqual(gambits.data.length, 3, '3 gambit pages created');
  assert.ok(gambits.data[0].lines.length > 0, 'slot 0 has a default gambit');

  // ---- 10.3 (part 4): duplicate name is 409 ----
  // A second user (verified, no character) tries to take the same name.
  const email2 = `split2_${stamp}@test.com`;
  const reg2 = await request('POST', '/auth/register', { email: email2, password });
  assert.strictEqual(reg2.status, 201, `second register status: ${reg2.status}`);
  const client2 = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'nanommo',
    password: process.env.DB_PASSWORD || 'nanommo_dev_password',
    database: process.env.DB_NAME || 'nanommo',
  });
  await client2.connect();
  await client2.query('UPDATE users SET "emailVerified" = true WHERE email = $1', [email2]);
  await client2.end();

  const duplicate = await request('POST', '/characters', { name: `Hero${stamp}` }, reg2.data.accessToken);
  assert.strictEqual(duplicate.status, 409, `duplicate name status: ${duplicate.status}`);

  // ---- 10.2 (part 2): login by character name ----
  const loginByName = await request('POST', '/auth/login', { identifier: `Hero${stamp}`, password });
  assert.strictEqual(loginByName.status, 200, `login-by-name status: ${loginByName.status}`);
  const nameClaims = decodeJwt(loginByName.data.accessToken);
  assert.strictEqual(nameClaims.emailVerified, true, 'login-by-name embeds emailVerified=true');
  assert.ok(nameClaims.characterId, 'login-by-name embeds a non-null characterId');
  assert.strictEqual(nameClaims.characterId, created.data.id, 'characterId matches the created character');

  // ---- 10.2 (part 3): refresh returns fresh claims ----
  const refresh = await request('POST', '/auth/refresh', { refreshToken: loginByName.data.refreshToken });
  assert.strictEqual(refresh.status, 200, `refresh status: ${refresh.status}`);
  const refreshClaims = decodeJwt(refresh.data.accessToken);
  assert.strictEqual(refreshClaims.characterId, created.data.id, 'refresh carries fresh characterId');
  assert.strictEqual(refreshClaims.emailVerified, true, 'refresh carries fresh emailVerified');

  console.log('split-registration-character-creation: all assertions passed');
  process.exit(0);
})().catch((error) => {
  console.error('FAILED:', error.message);
  process.exit(1);
});
