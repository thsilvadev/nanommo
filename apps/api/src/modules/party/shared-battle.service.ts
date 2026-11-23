import { guardEncounterDeadline } from './party-deadline';
import { Inject, forwardRef, BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID, createHash } from 'crypto';
import { BattleEngine, Mulberry32, mulberry32Seed, rngForIndex, resolveRewards, persistStatusEffectsAtCheckpoint, masteryLevelForXp, calculateMasteryXpAwards, calculateFleeChancePercent, TOWN_MAP_ID } from '@nanommo/shared';
import { GambitService } from '../gambit/gambit.service';
import * as Shared from '@nanommo/shared';
import { Character, InventoryItem, GambitPage, MapKillCounter, WeaponProficiency, EquippedItem } from '../../database/entities';
import { BattleService, applyLevelXpResolution } from '../battle/battle.service';
import { DataService } from '../data/data.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuestService } from '../quests/quest.service';
import { getMasteryXpPolicy } from '../../config/mastery-xp-policy';
import type { PartyContext } from './party.service';

@Injectable()
export class SharedBattleService {
  constructor(@InjectDataSource() private readonly db:DataSource, @Inject(forwardRef(() => BattleService)) private readonly battle:BattleService,private readonly data:DataService,private readonly inventory:InventoryService,private readonly quests:QuestService, private readonly gambits:GambitService){}
  private async event(manager:EntityManager,id:string,event:string,payload:any){await manager.query('INSERT INTO party_outbox(id,"characterId",event,payload) VALUES($1,$2,$3,$4)',[randomUUID(),id,event,JSON.stringify(payload)]);}
  private async inventoryMap(manager:EntityManager,id:string){const result:Record<string,number>={};for(const row of await manager.getRepository(InventoryItem).findBy({characterId:id,location:'inventory'}))result[row.itemId]=(result[row.itemId]??0)+Number(row.quantity);return result;}
  async start(ctx:PartyContext,clock:any){
    const p=ctx.party!;
    const actors:any[]=[];
    const roster:any[]=[];
    const startAt=new Date(clock.dueAt).getTime();
    for(const member of ctx.members){
      const c=ctx.characters.find(c=>c.id===member.characterId)!;
      if(c.hpCurrent<=0)throw new BadRequestException('KO member cannot start encounter');
      const snapshot=await this.battle.buildCharacterSnapshot(c,c.hpCurrent,c.spCurrent,startAt);
      snapshot.partyLeaderId=p.leaderCharacterId;
      const weapons=snapshot.equippedWeaponTypes??[];
      snapshot.basicAttackDamageType=weapons.includes('bow')?'ranged':weapons.some(w=>['staff','rod'].includes(w))?'magic':'melee';
      snapshot.basicAttackRange=snapshot.basicAttackDamageType==='melee'?0:8;
      const gambits=c.activeGambitPageId?await ctx.manager.getRepository(GambitPage).findOneBy({id:c.activeGambitPageId,characterId:c.id}):null;
      actors.push({id:c.id,name:c.name,orderIndex:member.orderIndex,kind:'character',team:'a',position:{row:0,column:0},snapshot,gambits,inventory:await this.inventoryMap(ctx.manager,c.id)});
      let counter=await ctx.manager.getRepository(MapKillCounter).findOneBy({characterId:c.id,mapId:p.mapId});
      if(!counter)counter=await ctx.manager.getRepository(MapKillCounter).save(ctx.manager.getRepository(MapKillCounter).create({characterId:c.id,mapId:p.mapId,epoch:0,mapKillCount:0,perMonsterKillCount:{}}));
      const pool=this.data.getMonstersInMap(p.mapId);if(!pool.length)throw new BadRequestException('Empty encounter roster');
      const mon=rngForIndex(mulberry32Seed(`${c.id}:${p.mapId}:${counter.epoch}`),Number(counter.mapKillCount)).weightedPick(pool);
      roster.push({characterId:c.id,monsterId:mon.id,epoch:counter.epoch,killIndex:counter.mapKillCount});
      const add=(def:any,index:number)=>actors.push({id:`monster:${c.id}:${index}`,name:def.name,definitionId:def.id,orderIndex:member.orderIndex+(index?10:0),principalActorId:c.id,encounterRole:index?'raid':'principal',kind:'monster',team:'b',position:{row:0,column:9},snapshot:BattleEngine.buildMonsterSnapshot(def),gambits:def.gambit??def.gambits??[],inventory:{},attackIntervalTicks:Number(def.atkSpeedTicks??6),damageTakenMultiplier:def.damageTakenMultiplier,weaponCategoryDamageTakenMultiplier:def.weaponCategoryDamageTakenMultiplier});
      add(mon,0);
      const candidates=this.data.getMapById(p.mapId)?.monsters.find((m:any)=>m.monsterId===mon.id)?.raid?.candidates??[];
      const roll=new Mulberry32(`${clock.seed}:${c.id}:raid`).nextPercent();let cumulative=0;
      for(const candidate of candidates){cumulative+=Number(candidate.chance);if(roll<cumulative){add(this.data.getMonsterById(candidate.monsterId),1);break;}}
    }
    // A successful shared avoidance consumes one encounter, never rerolls its reservation.
    const leader=ctx.characters.find(c=>c.id===p.leaderCharacterId)!;
    if(leader.lastGrindStance==='gathering'||p.activity||leader.travelIntent){
      let fight=false;
      for(const actor of actors.filter(a=>a.team==='a'))for(const enemy of actors.filter(a=>a.team==='b')){
        const def=this.data.getMonsterById(enemy.definitionId);if(!def?.isAggressive)continue;
        const chance=calculateFleeChancePercent(Number(actor.snapshot.moveSpeed??0),Number(def.moveSpd??0),Number(actor.snapshot.luk??5));
        if(new Mulberry32(`${clock.seed}:${actor.id}:${enemy.id}:avoid`).nextPercent()>=chance)fight=true;
      }
      if(!fight){await this.advanceCounters(ctx,roster);await ctx.manager.query(`UPDATE encounter_clocks SET status='consumed',roster=$2 WHERE "ownerKind"='party' AND "ownerId"=$1`,[p.id,JSON.stringify(roster)]);return false;}
    }
    const definitions={items:Object.fromEntries(Object.values(this.data.getItems()??{}).flat().filter((x:any)=>x&&typeof x==='object'&&x.id).map((x:any)=>[x.id,x])),skills:Object.fromEntries(this.data.getMonsterSkills().map((x:any)=>[x.id,x])),statuses:Object.fromEntries(this.data.getStatusEffects().map((x:any)=>[x.id,x]))};
    const input:any={version:2,elementalRulesVersion:1,seed:clock.seed,tickDurationMs:500,actors:Shared.placeBattleActors(actors),definitions};
    // Formation is resolved by the pure engine, not by database order.
    const result=Shared.simulateBattleV2(input);
    if(!result.ended)throw new Error('Battle simulation exceeded execution limit; refusing terminal result');
    for(const actor of input.actors)actor.name=result.actorsAfter[actor.id].name;
    const id=randomUUID(),endAt=startAt+Math.max(500,result.durationTicks*500);
    await ctx.manager.query(`INSERT INTO shared_battles(id,"partyId","mapId",seed,"startAt","endAt",state,snapshot,log,result) VALUES($1,$2,$3,$4,to_timestamp($5/1000.0),to_timestamp($6/1000.0),'started',$7,$8,$9)`,[id,p.id,p.mapId,clock.seed,startAt,endAt,JSON.stringify(input),JSON.stringify(result),JSON.stringify({roster})]);
    for(const actor of actors.filter(a=>a.team==='a')){
      await ctx.manager.query('INSERT INTO shared_battle_participants("battleId","characterId",snapshot) VALUES($1,$2,$3)',[id,actor.id,JSON.stringify(input.actors.find((a:any)=>a.id===actor.id))]);
      await ctx.manager.query('INSERT INTO active_battle_participants("characterId","battleId") VALUES($1,$2)',[actor.id,id]);
      const c=ctx.characters.find(c=>c.id===actor.id)!;

      await this.event(ctx.manager,actor.id,'battle:sharedUpdated',{refresh:true,battleId:id,revision:1});
    }
    await ctx.manager.query(`UPDATE encounter_clocks SET status='consumed',roster=$2 WHERE "ownerKind"='party' AND "ownerId"=$1`,[p.id,JSON.stringify(roster)]);
    return true;
  }
  private async advanceCounters(ctx:PartyContext,roster:any[],mapId:string=ctx.party!.mapId){
    for(const entry of roster){const repo=ctx.manager.getRepository(MapKillCounter);const counter=await repo.findOneBy({characterId:entry.characterId,mapId});if(!counter)continue;counter.mapKillCount=Number(counter.mapKillCount)+1;counter.perMonsterKillCount={...(counter.perMonsterKillCount??{}),[entry.monsterId]:Number(counter.perMonsterKillCount?.[entry.monsterId]??0)+1};if(counter.mapKillCount>=10000){counter.mapKillCount=0;counter.epoch++;}await repo.save(counter);}
  }
  async resolve(ctx:PartyContext,row:any,remove:(id:string,reason:string)=>Promise<void>,fled=false,checkpoint?:any){
    // Caller already locked every participant before claiming this shared result.
    const locked=(await ctx.manager.query('SELECT * FROM shared_battles WHERE id=$1 FOR UPDATE',[row.id]))[0];
    if(!locked||!['started','scheduled'].includes(locked.state))return false;
    const result=checkpoint??locked.log,input=locked.snapshot;
    const participants=input.actors.filter((a:any)=>a.kind==='character');
    if(participants.some(a=>!ctx.characters.some(c=>c.id===a.id)))throw new Error('Incomplete participant lock set');
    const alive:string[]=participants.filter(a=>Number(result.actorsAfter[a.id]?.hp)>0).map(a=>a.id).sort();
    const win=!fled&&result.outcome==='win'&&alive.length>0;
    const awards:Record<string,{xp:number;drops:any[]}> = Object.fromEntries(participants.map(a=>[a.id,{xp:0,drops:[]}]));
    if(win){
      let totalXp=0;
      for(const monster of input.actors.filter((a:any)=>a.kind==='monster')){
        const definition=this.data.getMonsterById(monster.definitionId);totalXp+=Number(definition.xpReward??0);
        const rewards=resolveRewards({monster:definition,mapId:locked.mapId,outcome:'win',items:this.data.getItems(),killIndex:Number(locked.result?.roster?.find(r=>monster.id.includes(r.characterId))?.killIndex??0),seed:`${locked.seed}:${monster.id}:drops`,characterLevel:Math.max(...participants.map(a=>a.snapshot.level)),globalItemDrops:this.data.getGlobalItemDrops()?.drops??[]});
        let dropIndex=0;for(const drop of rewards.drops??[])for(let unit=0;unit<drop.quantity;unit++){const recipient=new Mulberry32(`${locked.seed}:${monster.id}:loot:${dropIndex++}`).pick(alive);awards[recipient].drops.push({...drop,quantity:1});}
      }
      alive.forEach((id,index)=>awards[id].xp=Math.floor(totalXp/alive.length)+(index<totalXp%alive.length?1:0));
    }
    for(const actor of participants){
      const c=ctx.characters.find(c=>c.id===actor.id)!,after=result.actorsAfter[actor.id];
      const at=fled?ctx.now:new Date(locked.endAt).getTime();
      for(const [itemId,quantity]of Object.entries(actor.inventory as Record<string,number>)){
        const consumed=Math.max(0,Number(quantity)-Number(after.inventory?.[itemId]??0));
        if(consumed){const have=await this.inventory.getItemCount(c.id,itemId,ctx.manager);if(have<consumed)throw new Error('Reserved combat inventory was mutated');await this.inventory.removeItem(c.id,itemId,consumed,ctx.manager);}
      }
      c.hpCurrent=Math.max(0,Number(after.hp));c.spCurrent=Math.max(0,Number(after.sp));
      c.statusEffects=persistStatusEffectsAtCheckpoint(after.statusEffects??[],Math.max(0,result.durationTicks-1),at,500,fled?new Date(locked.startAt).getTime():undefined);
      c.consumableCooldowns=Object.fromEntries(Object.entries(after.cooldowns??{}).flatMap(([key,ticks])=>Number(ticks)>0?[[key,new Date(at+Number(ticks)*500).toISOString()]]:[]));
      c.diet=(after.foodBuffs??[]).filter(food=>food.remainingTicks>0).map(food=>({itemId:food.itemId,consumedAt:new Date(at).toISOString(),digestUntil:new Date(at+food.remainingTicks*500).toISOString(),dietLevel:Number(after.dietLevelByFood?.[food.itemId]??0)}));
      c.dietLevels={...c.dietLevels,...Object.fromEntries(Object.entries(after.dietLevelByFood??{}).map(([id,level])=>[id,{level:Number(level),lastDigestUntil:new Date(at+Number(after.foodDigestRemainingTicksByItem?.[id]??0)*500).toISOString()}]))};
      c.activeFoodBuff=null;c.resourceRegenAt=new Date(at);
      if(awards[c.id].xp){const xp=applyLevelXpResolution(Number(c.xp),c.level,awards[c.id].xp,level=>this.data.getXpToNextLevel(level));c.xp=xp.xp;c.level=xp.level;c.unspentAttributePoints+=xp.levelsGained*5;c.hpCurrent=Math.min(actor.snapshot.maxHp+xp.levelsGained*5,c.hpCurrent+xp.levelsGained*5);c.spCurrent=Math.min(actor.snapshot.maxSp+xp.levelsGained*2,c.spCurrent+xp.levelsGained*2);}
      if(!fled){
        const mastery=Shared.calculateGroupMasteryXpAwards(input,result,getMasteryXpPolicy())[c.id]??{};
        for(const [category,xp]of Object.entries(mastery)){const repo=ctx.manager.getRepository(WeaponProficiency);let prof=await repo.findOneBy({characterId:c.id,weaponType:category});if(!prof)prof=repo.create({characterId:c.id,weaponType:category,xp:0,level:0,spentSkillPoints:0,skillRanks:{}});prof.xp=Number(prof.xp)+xp;prof.level=masteryLevelForXp(prof.xp);await repo.save(prof);}
      }
      const grantedDrops:any[]=[];
      for(const drop of awards[c.id].drops){
        if(await this.inventory.canFitInventoryDrop(c.id,drop.itemId,1,ctx.manager)){
          await this.inventory.addItem(c.id,drop.itemId,1,'inventory',drop.instanceData,ctx.manager);
          c.knownItemIds=[...new Set([...(c.knownItemIds??[]),drop.itemId])];
          grantedDrops.push(drop);
        }
      }
      // Results and outbox reflect grants, not rolls discarded for capacity.
      awards[c.id].drops=grantedDrops;
      if(win&&alive.includes(c.id))for(const monster of input.actors.filter(a=>a.kind==='monster'))await this.quests.recordBattleVictory(ctx.manager,c,{id:`${locked.id}:${monster.id}`,monsterId:monster.definitionId,mapId:locked.mapId,endAt:new Date(at)},true);
      if(c.hpCurrent<=0){c.hpCurrent=1;c.spCurrent=0;c.currentMapId=c.savedTownMapId??TOWN_MAP_ID;c.status='town';c.travelIntent=null;c.lastDeathLog={version:2,battleId:locked.id,log:locked.log};await remove(c.id,'death');}
      await ctx.manager.getRepository(Character).save(c);
      await ctx.manager.query('UPDATE shared_battle_participants SET result=$3 WHERE "battleId"=$1 AND "characterId"=$2',[locked.id,c.id,JSON.stringify({...awards[c.id],hp:c.hpCurrent,sp:c.spCurrent})]);
      await this.event(ctx.manager,c.id,'battle:sharedUpdated',{refresh:true,battleId:locked.id,revision:Number(locked.revision)+1,state:fled?'fled':'resolved'});
      await this.event(ctx.manager,c.id,'party:updated',{refresh:true});
      await this.event(ctx.manager,c.id,'battle:resolved',{hydrate:true,entryId:locked.id,startAt:locked.startAt,endAt:fled?new Date(ctx.now):locked.endAt,tickDurationMs:500,outcome:win?'win':'loss',xpGain:awards[c.id].xp,goldGain:0,drops:awards[c.id].drops,cancelled:fled,cancellationReason:fled?'flee':undefined});
    }
    await this.advanceCounters(ctx,locked.result?.roster??[],locked.mapId);
    await ctx.manager.query('DELETE FROM active_battle_participants WHERE "battleId"=$1',[locked.id]);
    await ctx.manager.query('UPDATE shared_battles SET state=$2,revision=revision+1,result=$3 WHERE id=$1',[locked.id,fled?'fled':'resolved',JSON.stringify({awards,checkpoint:fled?checkpoint:null,roster:locked.result?.roster??[]})]);
    return true;
  }
  async publicBattle(characterId:string){
    const row=(await this.db.query(`SELECT b.* FROM shared_battles b JOIN shared_battle_participants a ON a."battleId"=b.id WHERE a."characterId"=$1 ORDER BY b."startAt" DESC LIMIT 1`,[characterId]))[0];
    if(!row)return null;
    const actorDurations = new Map<string, Record<string, number>>(row.snapshot.actors.map((actor: any) => [actor.id,
      Shared.combatCooldownDurations({...actor.snapshot, skillDefs:{...row.snapshot.definitions?.skills,...actor.snapshot.skillDefs}}, row.snapshot.definitions?.items),
    ]));
    const actors = row.snapshot.actors.map((actor: any) => {
      const durations = actorDurations.get(actor.id)!;
      const cooldowns = Object.fromEntries(Object.entries(actor.snapshot.cooldowns ?? {}).filter(([key, ticks]) => Number(ticks)>0 && Number(durations[key])>0));
      return {
        id:actor.id,name:actor.name,kind:actor.kind,team:actor.team,position:actor.position,
        ...(actor.kind==='monster'?{definitionId:actor.definitionId}:{}),
        snapshot:{hp:actor.snapshot.hp,sp:actor.snapshot.sp,maxHp:actor.snapshot.maxHp,maxSp:actor.snapshot.maxSp,
          atk:actor.snapshot.atk,matk:actor.snapshot.matk,def:actor.snapshot.def,mdefPercent:actor.snapshot.mdefPercent,
          accuracy:actor.snapshot.accuracy,evasion:actor.snapshot.evasion,critChance:actor.snapshot.critChance,
          statusEffects:actor.snapshot.statusEffects,cooldowns,
          cooldownDurations:Object.fromEntries(Object.entries(durations).filter(([key])=>key in cooldowns))},
      };
    });
    // Older immutable logs predate action timer metadata. Derive it from that
    // encounter's effective definitions, never from today's rank-one catalogue.
    const events = row.log.events.map((event: any) => {
      if (!['use_skill', 'use_item'].includes(event.action) || event.payload?.cooldown) return event;
      const actor = row.snapshot.actors.find((value: any) => value.id === event.actorId);
      if (!actor) return event;
      const payload = event.payload ?? {};
      const key = event.action === 'use_skill' ? `skill:${payload.skillId}`
        : Shared.consumableCooldownKey(row.snapshot.definitions?.items?.[payload.itemId], payload.itemId);
      const durations = actorDurations.get(actor.id)!;
      const durationTicks = durations[key] ?? 0;
      return durationTicks > 0 ? {...event, payload:{...payload, cooldown:{key,durationTicks}}} : event;
    });
    const actorsAfter=Object.fromEntries(Object.entries(row.log.actorsAfter).map(([id,a]:[string,any])=>[id,{hp:a.hp,sp:a.sp,position:a.position,statusEffects:a.statusEffects,targetId:a.targetId}]));
    // Only public combat timers cross this boundary; inventory, Gambits and Diet stay private.
    return {id:row.id,revision:Number(row.revision),partyId:row.partyId,mapId:row.mapId,startAt:row.startAt,endAt:row.endAt,state:row.state,snapshot:{version:2,tickDurationMs:500,actors},log:{version:2,outcome:row.log.outcome,events,durationTicks:row.log.durationTicks,actorsAfter}};
  }
  async flee(ctx:PartyContext,leaderId:string,remove:(id:string,reason:string)=>Promise<void>){
    const row=(await ctx.manager.query(`SELECT b.* FROM shared_battles b JOIN active_battle_participants a ON a."battleId"=b.id WHERE a."characterId"=$1 FOR UPDATE OF b`,[leaderId]))[0];if(!row)throw new BadRequestException('No active shared battle');
    if(new Date(row.endAt).getTime()<=ctx.now)throw new BadRequestException('Battle has already ended');
    const tick=Math.max(0,Math.min(row.log.durationTicks,Math.floor((ctx.now-new Date(row.startAt).getTime())/500)));
    const state=Shared.replayBattleV2(row.snapshot,tick);
    if(state.actorsAfter[leaderId].hp<=0)throw new BadRequestException('KO leader cannot flee');
    const c=ctx.characters.find(c=>c.id===leaderId)!;
    if(c.fleeNextAttemptAt&&c.fleeNextAttemptAt.getTime()>ctx.now)throw new BadRequestException('Flee is on cooldown');
    c.fleeNextAttemptAt=new Date(ctx.now+10000);
    const attempt=c.fleeAttemptIndex++;let success=true;
    for(const a of row.snapshot.actors.filter(a=>a.team==='a')){
      const current=state.actorsAfter[a.id];if(current.hp<=0)continue;
      for(const enemy of row.snapshot.actors.filter(e=>e.team==='b'&&state.actorsAfter[e.id].hp>0&&state.actorsAfter[e.id].targetId===a.id)){
        const chance=calculateFleeChancePercent(Number(a.snapshot.moveSpeed??0),Number(enemy.snapshot.moveSpeed??0),Number(a.snapshot.luk??5));
        if(new Mulberry32(`${row.seed}:flee:${attempt}:${a.id}:${enemy.id}`).nextPercent()>=chance)success=false;
      }
    }
    await ctx.manager.getRepository(Character).save(c);
    if(success)await this.resolve(ctx,row,remove,true,state);
    else await this.event(ctx.manager,leaderId,'party:actionUpdated',{status:'failed',message:'Flee failed'});
  }
  async enqueue(ctx:PartyContext,id:string,requestId:string,kind:string,payload:any){
    if(!['equip','unequip','use_item','gambit_update','gambit_activate','attributes'].includes(kind))throw new BadRequestException('Unsupported action');
    if(!requestId||requestId.length>100||!payload||typeof payload!=='object'||Array.isArray(payload))throw new BadRequestException('Invalid action');
    const exists=await ctx.manager.query('SELECT id FROM character_action_intents WHERE "characterId"=$1 AND "clientRequestId"=$2',[id,requestId]);if(exists.length)return;
    if(kind==='use_item')await this.inventory.validateQueuedConsumable(id,String(payload.itemId??''),ctx.manager,ctx.now);
    const count=Number((await ctx.manager.query(`SELECT count(*) AS n FROM character_action_intents WHERE "characterId"=$1 AND status='pending'`,[id]))[0].n);if(count>=32)throw new BadRequestException({code:'ACTION_QUEUE_FULL',message:'Too many pending actions'});
    const sequence=Number((await ctx.manager.query('SELECT coalesce(max(sequence),0)+1 AS n FROM character_action_intents WHERE "characterId"=$1',[id]))[0].n);
    await ctx.manager.query(`INSERT INTO character_action_intents(id,"characterId","clientRequestId",sequence,kind,payload,status) VALUES($1,$2,$3,$4,$5,$6,'pending')`,[randomUUID(),id,requestId,sequence,kind,JSON.stringify(payload)]);
  }
  async drain(ctx:PartyContext){
    const ids=ctx.characters.map(c=>c.id);
    const active=await ctx.manager.query('SELECT 1 FROM active_battle_participants WHERE "characterId"=ANY($1::uuid[]) LIMIT 1',[ids]);if(active.length)return;
    const legacy=await ctx.manager.query(`SELECT 1 FROM battle_queue_entries WHERE "characterId"=ANY($1::uuid[]) AND NOT resolved AND "startAt"<=to_timestamp($2/1000.0) + interval '50 milliseconds' LIMIT 1`,[ids,ctx.now]);if(legacy.length)return;
    const due=await ctx.manager.query(`SELECT 1 FROM encounter_clocks WHERE status='searching' AND "dueAt"<=to_timestamp($2/1000.0) + interval '50 milliseconds' AND (("ownerKind"='party' AND "ownerId"=$3) OR ("ownerKind"='character' AND "ownerId"=ANY($1::uuid[]))) LIMIT 1`,[ids,ctx.now,ctx.party?.id??null]);if(due.length)return;
    const pending=await ctx.manager.query(`SELECT * FROM character_action_intents WHERE "characterId"=ANY($1::uuid[]) AND status='pending' AND "createdAt" <= to_timestamp($2/1000.0) ORDER BY "characterId",sequence FOR UPDATE`,[ids,ctx.now]);
    for(const intent of pending){
      // Savepoint contains both command mutation and its status; a rejected command cannot poison the next.
      await ctx.manager.query('SAVEPOINT action_execution');
      try{
        await guardEncounterDeadline(ctx.manager, [intent.characterId], ctx.party?.id ?? null);
        await this.apply(ctx,intent);
        const now=Number((await ctx.manager.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now'))[0].now);
        const late=await ctx.manager.query(`SELECT 1 FROM encounter_clocks WHERE status='searching' AND "dueAt"<=to_timestamp(($2::double precision+50)/1000.0) AND (("ownerKind"='party' AND "ownerId"=$3) OR ("ownerKind"='character' AND "ownerId"=$1)) LIMIT 1`,[intent.characterId,now,ctx.party?.id??null]);
        if(late.length){await ctx.manager.query('ROLLBACK TO SAVEPOINT action_execution');break;}
        await ctx.manager.query(`UPDATE character_action_intents SET status='applied',result=$2,"completedAt"=clock_timestamp() WHERE id=$1`,[intent.id,JSON.stringify({message:'Applied'})]);
      }catch(e){await ctx.manager.query('ROLLBACK TO SAVEPOINT action_execution');await ctx.manager.query(`UPDATE character_action_intents SET status='failed',result=$2,"completedAt"=clock_timestamp() WHERE id=$1`,[intent.id,JSON.stringify({message:e.message??'Action failed'})]);}
      await ctx.manager.query('RELEASE SAVEPOINT action_execution');
      // Refresh the in-memory Character after a command or rollback.
      const c=await ctx.manager.getRepository(Character).findOneBy({id:intent.characterId});ctx.characters[ctx.characters.findIndex(row=>row.id===c!.id)]=c!;
      if(!ctx.party)await ctx.manager.query('DELETE FROM battle_queue_entries WHERE \"characterId\"=$1 AND NOT resolved AND \"startAt\">clock_timestamp()',[intent.characterId]);
      await this.event(ctx.manager,intent.characterId,'party:actionUpdated',{refresh:true,id:intent.id});
    }
  }
  private async apply(ctx:PartyContext,intent:any){
    const id=intent.characterId,p=intent.payload,c=await ctx.manager.getRepository(Character).findOneBy({id});if(!c)throw new BadRequestException('Character missing');
    if(intent.kind==='use_item'){await this.inventory.useConsumable(id,String(p.itemId??''),ctx.manager,ctx.now);return;}
    if(intent.kind==='gambit_activate'||intent.kind==='gambit_update'){
      const page=await ctx.manager.getRepository(GambitPage).findOneBy({id:String(p.pageId??''),characterId:id});if(!page)throw new BadRequestException('Gambit page not found');
      if(intent.kind==='gambit_activate')c.activeGambitPageId=page.id;
      else {
        if (p.title !== undefined) {
          if (typeof p.title !== 'string' || p.title.trim().length === 0 || p.title.length > 30) throw new BadRequestException('Invalid Gambit title');
          page.title = p.title;
        }
        if (p.slotIndex !== undefined) {
          if (!Number.isInteger(p.slotIndex) || p.slotIndex < 0 || p.slotIndex > 2) throw new BadRequestException('Invalid Gambit slot');
          const other = await ctx.manager.getRepository(GambitPage).findOneBy({characterId:id,slotIndex:p.slotIndex});
          if (other && other.id !== page.id) throw new BadRequestException('Gambit slot already occupied');
          page.slotIndex = p.slotIndex;
        }
        if (p.lines !== undefined) {
          if (!Array.isArray(p.lines) || p.lines.length > 20) throw new BadRequestException('Invalid Gambit lines');
          await this.gambits.assertValidGambitPage(p.lines);
          page.lines = this.gambits.canonicalizeLines(p.lines);
        }
        await ctx.manager.getRepository(GambitPage).save(page);
      }
    }else if(intent.kind==='attributes'){
      let spend=0;for(const key of Object.keys(p)){if(!['str','agi','dex','vit','int','luk'].includes(key)||!Number.isInteger(p[key])||p[key]<0)throw new BadRequestException('Invalid attributes');spend+=p[key];}
      if(spend<1||spend>c.unspentAttributePoints)throw new BadRequestException('Not enough attribute points');for(const [key,n]of Object.entries(p))c[key]+=Number(n);c.unspentAttributePoints-=spend;
    }else{
      const repo=ctx.manager.getRepository(EquippedItem),inv=ctx.manager.getRepository(InventoryItem);
      const slots=['head','body','mainHand','offHand','shoes','cape','accessoryLeft','accessoryRight'];if(!slots.includes(p.slot))throw new BadRequestException('Invalid equipment slot');
      const current=await repo.findOneBy({characterId:id,slot:p.slot});
      if(intent.kind==='unequip'){
        if(p.slot==='mainHand'&&await repo.findOneBy({characterId:id,slot:'offHand'}))throw new BadRequestException('Remove secondary item first');
        if(current){await this.inventory.addItem(id,current.itemId,1,'inventory',current.instanceData,ctx.manager);await repo.delete(current.id);}
      }else{
        const source=await inv.findOne({where:p.inventoryItemId?{id:p.inventoryItemId,characterId:id,location:'inventory',itemId:p.itemId}:{characterId:id,location:'inventory',itemId:p.itemId},order:{slotIndex:'ASC'}});
        const def=this.data.getItemById(p.itemId);if(!source||def?.type!=='equipment'||c.level<Number(def.levelReq??1))throw new BadRequestException('Unavailable equipment');
        if(!(def.slot===p.slot||(p.slot==='offHand'&&def.secondaryHand)||(def.slot==='accessory'&&p.slot.startsWith('accessory'))))throw new BadRequestException('Incompatible slot');
        const main=await repo.findOneBy({characterId:id,slot:'mainHand'});
        if(p.slot==='offHand'&&(!main||this.data.getItemById(main.itemId)?.twoHanded))throw new BadRequestException('Incompatible weapon combination');
        if(p.slot==='mainHand'&&def.twoHanded){const off=await repo.findOneBy({characterId:id,slot:'offHand'});if(off){await this.inventory.addItem(id,off.itemId,1,'inventory',off.instanceData,ctx.manager);await repo.delete(off.id);}}
        const off=await repo.findOneBy({characterId:id,slot:'offHand'});const errors=Shared.validateHandLoadout(p.slot==='mainHand'?def:main?this.data.getItemById(main.itemId):null,p.slot==='offHand'?def:p.slot==='mainHand'&&def.twoHanded?null:off?this.data.getItemById(off.itemId):null);if((p.slot==='mainHand'||p.slot==='offHand')&&errors.length)throw new BadRequestException(errors.join(', '));
        const incomingInstance=source.instanceData??null;
        if(current){source.itemId=current.itemId;source.instanceData=current.instanceData??null;source.quantity=1;await inv.save(source);current.itemId=p.itemId;current.instanceData=incomingInstance;await repo.save(current);}else{await inv.delete(source.id);await repo.save(repo.create({characterId:id,slot:p.slot,itemId:p.itemId,instanceData:incomingInstance}));}
      }
    }
    await ctx.manager.getRepository(Character).save(c);
  }
}
