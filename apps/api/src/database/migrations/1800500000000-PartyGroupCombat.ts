import { MigrationInterface, QueryRunner } from 'typeorm';

/** Forward-only. Run only with consumers stopped through the guarded runner. */
export class PartyGroupCombat1800500000000 implements MigrationInterface {
  name = 'PartyGroupCombat1800500000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE characters ADD COLUMN "autoPartyEnabled" boolean NOT NULL DEFAULT false, ADD COLUMN "autoPartyEnabledAt" timestamptz`);
    await q.query(`CREATE TABLE parties (
      id uuid PRIMARY KEY, kind varchar NOT NULL CHECK(kind IN ('manual','auto')),
      "leaderCharacterId" uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      "mapId" varchar NOT NULL, revision bigint NOT NULL DEFAULT 1, activity jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`CREATE INDEX parties_map_kind ON parties("mapId",kind)`);
    await q.query(`CREATE TABLE party_members (
      "partyId" uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      "characterId" uuid NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
      "orderIndex" smallint NOT NULL CHECK("orderIndex" BETWEEN 0 AND 4),
      "joinedAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "pendingLeave" boolean NOT NULL DEFAULT false, reason varchar,
      PRIMARY KEY("partyId","characterId"), UNIQUE("partyId","orderIndex") DEFERRABLE INITIALLY DEFERRED
    )`);
    await q.query(`CREATE TABLE party_invites (
      id uuid PRIMARY KEY, "inviterId" uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      "candidateId" uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      "partyId" uuid REFERENCES parties(id) ON DELETE SET NULL, mode varchar NOT NULL CHECK(mode IN ('manual','auto')),
      status varchar NOT NULL CHECK(status IN ('offered','accepted','cancelled','expired','joined')),
      "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), revision bigint NOT NULL DEFAULT 1,
      "clientRequestId" varchar NOT NULL, UNIQUE("inviterId","clientRequestId"), CHECK("inviterId"<>"candidateId")
    )`);
    await q.query(`CREATE INDEX party_invites_pending ON party_invites("candidateId",status)`);
    await q.query(`CREATE TABLE character_action_intents (
      id uuid PRIMARY KEY, "characterId" uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      "clientRequestId" varchar NOT NULL, sequence bigint NOT NULL, kind varchar NOT NULL, payload jsonb NOT NULL,
      status varchar NOT NULL CHECK(status IN ('pending','applied','failed','cancelled')), result jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "completedAt" timestamptz,
      UNIQUE("characterId","clientRequestId"), UNIQUE("characterId",sequence)
    )`);
    await q.query(`CREATE TABLE encounter_clocks (
      "ownerKind" varchar NOT NULL CHECK("ownerKind" IN ('character','party')), "ownerId" uuid NOT NULL,
      "mapId" varchar NOT NULL, cycle bigint NOT NULL DEFAULT 0, "searchStartedAt" timestamptz NOT NULL,
      "dueAt" timestamptz NOT NULL, seed varchar NOT NULL, generation bigint NOT NULL DEFAULT 1,
      roster jsonb NOT NULL DEFAULT '[]', status varchar NOT NULL CHECK(status IN ('searching','consumed','cancelled')),
      PRIMARY KEY("ownerKind","ownerId")
    )`);
    await q.query(`CREATE TABLE shared_battles (
      id uuid PRIMARY KEY, "engineVersion" smallint NOT NULL DEFAULT 2 CHECK("engineVersion"=2),
      "partyId" uuid REFERENCES parties(id) ON DELETE SET NULL, "mapId" varchar NOT NULL, seed varchar NOT NULL,
      "startAt" timestamptz NOT NULL, "endAt" timestamptz NOT NULL,
      state varchar NOT NULL CHECK(state IN ('scheduled','started','resolved','fled')),
      snapshot jsonb NOT NULL, log jsonb NOT NULL, result jsonb, revision bigint NOT NULL DEFAULT 1
    )`);
    await q.query(`CREATE TABLE shared_battle_participants (
      "battleId" uuid NOT NULL REFERENCES shared_battles(id) ON DELETE CASCADE,
      "characterId" uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE, snapshot jsonb NOT NULL, result jsonb,
      PRIMARY KEY("battleId","characterId")
    )`);
    // Database claim, independent of Redis lease or process lifetime.
    await q.query(`CREATE TABLE active_battle_participants (
      "characterId" uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      "battleId" uuid NOT NULL REFERENCES shared_battles(id) ON DELETE CASCADE
    )`);
    await q.query(`CREATE TABLE party_outbox (
      id uuid PRIMARY KEY, "characterId" uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      event varchar NOT NULL, payload jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "publishedAt" timestamptz
    )`);
    await q.query(`CREATE INDEX party_outbox_pending ON party_outbox("createdAt") WHERE "publishedAt" IS NULL`);
  }
  async down(): Promise<void> { throw new Error('Party migration is forward-only; restore audited backup with consumers stopped'); }
}
