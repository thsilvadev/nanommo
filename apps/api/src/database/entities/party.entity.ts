import { Check, Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

// Runtime associations are managed by the ordered transactional Party gateway.
// The forward-only migration owns the foreign keys and deployment lifecycle.
@Entity('parties')
@Index('parties_map_kind', ['mapId', 'kind'])
@Check(`kind IN ('manual','auto')`)
export class Party {
  @PrimaryColumn('uuid') id!: string;
  @Column('varchar') kind!: 'manual' | 'auto';
  @Column('uuid') leaderCharacterId!: string;
  @Column('varchar') mapId!: string;
  @Column({ type: 'bigint', default: 1 }) revision!: string;
  @Column({ type: 'jsonb', nullable: true }) activity!: Record<string, unknown> | null;
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' }) createdAt!: Date;
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' }) updatedAt!: Date;
}

@Entity('party_members')
@Unique(['characterId'])
@Unique(['partyId', 'orderIndex'], { deferrable: 'INITIALLY DEFERRED' })
@Check(`"orderIndex" BETWEEN 0 AND 4`)
export class PartyMember {
  @PrimaryColumn('uuid') partyId!: string;
  @PrimaryColumn('uuid') characterId!: string;
  @Column('smallint') orderIndex!: number;
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' }) joinedAt!: Date;
  @Column({ type: 'boolean', default: false }) pendingLeave!: boolean;
  @Column({ type: 'varchar', nullable: true }) reason!: string | null;
}

@Entity('party_invites')
@Index('party_invites_pending', ['candidateId', 'status'])
@Unique(['inviterId', 'clientRequestId'])
@Check(`mode IN ('manual','auto')`)
@Check(`status IN ('offered','accepted','cancelled','expired','joined')`)
@Check(`"inviterId"<>"candidateId"`)
export class PartyInvite {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') inviterId!: string;
  @Column('uuid') candidateId!: string;
  @Column({ type: 'uuid', nullable: true }) partyId!: string | null;
  @Column('varchar') mode!: 'manual' | 'auto';
  @Column('varchar') status!: 'offered' | 'accepted' | 'cancelled' | 'expired' | 'joined';
  @Column('timestamptz') expiresAt!: Date;
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' }) createdAt!: Date;
  @Column({ type: 'bigint', default: 1 }) revision!: string;
  @Column('varchar') clientRequestId!: string;
}

@Entity('character_action_intents')
@Unique(['characterId', 'clientRequestId'])
@Unique(['characterId', 'sequence'])
@Check(`status IN ('pending','applied','failed','cancelled')`)
export class CharacterActionIntent {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') characterId!: string;
  @Column('varchar') clientRequestId!: string;
  @Column('bigint') sequence!: string;
  @Column('varchar') kind!: string;
  @Column('jsonb') payload!: Record<string, unknown>;
  @Column('varchar') status!: 'pending' | 'applied' | 'failed' | 'cancelled';
  @Column({ type: 'jsonb', nullable: true }) result!: Record<string, unknown> | null;
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' }) createdAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) completedAt!: Date | null;
}

@Entity('encounter_clocks')
@Check(`"ownerKind" IN ('character','party')`)
@Check(`status IN ('searching','consumed','cancelled')`)
export class EncounterClock {
  @PrimaryColumn('varchar') ownerKind!: 'character' | 'party';
  @PrimaryColumn('uuid') ownerId!: string;
  @Column('varchar') mapId!: string;
  @Column({ type: 'bigint', default: 0 }) cycle!: string;
  @Column('timestamptz') searchStartedAt!: Date;
  @Column('timestamptz') dueAt!: Date;
  @Column('varchar') seed!: string;
  @Column({ type: 'bigint', default: 1 }) generation!: string;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) roster!: Array<Record<string, unknown>>;
  @Column('varchar') status!: 'searching' | 'consumed' | 'cancelled';
}

@Entity('shared_battles')
@Check(`"engineVersion"=2`)
@Check(`state IN ('scheduled','started','resolved','fled')`)
export class SharedBattle {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'smallint', default: 2 }) engineVersion!: number;
  @Column({ type: 'uuid', nullable: true }) partyId!: string | null;
  @Column('varchar') mapId!: string;
  @Column('varchar') seed!: string;
  @Column('timestamptz') startAt!: Date;
  @Column('timestamptz') endAt!: Date;
  @Column('varchar') state!: 'scheduled' | 'started' | 'resolved' | 'fled';
  @Column('jsonb') snapshot!: Record<string, unknown>;
  @Column('jsonb') log!: Record<string, unknown>;
  @Column({ type: 'jsonb', nullable: true }) result!: Record<string, unknown> | null;
  @Column({ type: 'bigint', default: 1 }) revision!: string;
}

@Entity('shared_battle_participants')
export class SharedBattleParticipant {
  @PrimaryColumn('uuid') battleId!: string;
  @PrimaryColumn('uuid') characterId!: string;
  @Column('jsonb') snapshot!: Record<string, unknown>;
  @Column({ type: 'jsonb', nullable: true }) result!: Record<string, unknown> | null;
}

@Entity('active_battle_participants')
export class ActiveBattleParticipant {
  @PrimaryColumn('uuid') characterId!: string;
  @Column('uuid') battleId!: string;
}

@Entity('party_outbox')
@Index('party_outbox_pending', ['createdAt'], { where: '"publishedAt" IS NULL' })
export class PartyOutbox {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') characterId!: string;
  @Column('varchar') event!: string;
  @Column('jsonb') payload!: Record<string, unknown>;
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' }) createdAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) publishedAt!: Date | null;
}
