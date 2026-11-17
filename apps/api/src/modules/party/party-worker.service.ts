import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { BattleQueueGateService } from '../battle/battle-queue-gate.service';
import { CharacterService } from '../character/character.service';
import { InventoryService } from '../inventory/inventory.service';
import { BattleService } from '../battle/battle.service';
import { PartyService } from './party.service';

/** DB deadlines and the outbox are authority. This recoverable pulse only wakes processing. */
@Injectable()
export class PartyWorkerService implements OnApplicationBootstrap,OnModuleDestroy {
  private timer:NodeJS.Timeout|null=null;
  private running=false;
  private readonly logger=new Logger(PartyWorkerService.name);
  constructor(@InjectDataSource()private readonly db:DataSource,private readonly party:PartyService,private readonly gate:BattleQueueGateService,@Inject(REDIS_CLIENT)private readonly redis:Redis,private readonly characters:CharacterService,private readonly inventory:InventoryService,private readonly battle:BattleService){}
  onApplicationBootstrap(){
    if(process.env.BATTLE_QUEUE_MAINTENANCE_ONLY==='true')return;
    this.timer=setInterval(()=>{void this.pulse().catch(e=>this.logger.error('Party recovery pulse failed',e?.stack??String(e)));},500);this.timer.unref();
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async pulse(){
    if(this.running||!this.gate.isLocallyReady())return;
    this.running=true;
    try{
      await this.gate.assertReadyForProcessing();
      const parties=await this.db.query('SELECT id FROM parties ORDER BY "createdAt",id');
      for(const p of parties)try{await this.party.tickParty(p.id);}catch(error){this.logger.error(`Party ${p.id} recovery failed`,error instanceof Error?error.stack:String(error));}
      await this.party.tryAccepted();await this.party.matchmake();
      // Solo commands queued while a legacy battle was active also survive restart.
      const solo=await this.db.query(`SELECT DISTINCT i."characterId" FROM character_action_intents i LEFT JOIN party_members m ON m."characterId"=i."characterId" WHERE i.status='pending' AND m."characterId" IS NULL`);
      for(const row of solo)await this.party.enqueueDrain(row.characterId);
      const needsQueue=await this.db.query(`SELECT c.id FROM characters c LEFT JOIN party_members p ON p."characterId"=c.id WHERE c.status='grinding' AND c."pendingMapTransition" IS NULL AND c."travelIntent" IS NULL AND p."characterId" IS NULL AND NOT EXISTS (SELECT 1 FROM battle_queue_entries b WHERE b."characterId"=c.id AND NOT b.resolved) LIMIT 100`);
      for(const c of needsQueue)try{await this.battle.queueBattles(c.id);}catch(error){this.logger.error(`Solo queue recovery failed for ${c.id}`,error instanceof Error?error.stack:String(error));}
      const events=await this.db.query('SELECT * FROM party_outbox WHERE "publishedAt" IS NULL ORDER BY "createdAt",id LIMIT 200');
      for(const event of events){if(event.payload.hydrate){const c=await this.characters.getCharacterDtoById(event.characterId);event.payload={...event.payload,hydrate:undefined,stateRevision:c?.stateVersion,characterAfter:c,inventoryAfter:await this.inventory.getInventory(event.characterId)};}await this.redis.publish(`gateway:${event.event}:${event.characterId}`,JSON.stringify(event.payload));await this.db.query('UPDATE party_outbox SET "publishedAt"=clock_timestamp() WHERE id=$1 AND "publishedAt" IS NULL',[event.id]);}
    }finally{this.running=false;}
  }
}
