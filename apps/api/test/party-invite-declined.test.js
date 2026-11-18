// Direct-execution Node test, run from the repo root after `pnpm --filter @nanommo/api build`:
//   node apps/api/test/party-invite-declined.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PartyService } = require('../dist/apps/api/src/modules/party/party.service');

const INVITER = '00000000-0000-4000-8000-000000000001';
const CANDIDATE = '00000000-0000-4000-8000-000000000002';

function fakeService({ invite, expired = [] }) {
  const service = Object.create(PartyService.prototype);
  const events = [];
  const sql = [];
  const run = async (text, args = []) => {
    sql.push(text);
    if (text.includes('FROM party_invites WHERE id=$1 AND ("candidateId"=$2 OR "inviterId"=$2) FOR UPDATE')) {
      return invite && (invite.candidateId === args[1] || invite.inviterId === args[1]) ? [{ ...invite }] : [];
    }
    if (text.includes('SELECT name FROM characters WHERE id=$1')) return [{ name: 'Candy' }];
    if (text.includes("SET status='expired'")) return expired;
    if (text.includes("WHERE status='accepted'")) return []; // no accepted offers to join
    return [];
  };
  const manager = { query: run };
  service.db = { query: run, manager, transaction: async fn => fn(manager) };
  service.event = async (_manager, characterId, event, payload) => { events.push({ characterId, event, payload }); };
  service.get = async () => ({});
  return { service, events, sql };
}

const declined = events => events.filter(e => e.event === 'party:inviteDeclined');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('candidate declining an offered invite notifies the inviter', async () => {
  const { service, events } = fakeService({ invite: { id: 'inv-1', inviterId: INVITER, candidateId: CANDIDATE, status: 'offered' } });
  await service.cancelInvite(CANDIDATE, 'inv-1');
  const [notice] = declined(events);
  assert.ok(notice, 'no party:inviteDeclined emitted');
  assert.equal(notice.characterId, INVITER);
  assert.deepStrictEqual(notice.payload, { inviteId: 'inv-1', candidateId: CANDIDATE, candidateName: 'Candy', reason: 'declined' });
});

test('inviter withdrawing the invite does not emit a decline', async () => {
  const { service, events } = fakeService({ invite: { id: 'inv-1', inviterId: INVITER, candidateId: CANDIDATE, status: 'offered' } });
  await service.cancelInvite(INVITER, 'inv-1');
  assert.equal(declined(events).length, 0);
});

test('cancelling an invite that is no longer offered does not emit a decline', async () => {
  const { service, events } = fakeService({ invite: { id: 'inv-1', inviterId: INVITER, candidateId: CANDIDATE, status: 'expired' } });
  await service.cancelInvite(CANDIDATE, 'inv-1');
  assert.equal(declined(events).length, 0);
});

test('expiry notifies every inviter with reason expired', async () => {
  const { service, events, sql } = fakeService({
    expired: [
      { id: 'inv-1', inviterId: INVITER, candidateId: CANDIDATE, candidateName: 'Candy' },
      { id: 'inv-2', inviterId: CANDIDATE, candidateId: INVITER, candidateName: 'Ivy' },
    ],
  });
  await service.tryAccepted();
  assert.ok(sql.some(s => s.includes("SET status='expired'") && s.includes('RETURNING')), 'expiry UPDATE uses RETURNING');
  assert.deepStrictEqual(declined(events).map(e => [e.characterId, e.payload]), [
    [INVITER, { inviteId: 'inv-1', candidateId: CANDIDATE, candidateName: 'Candy', reason: 'expired' }],
    [CANDIDATE, { inviteId: 'inv-2', candidateId: INVITER, candidateName: 'Ivy', reason: 'expired' }],
  ]);
});

test('source: statuses stay cancelled/expired (no new value, no migration)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/modules/party/party.service.ts'), 'utf8');
  assert.doesNotMatch(src, /status='declined'/);
});

test('gateway forwards party:inviteDeclined to the inviter socket', () => {
  const gateway = fs.readFileSync(path.join(__dirname, '../src/modules/gateway/nanommo.gateway.ts'), 'utf8');
  assert.ok(gateway.includes('`gateway:party:inviteDeclined:${characterId}`'), 'per-character channel is subscribed');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.error(`FAIL - ${name}\n  ${e.message}`); }
  }
  if (failed) { console.error(`${failed}/${tests.length} failed`); process.exit(1); }
  console.log(`${tests.length}/${tests.length} passed`);
})();
