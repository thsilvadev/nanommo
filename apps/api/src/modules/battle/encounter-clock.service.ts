import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

export interface SoloEncounterReservation {
  ownerKind: 'character';
  ownerId: string;
  mapId: string;
  cycle: number | string;
  searchStartedAt: Date | string;
  dueAt: Date | string;
  seed: string;
  generation: number | string;
  status: 'searching' | 'consumed' | 'cancelled';
  roster: Array<{ characterId: string; monsterId: string; sequenceIndex: number; projectionId?: string }>;
}

/** Search reservations outlive disposable simulation rows and never reroll on a loadout edit. */
@Injectable()
export class EncounterClockService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async current(characterId: string, mapId: string, manager: EntityManager = this.db.manager): Promise<SoloEncounterReservation | null> {
    const row = (await manager.query(`SELECT * FROM encounter_clocks WHERE "ownerKind"='character' AND "ownerId"=$1 AND "mapId"=$2 AND status='searching'`, [characterId, mapId]))[0];
    return row?.status === 'searching' && row.mapId === mapId ? row : null;
  }

  async reserveProjection(entry: any, manager?: EntityManager): Promise<SoloEncounterReservation | null> {
    const dueAt = new Date(entry.startAt);
    const searchStartedAt = new Date(entry.log?.searchStartAt ?? entry.startAt);
    if (!entry.characterId || !entry.mapId || !entry.monsterId || !entry.seedUsed || !Number.isFinite(dueAt.getTime()) || !Number.isFinite(searchStartedAt.getTime())) return null;
    const apply = async (tx: EntityManager): Promise<SoloEncounterReservation> => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`character:${entry.characterId}`]);
      const existing = (await tx.query(`SELECT * FROM encounter_clocks WHERE "ownerKind"='character' AND "ownerId"=$1 FOR UPDATE`, [entry.characterId]))[0];
      if (existing?.status === 'searching' && existing.mapId === entry.mapId) return existing;
      const roster = [{ characterId: entry.characterId, monsterId: entry.monsterId, sequenceIndex: Number(entry.sequenceIndex ?? 0), ...(entry.id ? { projectionId: entry.id } : {}) }];
      return (await tx.query(`INSERT INTO encounter_clocks("ownerKind","ownerId","mapId","searchStartedAt","dueAt",seed,roster,status)
        VALUES('character',$1,$2,$3,$4,$5,$6,'searching')
        ON CONFLICT("ownerKind","ownerId") DO UPDATE SET "mapId"=EXCLUDED."mapId", "searchStartedAt"=EXCLUDED."searchStartedAt", "dueAt"=EXCLUDED."dueAt", seed=EXCLUDED.seed, roster=EXCLUDED.roster, status='searching', cycle=encounter_clocks.cycle+1, generation=encounter_clocks.generation+1
        RETURNING *`, [entry.characterId, entry.mapId, searchStartedAt, dueAt, entry.seedUsed, JSON.stringify(roster)]))[0];
    };
    return manager ? apply(manager) : this.db.transaction(apply);
  }

  /** Match immutable identity rather than projection ID, because projections may have been replaced. */
  async consumeProjection(entry: any, manager?: EntityManager): Promise<boolean> {
    if (!entry.characterId || !entry.seedUsed || !Number.isFinite(new Date(entry.startAt).getTime())) return false;
    const tx = manager ?? this.db.manager;
    const rows = await tx.query(`UPDATE encounter_clocks SET status='consumed' WHERE "ownerKind"='character' AND "ownerId"=$1 AND seed=$2 AND "dueAt"=$3 AND status='searching' RETURNING "ownerId"`, [entry.characterId, entry.seedUsed, new Date(entry.startAt)]);
    return rows.length > 0;
  }
}
