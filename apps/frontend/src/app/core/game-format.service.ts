import { Injectable } from '@angular/core';
import { effectiveFoodStatValue } from '@nanommo/shared';
@Injectable({providedIn:'root'})
export class GameFormatService {
 itemTooltipLines(d:any){if(!d)return [];const keys=Object.keys(d),stop=Math.max(0,keys.indexOf('tier')),visible=stop>0?keys.slice(0,stop):keys;return visible.filter(k=>k!=='id'&&k!=='name'&&d[k]!==undefined&&d[k]!==null&&d[k]!=='').map(k=>({label:k==='effect'?'Effect':k,value:k==='effect'?this.formatItemEffect(d[k]):String(d[k])}))}
 formatItemEffect(e:any){if(!e)return '';if(e.status)return 'Cures '+String(e.status).replace(/_/g,' ')+'.';if(e.type==='heal_hp')return 'Restores '+(Number(e.amount)||0)+' HP.';if(e.type==='heal_sp')return 'Restores '+(Number(e.amount)||0)+' SP.';return String(e.type??'').replace(/_/g,' ')}
 itemTierClass(d:any){const t=Number(d?.tier??0);return t>=2&&t<=5?'tier-'+t:''}
 eventText(e:any){if(e?.action==='attack'){const critical=e?.crit?' CRITICAL!':'';return e.actor==='monster'?'Monster attacks for '+Number(e.damage??0)+critical:'Character attacks for '+Number(e.damage??0)+critical}if(e?.action==='regen')return 'You regenerated '+Number(e.amount??0)+' '+String(e.resource??'HP')+'.';if(e?.action==='use_item')return (e.actor==='character'?'Character uses ':'Monster uses ')+String(e.itemId??'item').replaceAll('_',' ');if(e?.action==='use_skill')return (e.actor==='character'?'Character casts ':'Monster casts ')+String(e.skillId??'skill').replaceAll('_',' ');return String(e?.action??e?.type??e?.event??'event').replace(/_/g,' ')}
 dietTooltipLines(e:any,d:any,remaining:number){const f=d?.effect;if(!f)return [];const l=Math.max(0,Math.min(3,Number(e?.dietLevel??0)));return f.type==='food_buff'?[{label:'HP Regen',value:'+'+effectiveFoodStatValue(f.hpRegenPerTenTicks,l)+' / 10 ticks'},{label:'SP Regen',value:'+'+effectiveFoodStatValue(f.spRegenPerTenTicks,l)+' / 10 ticks'},{label:'Diet',value:l?'★'.repeat(l):'—'},{label:'Remaining',value:remaining+'s'}]:[]}
}
