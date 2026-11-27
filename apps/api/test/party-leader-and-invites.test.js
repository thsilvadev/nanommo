// Leader transfer (PUT /party/leader) and one pending invitation per inviter/candidate.
// Run after `pnpm --filter @nanommo/api build`: node apps/api/test/party-leader-and-invites.test.js
const assert = require('node:assert/strict');
const { PartyService } = require('../dist/apps/api/src/modules/party/party.service');

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const NOW = Date.parse('2026-11-26T20:00:00Z');
const code = (error) => error?.response?.code ?? error?.getResponse?.()?.code;

function service({ party = null, members = [], pendingInvite = false }) {
  const svc = Object.create(PartyService.prototype);
  const sql = [];
  const events = [];
  const query = async (text, args = []) => {
    sql.push([text, args]);
    if (text.includes('FROM party_invites WHERE "inviterId"=$1 AND "clientRequestId"=$2')) return [];
    if (text.includes('FROM party_invites WHERE "inviterId"=$1 AND "candidateId"=$2 AND status IN')) return pendingInvite ? [{ '?column?': 1 }] : [];
    if (text.includes('SELECT * FROM party_members WHERE "characterId"=$1')) return [];
    return [];
  };
  const characters = [A, B, C].map((id) => ({ id, name: id.slice(-1), appearance: { v: 1 }, currentMapId: 'map_town' }));
  const ctx = { manager: { query }, characters, party, members, now: NOW };
  svc.db = { query, manager: { query } };
  svc.serialized = async (_ids, op) => op(ctx);
  svc.event = async (_m, characterId, event) => { events.push([characterId, event]); };
  svc.changed = async () => { events.push(['*', 'changed']); };
  svc.tryAccepted = async () => {};
  svc.get = async () => ({ ok: true });
  return { svc, sql, events, ctx };
}
const partyOf = (extra = {}) => ({ id: 'p1', kind: 'manual', leaderCharacterId: A, mapId: 'map_town', revision: 3, activity: null, ...extra });
const membersOf = (extra = {}) => [A, B, C].map((characterId, orderIndex) => ({ partyId: 'p1', characterId, orderIndex, pendingLeave: false, ...(extra[characterId] ?? {}) }));

(async () => {
  // Invites: a second pending invite to the same character is refused; the first is created.
  {
    const { svc, sql } = service({});
    await svc.invite(A, B, undefined, 'req-1');
    assert.ok(sql.some(([t]) => t.startsWith('INSERT INTO party_invites')), 'first invite created');
  }
  {
    const { svc, sql } = service({ pendingInvite: true });
    await assert.rejects(svc.invite(A, B, undefined, 'req-2'), (e) => code(e) === 'INVITE_ALREADY_PENDING');
    assert.ok(!sql.some(([t]) => t.startsWith('INSERT INTO party_invites')), 'no second invite row');
  }

  // Leader transfer.
  {
    const { svc, sql, ctx, events } = service({ party: partyOf(), members: membersOf() });
    assert.deepEqual(await svc.transferLeader(A, B), { ok: true });
    const update = sql.find(([t]) => t.startsWith('UPDATE parties SET "leaderCharacterId"=$2'));
    assert.deepEqual(update[1], ['p1', B]);
    assert.equal(ctx.party.leaderCharacterId, B);
    assert.ok(events.some(([, e]) => e === 'changed'), 'members are told');
  }
  const rejects = async (setup, by, to, expected) => {
    const { svc, sql } = service(setup);
    await assert.rejects(svc.transferLeader(by, to), (e) => (code(e) ?? e.message) === expected, expected);
    assert.ok(!sql.some(([t]) => t.startsWith('UPDATE parties SET "leaderCharacterId"')), `${expected}: leader unchanged`);
  };
  await rejects({ party: partyOf(), members: membersOf() }, B, C, 'PARTY_LEADER_REQUIRED');
  await rejects({ party: partyOf(), members: membersOf() }, A, A, 'ALREADY_PARTY_LEADER');
  await rejects({ party: partyOf(), members: membersOf().filter((m) => m.characterId !== C) }, A, C, 'Member not found');
  await rejects({ party: partyOf(), members: membersOf({ [B]: { pendingLeave: true } }) }, A, B, 'MEMBER_LEAVING');
  await rejects({ party: partyOf({ activity: { kind: 'route' } }), members: membersOf() }, A, B, 'PARTY_ACTIVITY_IN_PROGRESS');
  await rejects({ party: null, members: [] }, A, B, 'PARTY_LEADER_REQUIRED');

  console.log('party-leader-and-invites: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
