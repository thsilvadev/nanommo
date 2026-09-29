const { io } = require('socket.io-client');
const { Client } = require('pg');

const BASE_URL = process.env.NANOMMO_API_URL || 'http://localhost:3010';
const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'nanommo',
  password: process.env.PGPASSWORD || 'nanommo_dev_password',
  database: process.env.PGDATABASE || 'nanommo',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`[PASS] ${message}`);
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(`${BASE_URL}/game`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('socket connection timeout'));
    }, 7000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

async function main() {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const register = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `gateway_${stamp}@test.com`,
      username: `gw${stamp}`.slice(0, 16),
      password: 'Test123!@#',
      cpf: `${stamp}12`,
    }),
  });
  const regBody = await register.json();
  assert(register.status === 201, `registration succeeds (${register.status})`);
  const token = regBody.accessToken;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const userId = payload.userId;
  assert(Boolean(token && userId), 'registration returns access token and JWT user id');

  const pg = new Client(PG);
  await pg.connect();
  await pg.query('UPDATE users SET "emailVerified" = true WHERE id = $1', [userId]);
  const row = await pg.query('SELECT id FROM characters WHERE "userId" = $1 LIMIT 1', [userId]);
  await pg.end();
  assert(row.rows.length === 1, 'registration created a character');

  let invalidRejected = false;
  try {
    await connectSocket('not-a-valid-token');
  } catch {
    invalidRejected = true;
  }
  assert(invalidRejected, 'invalid WebSocket handshake is rejected');

  const socket = await connectSocket(token);
  assert(socket.connected, 'valid /game WebSocket handshake succeeds');

  const queuePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('battle:queueUpdated not received')), 10000);
    socket.once('battle:queueUpdated', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

  socket.emit('map:enter', { mapId: 'map_green_grounds' });
  const queue = await queuePromise;
  assert(Array.isArray(queue.entries), 'battle:queueUpdated payload contains entries array');
  assert(queue.entries.length === 5, `map:enter creates a 5-entry live queue (got ${queue.entries.length})`);
  assert(queue.entries.every((entry) => entry.resolved === false), 'queueUpdated contains only unresolved entries');
  assert(queue.entries.every((entry) => entry.startAt && entry.endAt), 'queue entries contain server timing');

  const leavePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('map:left not received')), 5000);
    socket.once('map:left', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
  socket.emit('map:leave', {});
  const left = await leavePromise;
  assert(left.success === true, 'map:leave is accepted through the socket');

  socket.close();
  console.log('[PASS] battle gateway smoke test complete');
}

main().catch((error) => {
  console.error(`[FAIL] ${error.stack || error.message}`);
  process.exitCode = 1;
});
