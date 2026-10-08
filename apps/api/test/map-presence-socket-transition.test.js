const assert = require('node:assert/strict');
const { NanommoGateway } = require('../dist/apps/api/src/modules/gateway/nanommo.gateway');

(async () => {
  let messageHandler;
  const subscriber = {
    on: (event, handler) => { if (event === 'message') messageHandler = handler; },
    subscribe: async () => {},
    quit: async () => {},
  };
  const emitted = [];
  const socket = {
    id: 'socket-1',
    leaveCalls: [],
    joinCalls: [],
    emit: (event, payload) => emitted.push({ event, payload }),
    leave: room => socket.leaveCalls.push(room),
    join: room => socket.joinCalls.push(room),
  };
  const gateway = Object.create(NanommoGateway.prototype);
  gateway.redis = { duplicate: () => subscriber };
  gateway.server = { use: () => {}, sockets: { sockets: new Map([['socket-1', socket]]) } };
  gateway.connectedSockets = new Map([['char-1', 'socket-1']]);
  gateway.mapPresenceService = { getPlayersOnMap: async mapId => mapId === 'map_town' ? 3 : 7 };
  gateway.userRepo = { findOne: async () => ({}) };
  gateway.characterRepo = { findOne: async () => ({}) };
  gateway.jwtService = {};
  gateway.logger = { log: () => {}, warn: () => {} };

  gateway.afterInit(gateway.server);
  assert.equal(typeof messageHandler, 'function');

  messageHandler('gateway:map:transition', JSON.stringify({
    characterId: 'char-1',
    previousMapId: 'map_green_grounds',
    nextMapId: 'map_town',
  }));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepStrictEqual(socket.leaveCalls, ['map:map_green_grounds']);
  assert.deepStrictEqual(socket.joinCalls, ['map:map_town']);
  assert.deepStrictEqual(emitted, [{
    event: 'map:presence',
    payload: { mapId: 'map_town', playersOnMap: 3 },
  }]);

  console.log('Socket map transition: 3 assertions passed');
})().catch(error => { console.error(error); process.exit(1); });
