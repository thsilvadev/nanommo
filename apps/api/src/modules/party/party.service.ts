import { guardEncounterDeadline, PARTY_DEADLINE_REACHED } from './party-deadline';
import { Inject, forwardRef, BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { randomUUID } from 'crypto';
import { Character, User, BattleQueueEntry, InventoryItem, GambitPage, MapKillCounter, EquippedItem } from '../../database/entities';
import { Mulberry32, rngForIndex, mulberry32Seed, TOWN_MAP_ID, findCardinalRoute, calculateTravelDurationSeconds, isInstantTownExitEdge } from '@nanommo/shared';
import { BattleService, calculateEncounterSearchDelayMs } from '../battle/battle.service';
import { DataService } from '../data/data.service';
import { assertPartyJoin, nextPartyLeader, advanceTeleport } from './party-policy';
import { SharedBattleService } from './shared-battle.service';

export interface PartyRow { id: string; kind: 'manual'|'auto'; leaderCharacterId: string; mapId: string; revision: string|number; activity: any }
export interface PartyMemberRow { partyId: string; characterId: string; orderIndex: number; pendingLeave: boolean; reason?: string }
export interface PartyContext { manager: EntityManager; characters: Character[]; party: PartyRow|null; members: PartyMemberRow[]; now: number }
class MembershipChanged extends Error {}

@Injectable()
export class PartyService {
  constructor(@InjectDataSource() private readonly db: DataSource, @Inject(forwardRef(() => BattleService)) private readonly battle: BattleService, private readonly data: DataService, private readonly shared: SharedBattleService) {}

  async member(characterId: string, manager: EntityManager = this.db.manager): Promise<PartyMemberRow|null> {
    return (await manager.query('SELECT * FROM party_members WHERE "characterId"=$1',[characterId]))[0] ?? null;
  }

  /** Discovery is optimistic; composition is re-read after every ordered advisory/row lock. */
  async serialized<T>(characterIds: string[], operation: (ctx: PartyContext) => Promise<T>): Promise<T> {
    for (let attempt=0; attempt<8; attempt++) {
      const discovered: PartyMemberRow[] = await this.db.query(`SELECT * FROM party_members WHERE "partyId" IN (SELECT "partyId" FROM party_members WHERE "characterId"=ANY($1::uuid[]))`,[characterIds]);
      const ids = [...new Set([...characterIds,...discovered.map(m=>m.characterId)])].sort();
      try {
        return await this.db.transaction(async manager => {
          for (const id of ids) await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`character:${id}`]);
          const characters: Character[]=[];
          for (const id of ids) {
            const c=await manager.getRepository(Character).findOne({where:{id},lock:{mode:'pessimistic_write'}});
            if (!c) throw new NotFoundException('Character not found');
            characters.push(c);
          }
          const members: PartyMemberRow[] = await manager.query(`SELECT * FROM party_members WHERE "partyId" IN (SELECT "partyId" FROM party_members WHERE "characterId"=ANY($1::uuid[])) ORDER BY "orderIndex", "characterId"`,[characterIds]);
          if (members.some(m=>!ids.includes(m.characterId)) || JSON.stringify(members.map(m=>[m.partyId,m.characterId]).sort())!==JSON.stringify(discovered.map(m=>[m.partyId,m.characterId]).sort())) throw new MembershipChanged();
          const member=members.find(m=>m.characterId===characterIds[0]);
          const party: PartyRow|null = member ? (await manager.query('SELECT * FROM parties WHERE id=$1 FOR UPDATE',[member.partyId]))[0] : null;
          const now=Number((await manager.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now'))[0].now);
          return operation({manager,characters,party,members:members.filter(m=>m.partyId===party?.id),now});
        });
      } catch(e) { if (e instanceof MembershipChanged || ['40001','40P01',PARTY_DEADLINE_REACHED].includes(e?.code)) continue; throw e; }
    }
    throw new ConflictException('Party changed; retry request');
  }

  private error(code: string): never { throw new BadRequestException({code,message:code.replaceAll('_',' ')}); }
  private leader(ctx:PartyContext,id:string): PartyRow { if(!ctx.party||ctx.party.leaderCharacterId!==id)this.error('PARTY_LEADER_REQUIRED'); return ctx.party; }
  async isBusy(ctx:PartyContext,ids:string[]):Promise<boolean> {
    const shared=await ctx.manager.query('SELECT 1 FROM active_battle_participants WHERE "characterId"=ANY($1::uuid[]) LIMIT 1',[ids]);
    const legacy=await ctx.manager.query(`SELECT 1 FROM battle_queue_entries WHERE "characterId"=ANY($1::uuid[]) AND NOT resolved AND "startAt" <= to_timestamp($2/1000.0) + interval '50 milliseconds' LIMIT 1`,[ids,ctx.now]);
    const clocks=await ctx.manager.query(`SELECT 1 FROM encounter_clocks WHERE (("ownerKind"='character' AND "ownerId"=ANY($1::uuid[])) OR ("ownerKind"='party' AND "ownerId"=$3::uuid)) AND status='searching' AND "dueAt"<=to_timestamp($2/1000.0) + interval '50 milliseconds' LIMIT 1`,[ids,ctx.now,ctx.party?.id??null]);
    return !!(shared.length||legacy.length||clocks.length);
  }
  async event(manager:EntityManager,characterId:string,event:string,payload:any):Promise<void> {
    await manager.query('INSERT INTO party_outbox(id,"characterId",event,payload) VALUES($1,$2,$3,$4)',[randomUUID(),characterId,event,JSON.stringify(payload)]);
  }
  async changed(ctx:PartyContext,extraIds:string[]=[]):Promise<void> {
    if(ctx.party)await ctx.manager.query('UPDATE parties SET revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=$1',[ctx.party.id]);
    for(const id of new Set([...ctx.members.map(m=>m.characterId),...extraIds])) await this.event(ctx.manager,id,'party:updated',{refresh:true,revision:Number(ctx.party?.revision??0)+1});
  }
  async get(characterId:string) {
    const member=await this.member(characterId);
    const character=await this.db.getRepository(Character).findOneBy({id:characterId});
    let party:any=null,battle:any=null;
    if(member){
      const p=(await this.db.query('SELECT * FROM parties WHERE id=$1',[member.partyId]))[0];
      if(p){
        const rows=await this.db.query('SELECT m.*,c.name,c."hpCurrent",c."spCurrent",c."statusEffects",c.level,c.vit,c.int FROM party_members m JOIN characters c ON c.id=m."characterId" WHERE m."partyId"=$1 ORDER BY m."orderIndex"',[p.id]);
        const members=[];
        for(const row of rows){ const c=await this.db.getRepository(Character).findOneBy({id:row.characterId}); const s=c?await this.battle.buildCharacterSnapshot(c,c.hpCurrent,c.spCurrent):null;
          members.push({characterId:row.characterId,name:row.name,orderIndex:row.orderIndex,pendingLeave:row.pendingLeave,hp:row.hpCurrent,sp:row.spCurrent,maxHp:s?.maxHp??row.hpCurrent,maxSp:s?.maxSp??row.spCurrent,statusEffects:row.statusEffects}); }
        party={id:p.id,kind:p.kind,leaderCharacterId:p.leaderCharacterId,mapId:p.mapId,revision:Number(p.revision),members,routeActivity:p.activity?.kind==='route'?p.activity:null,teleport:p.activity?.kind==='route'?null:p.activity};
      }
    }
    battle=await this.shared.publicBattle(characterId);
    const invites=await this.db.query(`SELECT i.*,a.name AS "inviterName",b.name AS "candidateName" FROM party_invites i JOIN characters a ON a.id=i."inviterId" JOIN characters b ON b.id=i."candidateId" WHERE (i."candidateId"=$1 OR i."inviterId"=$1) AND i.status IN ('offered','accepted') ORDER BY i."createdAt"`,[characterId]);
    return {party,battle,invites,actions:await this.actions(characterId),autoPartyEnabled:character?.autoPartyEnabled??false};
  }
  async invite(inviterId:string,candidateId:string|undefined,candidateName:string|undefined,requestId:string,mode:'manual'|'auto'='manual'){
    if(!candidateId){const c=await this.db.getRepository(Character).findOneBy({name:candidateName??''});if(!c)throw new NotFoundException('Character not found');candidateId=c.id;}
    const candidate=candidateId;
    await this.serialized([inviterId,candidate],async ctx=>{
      const existing=await ctx.manager.query('SELECT id FROM party_invites WHERE "inviterId"=$1 AND "clientRequestId"=$2',[inviterId,requestId]);if(existing.length)return;
      if(candidate===inviterId)this.error('CANNOT_INVITE_SELF');
      const inviter=ctx.characters.find(c=>c.id===inviterId)!,target=ctx.characters.find(c=>c.id===candidate)!;
      if(!inviter.appearance||!target.appearance)this.error('APPEARANCE_REQUIRED');
      if(inviter.currentMapId!==target.currentMapId)this.error('PARTY_SAME_MAP_REQUIRED');
      if(await this.member(candidate,ctx.manager))this.error('CANDIDATE_ALREADY_IN_PARTY');
      if(ctx.party){try{assertPartyJoin({memberIds:ctx.members.map(m=>m.characterId),candidateId:candidate,mapId:ctx.party.mapId,candidateMapId:target.currentMapId,leaderId:ctx.party.leaderCharacterId,requesterId:inviterId});}catch(e){this.error(e.message);}}
      const id=randomUUID();
      await ctx.manager.query(`INSERT INTO party_invites(id,"inviterId","candidateId","partyId",mode,status,"expiresAt","clientRequestId") VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),$8)`,[id,inviterId,candidate,ctx.party?.id??null,mode,mode==='auto'?'accepted':'offered',ctx.now+60000,requestId]);
      await this.event(ctx.manager,candidate,'party:invite',{id,inviterId,candidateId:candidate,inviterName:inviter.name,status:mode==='auto'?'accepted':'offered',expiresAt:new Date(ctx.now+60000).toISOString()});
    });
    await this.tryAccepted();return this.get(inviterId);
  }
  async accept(characterId:string,id:string){
    const inv=(await this.db.query('SELECT * FROM party_invites WHERE id=$1 AND "candidateId"=$2',[id,characterId]))[0];if(!inv)throw new NotFoundException('Invite not found');
    await this.serialized([inv.inviterId,characterId],async ctx=>{
      const i=(await ctx.manager.query('SELECT * FROM party_invites WHERE id=$1 FOR UPDATE',[id]))[0];
      if(['accepted','joined'].includes(i.status))return;
      if(i.status!=='offered'||new Date(i.expiresAt).getTime()<=ctx.now)this.error('INVITE_EXPIRED');
      await ctx.manager.query(`UPDATE party_invites SET status='accepted',revision=revision+1 WHERE id=$1`,[id]);
      for (const participant of [characterId, i.inviterId]) await this.event(ctx.manager,participant,'party:updated',{refresh:true});
    });
    await this.tryAccepted();return this.get(characterId);
  }
  async cancelInvite(characterId:string,id:string){
    await this.db.transaction(async manager=>{
      const i=(await manager.query('SELECT * FROM party_invites WHERE id=$1 AND ("candidateId"=$2 OR "inviterId"=$2) FOR UPDATE',[id,characterId]))[0];if(!i)throw new NotFoundException('Invite not found');
      if(['offered','accepted'].includes(i.status))await manager.query(`UPDATE party_invites SET status='cancelled',revision=revision+1 WHERE id=$1`,[id]);
      for(const cid of [i.candidateId,i.inviterId])await this.event(manager,cid,'party:updated',{refresh:true});
    });return this.get(characterId);
  }
  async tryAccepted(){
    await this.db.query(`UPDATE party_invites SET status='expired',revision=revision+1 WHERE status='offered' AND "expiresAt"<=clock_timestamp()`);
    let cursor: {createdAt: string; id: string} | null = null;
    for (;;) {
      const offers=await this.db.query(`SELECT *, "createdAt"::text AS "cursorCreatedAt" FROM party_invites WHERE status='accepted' AND ($1::timestamptz IS NULL OR ("createdAt",id) > ($1::timestamptz,$2::uuid)) ORDER BY "createdAt",id LIMIT 100`,[cursor?.createdAt??null,cursor?.id??null]);
      if (!offers.length) break;
      cursor={createdAt:offers[offers.length-1].cursorCreatedAt,id:offers[offers.length-1].id};
      for(const inv of offers)await this.serialized([inv.inviterId,inv.candidateId],async ctx=>{
      const i=(await ctx.manager.query('SELECT * FROM party_invites WHERE id=$1 FOR UPDATE',[inv.id]))[0];if(i.status!=='accepted')return;
      const a=ctx.characters.find(c=>c.id===i.inviterId)!,b=ctx.characters.find(c=>c.id===i.candidateId)!;
      const targetMember=await this.member(b.id,ctx.manager);
      if(targetMember || a.currentMapId!==b.currentMapId || !a.appearance || !b.appearance || (i.partyId&&ctx.party?.id!==i.partyId) || (ctx.party&&ctx.party.leaderCharacterId!==a.id) || ctx.members.length>=5 || (i.mode==='auto'&&(!a.autoPartyEnabled||!b.autoPartyEnabled))){
        await ctx.manager.query(`UPDATE party_invites SET status='cancelled',revision=revision+1 WHERE id=$1`,[i.id]);return;
      }
      if(ctx.party?.activity||a.travelIntent||b.travelIntent||await this.isBusy(ctx,ctx.characters.map(c=>c.id)))return;
      await guardEncounterDeadline(ctx.manager, ctx.characters.map(c => c.id), ctx.party?.id ?? null);
      if(!ctx.party){
        const id=randomUUID();
        await ctx.manager.query(`INSERT INTO parties(id,kind,"leaderCharacterId","mapId") VALUES($1,$2,$3,$4)`,[id,i.mode,a.id,a.currentMapId]);
        await ctx.manager.query(`INSERT INTO party_members("partyId","characterId","orderIndex") VALUES($1,$2,0)`,[id,a.id]);
        ctx.party={id,kind:i.mode,leaderCharacterId:a.id,mapId:a.currentMapId,revision:1,activity:null};
        ctx.members=[{partyId:id,characterId:a.id,orderIndex:0,pendingLeave:false}];
        // Keep the leader's earliest reserved search boundary and roster identity.
        const future=(await ctx.manager.query(`SELECT "startAt", "seedUsed" FROM battle_queue_entries WHERE "characterId"=$1 AND NOT resolved ORDER BY "startAt" LIMIT 1`,[a.id]))[0];
        const solo=(await ctx.manager.query(`SELECT * FROM encounter_clocks WHERE "ownerKind"='character' AND "ownerId"=$1 AND status='searching'`,[a.id]))[0];
        await this.reserveClock(ctx,solo?.dueAt??future?.startAt,solo?.seed??future?.seedUsed);
      }
      await ctx.manager.query('INSERT INTO party_members("partyId","characterId","orderIndex") VALUES($1,$2,$3)',[ctx.party.id,b.id,ctx.members.length]);
      await ctx.manager.query(`DELETE FROM battle_queue_entries WHERE "characterId"=ANY($1::uuid[]) AND NOT resolved AND "startAt">to_timestamp($2/1000.0)`,[[a.id,b.id],ctx.now]);
      await ctx.manager.query(`UPDATE encounter_clocks SET status='cancelled' WHERE "ownerKind"='character' AND "ownerId"=ANY($1::uuid[])`,[[a.id,b.id]]);
      await ctx.manager.query(`UPDATE party_invites SET status='joined',"partyId"=$2,revision=revision+1 WHERE id=$1`,[i.id,ctx.party.id]);
      ctx.members.push({partyId:ctx.party.id,characterId:b.id,orderIndex:ctx.members.length,pendingLeave:false});
      await this.changed(ctx);
    });
      if (offers.length < 100) break;
    }
  }
  async reserveClock(ctx:PartyContext,dueAt?:Date|string,seed?:string){
    if(!ctx.party||this.data.getMapById(ctx.party.mapId)?.type!=='grind')return;
    const p=ctx.party,old=(await ctx.manager.query(`SELECT * FROM encounter_clocks WHERE "ownerKind"='party' AND "ownerId"=$1 FOR UPDATE`,[p.id]))[0];
    if(old?.status==='searching')return;
    const cycle=Number(old?.cycle??-1)+1;
    const population=Number((await ctx.manager.query(`SELECT count(*) AS n FROM characters WHERE status='grinding' AND "currentMapId"=$1 AND "pendingMapTransition" IS NULL`,[p.mapId]))[0].n);
    const identity=seed??`${p.id}:${p.mapId}:${cycle}`;
    const due=dueAt?new Date(dueAt).getTime():ctx.now+calculateEncounterSearchDelayMs(population,`${identity}:search`);
    await ctx.manager.query(`INSERT INTO encounter_clocks("ownerKind","ownerId","mapId",cycle,"searchStartedAt","dueAt",seed,status) VALUES('party',$1,$2,$3,to_timestamp($4/1000.0),to_timestamp($5/1000.0),$6,'searching') ON CONFLICT("ownerKind","ownerId") DO UPDATE SET "mapId"=EXCLUDED."mapId",cycle=EXCLUDED.cycle,"searchStartedAt"=EXCLUDED."searchStartedAt","dueAt"=EXCLUDED."dueAt",seed=EXCLUDED.seed,status='searching',generation=encounter_clocks.generation+1,roster='[]'`,[p.id,p.mapId,cycle,ctx.now,due,identity]);
  }
  async remove(ctx:PartyContext,id:string,reason='leave'){
    if(!ctx.party)return;
    const p=ctx.party;
    const remaining=ctx.members.filter(m=>m.characterId!==id);
    const dissolving=remaining.length<2||(p.kind==='auto'&&id===p.leaderCharacterId&&reason==='map');
    // Shared route jobs are owned by the Party. A removed member cannot retain
    // an orphan route, and cancellation/dissolution must release all followers.
    const routeStops = dissolving || id===p.leaderCharacterId ? ctx.members.map(m=>m.characterId) : [id];
    for (const characterId of routeStops) {
      const character=ctx.characters.find(c=>c.id===characterId);
      if (character?.travelIntent?.partyId !== p.id) continue;
      character.travelIntent=null;
      character.gatheringCycle={...(character.gatheringCycle??{}),lastUpdatedAt:new Date(ctx.now).toISOString()};
      await ctx.manager.getRepository(Character).save(character);
    }
    await ctx.manager.query('DELETE FROM party_members WHERE "partyId"=$1 AND "characterId"=$2',[p.id,id]);
    if(remaining.length<2||(p.kind==='auto'&&id===p.leaderCharacterId&&reason==='map')){
      await ctx.manager.query('DELETE FROM parties WHERE id=$1',[p.id]);
      await ctx.manager.query(`UPDATE encounter_clocks SET status='cancelled' WHERE "ownerKind"='party' AND "ownerId"=$1`,[p.id]);
      ctx.party=null;
    }else{
      for(let n=0;n<remaining.length;n++)await ctx.manager.query('UPDATE party_members SET "orderIndex"=$3 WHERE "partyId"=$1 AND "characterId"=$2',[p.id,remaining[n].characterId,n]);
      if(id===p.leaderCharacterId){p.leaderCharacterId=nextPartyLeader(remaining.map(m=>m.characterId),`${p.id}:${p.revision}:leader:${id}`)!;p.activity=null;await ctx.manager.query('UPDATE parties SET "leaderCharacterId"=$2,activity=NULL WHERE id=$1',[p.id,p.leaderCharacterId]);}
      else if(p.activity){p.activity.participantIds=p.activity.participantIds.filter(cid=>cid!==id);await ctx.manager.query('UPDATE parties SET activity=$2 WHERE id=$1',[p.id,JSON.stringify(p.activity)]);}
    }
    await this.changed(ctx,[id]);ctx.members=remaining;
  }
  async leave(characterId:string,cancel=false,targetId?:string){
    await this.serialized([characterId],async ctx=>{
      if(!ctx.party)return;const id=targetId??characterId;
      if(targetId)this.leader(ctx,characterId);
      if(!ctx.members.some(m=>m.characterId===id))throw new NotFoundException('Member not found');
      if(cancel){if(targetId&&targetId!==characterId)this.error('ONLY_SELF_CAN_CANCEL_LEAVE');await ctx.manager.query('UPDATE party_members SET "pendingLeave"=false,reason=NULL WHERE "characterId"=$1',[id]);await this.changed(ctx);}
      else if(await this.isBusy(ctx,ctx.members.map(m=>m.characterId))){await ctx.manager.query('UPDATE party_members SET "pendingLeave"=true,reason=$2 WHERE "characterId"=$1',[id,targetId?'kick':'leave']);await this.changed(ctx);}
      else await this.remove(ctx,id,targetId?'kick':'leave');
    });return this.get(characterId);
  }
  async reorder(characterId:string,ids:string[]){
    await this.serialized([characterId],async ctx=>{const p=this.leader(ctx,characterId);if(ids.length!==ctx.members.length||new Set(ids).size!==ids.length||ids.some(id=>!ctx.members.some(m=>m.characterId===id)))this.error('INVALID_PARTY_ORDER');for(let n=0;n<ids.length;n++)await ctx.manager.query('UPDATE party_members SET "orderIndex"=$3 WHERE "partyId"=$1 AND "characterId"=$2',[p.id,ids[n],n]);await this.changed(ctx);});return this.get(characterId);
  }
  canUseAutoParty(_character:Character){return true;}
  async setAuto(characterId:string,enabled:boolean){
    await this.serialized([characterId],async ctx=>{const c=ctx.characters.find(c=>c.id===characterId)!;if(enabled&&!this.canUseAutoParty(c))this.error('AUTO_PARTY_UNAVAILABLE');c.autoPartyEnabled=enabled;c.autoPartyEnabledAt=enabled?(c.autoPartyEnabledAt??new Date(ctx.now)):null;await ctx.manager.getRepository(Character).save(c);if(!enabled)await ctx.manager.query(`UPDATE party_invites SET status='cancelled',revision=revision+1 WHERE mode='auto' AND status IN ('offered','accepted') AND ("inviterId"=$1 OR "candidateId"=$1)`,[characterId]);});
    const m=await this.member(characterId);if(!enabled&&m){const p=(await this.db.query('SELECT kind FROM parties WHERE id=$1',[m.partyId]))[0];if(p?.kind==='auto')await this.leave(characterId);}
    await this.matchmake();return this.get(characterId);
  }
  async matchmake(){
    const candidates:Array<{id:string;currentMapId:string;cursorAt:string}>=[];
    let cursor:{at:string;id:string}|null=null;
    for (;;) {
      const page=await this.db.query(`SELECT c.id,c."currentMapId",COALESCE(c."autoPartyEnabledAt",'infinity'::timestamptz)::text AS "cursorAt"
        FROM characters c LEFT JOIN party_members m ON m."characterId"=c.id
        WHERE c."autoPartyEnabled" AND c.appearance IS NOT NULL AND m."characterId" IS NULL
          AND NOT EXISTS (SELECT 1 FROM party_invites i WHERE i.mode='auto' AND i.status IN ('offered','accepted') AND (i."candidateId"=c.id OR i."inviterId"=c.id))
          AND ($1::timestamptz IS NULL OR (COALESCE(c."autoPartyEnabledAt",'infinity'::timestamptz),c.id)>($1::timestamptz,$2::uuid))
        ORDER BY COALESCE(c."autoPartyEnabledAt",'infinity'::timestamptz),c.id LIMIT 100`,[cursor?.at??null,cursor?.id??null]);
      candidates.push(...page);
      if(page.length<100)break;
      const last=page[page.length-1];cursor={at:last.cursorAt,id:last.id};
    }
    const available=new Map<string,string[]>();for(const c of candidates){const group=available.get(c.currentMapId)??[];group.push(c.id);available.set(c.currentMapId,group);}
    for(const [mapId,ids]of available){
      const auto=await this.db.query(`SELECT p."leaderCharacterId" AS id FROM parties p WHERE p.kind='auto' AND p."mapId"=$1 AND p.activity IS NULL AND (SELECT count(*) FROM party_members m WHERE m."partyId"=p.id)<5 ORDER BY p."createdAt",p.id`,[mapId]);
      let leader=auto[0]?.id??ids.shift();if(!leader)continue;
      for(const id of ids.slice(0,4)){const prior=await this.db.query(`SELECT id FROM party_invites WHERE mode='auto' AND status IN ('offered','accepted') AND ("candidateId"=$1 OR "inviterId"=$1)`,[id]);if(prior.length)continue;try{await this.invite(leader,id,undefined,`auto:${randomUUID()}`,'auto');}catch(e){if(!(e instanceof BadRequestException))throw e;}}
    }
  }
  async actions(characterId:string){return this.db.query('SELECT id,kind,status,result,sequence,"clientRequestId","createdAt" FROM character_action_intents WHERE "characterId"=$1 ORDER BY sequence DESC LIMIT 64',[characterId]);}
  async cancelAction(characterId:string,id:string){await this.db.query(`UPDATE character_action_intents SET status='cancelled',"completedAt"=clock_timestamp() WHERE id=$1 AND "characterId"=$2 AND status='pending'`,[id,characterId]);return this.get(characterId);}
  async queueIfMember(characterId:string):Promise<boolean>{const m=await this.member(characterId);if(!m)return false;await this.tickParty(m.partyId);return true;}
  async tickParty(partyId:string){
    const first=(await this.db.query('SELECT "characterId" FROM party_members WHERE "partyId"=$1 ORDER BY "orderIndex" LIMIT 1',[partyId]))[0];if(!first)return;
    await this.serialized([first.characterId],async ctx=>{
      if(ctx.party?.id!==partyId)return;
      const active=(await ctx.manager.query(`SELECT b.* FROM shared_battles b JOIN active_battle_participants a ON a."battleId"=b.id WHERE a."characterId"=$1`,[first.characterId]))[0];
      if(active){
        const endAt=new Date(active.endAt).getTime();
        if(endAt>ctx.now)return;
        ctx.now=endAt;
        await this.shared.resolve(ctx,active,(id,reason)=>this.remove(ctx,id,reason));
      } else {
        // Catch up one persisted boundary at a time, rather than discarding offline time.
        const next=(await ctx.manager.query(`SELECT "dueAt" FROM encounter_clocks WHERE "ownerKind"='party' AND "ownerId"=$1 AND status='searching'`,[partyId]))[0];
        const activity=ctx.party.activity;
        const activityDue=!activity||activity.paused?Infinity:activity.kind==='route'?Number(activity.segmentDueAt??Infinity):Number(activity.lastAccruedAt)+(10000-Number(activity.elapsedMs));
        ctx.now=Math.min(ctx.now,next?new Date(next.dueAt).getTime():Infinity,activityDue);
      }
      if(!ctx.party)return;
      for(const m of [...ctx.members])if(m.pendingLeave)await this.remove(ctx,m.characterId,m.reason);
      if(!ctx.party)return;
      const p=ctx.party;
      // Changes made through legacy world routes are reconciled at the same safe boundary.
      for(const m of [...ctx.members]){const c=ctx.characters.find(c=>c.id===m.characterId)!;if(c.currentMapId!==p.mapId)await this.remove(ctx,c.id,'map');}
      if(!ctx.party)return;
      for(const member of [...ctx.members]){const c=ctx.characters.find(c=>c.id===member.characterId)!;if(c.status==='grinding'&&!await this.battle.preparePartyFood(c,ctx.now,ctx.manager)){await this.moveCharacter(ctx,c,c.savedTownMapId??TOWN_MAP_ID);await this.remove(ctx,c.id,'hunger');}}
      if(!ctx.party)return;
      await this.shared.drain(ctx);
      // Resolve overdue encounter before a later travel/teleport boundary.
      const reserved=(await ctx.manager.query(`SELECT * FROM encounter_clocks WHERE "ownerKind"='party' AND "ownerId"=$1 AND status='searching' FOR UPDATE`,[p.id]))[0];
      const due=reserved?new Date(reserved.dueAt).getTime():Number.POSITIVE_INFINITY;
      if(p.activity){
        const activity=p.activity;
        const boundary=activity.kind==='route'?Number(activity.segmentDueAt??Infinity):Number(activity.lastAccruedAt)+(10000-Number(activity.elapsedMs));
        if(due<=ctx.now&&due<=boundary){
          const started=await this.shared.start(ctx,reserved);
          if(started){
            if(activity.kind==='route'){activity.remainingMs=Math.max(0,boundary-due);activity.paused=true;activity.lastAccruedAt=due;}
            else p.activity=advanceTeleport(activity,due,true);
            await ctx.manager.query('UPDATE parties SET activity=$2 WHERE id=$1',[p.id,JSON.stringify(p.activity)]);
          }
          await this.changed(ctx);return;
        }
        if(activity.kind==='route'){
          if(activity.paused){activity.segmentDueAt=ctx.now+Number(activity.remainingMs??0);activity.paused=false;}
          if(Number(activity.segmentDueAt)<=ctx.now){await this.advanceRoute(ctx);return;}
          await ctx.manager.query('UPDATE parties SET activity=$2 WHERE id=$1',[p.id,JSON.stringify(activity)]);
        }else{
          p.activity=advanceTeleport(activity,ctx.now,false);
          if(p.activity.elapsedMs>=10000){
            const destination=p.activity.destinationMapId;
            for(const id of p.activity.participantIds){const c=ctx.characters.find(c=>c.id===id);if(!c||!ctx.members.some(m=>m.characterId===id))continue;await this.moveCharacter(ctx,c,destination);}
            await ctx.manager.query(`UPDATE parties SET "mapId"=$2,activity=NULL WHERE id=$1`,[p.id,destination]);
            await ctx.manager.query(`UPDATE encounter_clocks SET status='cancelled' WHERE "ownerKind"='party' AND "ownerId"=$1`,[p.id]);
            if(p.kind==='auto')await this.remove(ctx,p.leaderCharacterId,'map');else{p.mapId=destination;p.activity=null;await this.changed(ctx);}return;
          }
          await ctx.manager.query('UPDATE parties SET activity=$2 WHERE id=$1',[p.id,JSON.stringify(p.activity)]);
        }
      }
      await this.reserveClock(ctx);
      const clock=(await ctx.manager.query(`SELECT * FROM encounter_clocks WHERE "ownerKind"='party' AND "ownerId"=$1 AND status='searching' FOR UPDATE`,[p.id]))[0];
      if(clock&&new Date(clock.dueAt).getTime()<=ctx.now){
        const started=await this.shared.start(ctx,clock);
        if(started&&p.activity){p.activity=advanceTeleport(p.activity,ctx.now,true);await ctx.manager.query('UPDATE parties SET activity=$2 WHERE id=$1',[p.id,JSON.stringify(p.activity)]);}
        await this.changed(ctx);
      }
    });
  }
  private async moveCharacter(ctx:PartyContext,c:Character,destination:string){
    const old=c.currentMapId;c.currentMapId=destination;c.status=this.data.getMapById(destination)?.type==='town'?'town':'grinding';c.travelIntent=null;c.encounterCycle={cycleIndex:0,nextAt:null};c.pendingMapTransition=null;c.discoveredMapIds=[...new Set([...(c.discoveredMapIds??[]),destination])];c.gatheringCycle={...(c.gatheringCycle??{}),lastUpdatedAt:new Date(ctx.now).toISOString()};
    await ctx.manager.getRepository(Character).save(c);
    await this.event(ctx.manager,c.id,'map:changed',{previousMapId:old,currentMapId:destination,refresh:true});
  }
  async travel(characterId:string,destination:string){
    await this.serialized([characterId],async ctx=>{
      const p=this.leader(ctx,characterId),leader=ctx.characters.find(c=>c.id===characterId)!;
      const map=this.data.getMapById(destination);if(!map||map.isClickable===false) this.error('INVALID_DESTINATION');
      if(destination===leader.savedTownMapId){this.error('USE_PARTY_TELEPORT');}
      const known=(leader.discoveredMapIds??[]).map(id=>this.data.getMapById(id)).filter(Boolean);
      if(!known.some(node=>Math.abs(node.coordinates.x-map.coordinates.x)+Math.abs(node.coordinates.y-map.coordinates.y)<=1)&&!known.some(node=>node.id===destination))this.error('MAP_NOT_REVEALED');
      const route=findCardinalRoute(this.data.getMaps(),leader.currentMapId,destination).map(node=>node.id);
      if(!route||route.length<2)this.error('MAP_NOT_REVEALED');
      if(map.type==='grind'){
        const travelers=p.kind==='manual'?ctx.members.map(m=>m.characterId):[characterId];
        for(const id of travelers){
          const character=ctx.characters.find(c=>c.id===id)!;
          const user=await ctx.manager.getRepository(User).findOneBy({id:character.userId});
          if(user?.emailVerified!==true)this.error('EMAIL_NOT_VERIFIED');
        }
      }
      const hungry:string[]=[];
      if(this.data.getMapById(p.mapId)?.type==='town')for(const m of ctx.members){const c=ctx.characters.find(c=>c.id===m.characterId)!;if(!await this.battle.preparePartyFood(c,ctx.now,ctx.manager))hungry.push(c.name);}
      if(hungry.length){for(const m of ctx.members)await this.event(ctx.manager,m.characterId,'party:actionUpdated',{status:'failed',message:`Town Guard: ${hungry.join(', ')} need to eat or cleanse their sins.`});return;}
      if(await this.isBusy(ctx,ctx.members.map(m=>m.characterId)))this.error('PARTY_BUSY');
      p.activity={kind:'route',destinationMapId:destination,routeMapIds:route,segmentIndex:0,generation:randomUUID(),participantIds:p.kind==='manual'?ctx.members.map(m=>m.characterId):[characterId],paused:false,segmentDueAt:ctx.now};
      await this.advanceRoute(ctx,true);await this.changed(ctx);
    });return this.get(characterId);
  }
  private async advanceRoute(ctx:PartyContext,initial=false){
    const p=ctx.party!,a=p.activity,leader=ctx.characters.find(c=>c.id===p.leaderCharacterId)!;
    if(!initial){
      const next=a.routeMapIds[++a.segmentIndex];
      for(const id of a.participantIds){const c=ctx.characters.find(c=>c.id===id);if(c&&ctx.members.some(m=>m.characterId===id))await this.moveCharacter(ctx,c,next);}
      if(p.kind==='auto'){await this.remove(ctx,leader.id,'map');return;}
      p.mapId=next;
      await ctx.manager.query(`UPDATE encounter_clocks SET status='cancelled' WHERE "ownerKind"='party' AND "ownerId"=$1`,[p.id]);
    }
    if(a.segmentIndex>=a.routeMapIds.length-1){p.activity=null;}
    else{
      const source=this.data.getMapById(a.routeMapIds[a.segmentIndex]),next=this.data.getMapById(a.routeMapIds[a.segmentIndex+1]);
      const snapshot=await this.battle.buildCharacterSnapshot(leader,leader.hpCurrent,leader.spCurrent,ctx.now);
      const duration=isInstantTownExitEdge(source,next)?0:calculateTravelDurationSeconds(Number(snapshot.moveSpeed??0),Number(source.mapLength??25))*1000;
      a.segmentStartedAt=ctx.now;a.segmentDueAt=ctx.now+duration;a.remainingMs=duration;
      for(const id of a.participantIds){const c=ctx.characters.find(c=>c.id===id)!;c.travelIntent={kind:'route',partyId:p.id,destinationMapId:a.destinationMapId,routeMapIds:a.routeMapIds,segmentIndex:a.segmentIndex,segmentProgress:0,lastDurationSeconds:duration/1000,lastAccruedAt:new Date(ctx.now).toISOString(),segmentDueAt:a.segmentDueAt};await ctx.manager.getRepository(Character).save(c);}
    }
    await ctx.manager.query('UPDATE parties SET "mapId"=$2,activity=$3 WHERE id=$1',[p.id,p.mapId,p.activity?JSON.stringify(p.activity):null]);
    if(p.activity&&Number(p.activity.segmentDueAt)<=ctx.now){await this.advanceRoute(ctx);return;}
    await this.reserveClock(ctx);await this.changed(ctx);
  }
  async teleport(characterId:string){
    await this.serialized([characterId],async ctx=>{const p=this.leader(ctx,characterId);if(p.activity)return;const busy=await this.isBusy(ctx,ctx.members.map(m=>m.characterId));const leader=ctx.characters.find(c=>c.id===characterId)!;const destination=this.data.getMapById(leader.savedTownMapId??TOWN_MAP_ID);if(destination?.type!=='town')this.error('INVALID_SAVEPOINT');p.activity={kind:'teleport',destinationMapId:destination.id,startedAt:new Date(ctx.now).toISOString(),elapsedMs:0,lastAccruedAt:ctx.now,paused:busy,generation:randomUUID(),participantIds:p.kind==='auto'?[characterId]:ctx.members.map(m=>m.characterId)};await ctx.manager.query('UPDATE parties SET activity=$2 WHERE id=$1',[p.id,JSON.stringify(p.activity)]);await this.changed(ctx);});return this.get(characterId);
  }
  async flee(characterId:string){await this.serialized([characterId],async ctx=>{this.leader(ctx,characterId);await this.shared.flee(ctx,characterId,(id,reason)=>this.remove(ctx,id,reason));await this.changed(ctx);});return this.get(characterId);}
  async enqueueDrain(characterId:string){await this.serialized([characterId],ctx=>this.shared.drain(ctx));}
  async enqueue(characterId:string,requestId:string,kind:string,payload:any){
    await this.serialized([characterId],async ctx=>{await this.shared.enqueue(ctx,characterId,requestId,kind,payload);ctx.now=Number((await ctx.manager.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now'))[0].now);await this.shared.drain(ctx);await this.event(ctx.manager,characterId,'party:actionUpdated',{refresh:true});});
    const intent=(await this.db.query('SELECT id,kind,status,result,sequence,"clientRequestId","createdAt" FROM character_action_intents WHERE "characterId"=$1 AND "clientRequestId"=$2',[characterId,requestId]))[0];
    return {...await this.get(characterId),intent};
  }
  async setStance(characterId:string,stance:'hunting'|'gathering'){
    await this.serialized([characterId],async ctx=>{this.leader(ctx,characterId);for(const m of ctx.members){const c=ctx.characters.find(c=>c.id===m.characterId)!;c.lastGrindStance=stance;await ctx.manager.getRepository(Character).save(c);}await this.changed(ctx);});return this.get(characterId);
  }
}
