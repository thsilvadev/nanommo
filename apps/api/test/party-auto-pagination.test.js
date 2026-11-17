const assert=require('node:assert/strict');
const {PartyService}=require('../dist/apps/api/src/modules/party/party.service');
const service=Object.create(PartyService.prototype), invited=[];let scans=0;
const earlier=Array.from({length:100},(_,i)=>({id:`busy-${String(i).padStart(3,'0')}`,currentMapId:'other',cursorAt:'2026-01-01 00:00:00.123456+00'}));
const later=[{id:'free-1',currentMapId:'field',cursorAt:'2026-01-01 00:00:00.123456+00'},{id:'free-2',currentMapId:'field',cursorAt:'2026-01-01 00:00:00.123456+00'}];
service.db={query:async(sql,args=[])=>{if(sql.includes('FROM characters c LEFT JOIN party_members')){scans++;if(!args.length||args[0]===null)return earlier;if(args[0]===earlier.at(-1).cursorAt&&args[1]===earlier.at(-1).id)return later;throw Error('cursor lost timestamp precision');}if(sql.includes('FROM parties p'))return [];if(sql.includes('FROM party_invites'))return args[0].startsWith('busy-')?[{id:'active'}]:[];throw Error(sql)}};
service.invite=async(...args)=>invited.push(args);
(async()=>{await service.matchmake();assert(scans>=2,'matchmaking must page past the first 100');assert(invited.some(args=>args[0]==='free-1'&&args[1]==='free-2'),'later eligible pair must form despite blocked earlier candidates');console.log('party-auto-pagination passed');})().catch(e=>{console.error(e);process.exitCode=1});
