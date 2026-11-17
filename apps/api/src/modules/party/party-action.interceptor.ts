import { CallHandler, ExecutionContext, Injectable, NestInterceptor, NotFoundException } from '@nestjs/common';
// Resolve Nest's declared Observable peer in this pnpm workspace.
const { from } = require(require.resolve('rxjs', { paths: [require.resolve('@nestjs/common')] }));
import { randomUUID } from 'crypto';
import { CharacterService } from '../character/character.service';
import { InventoryService } from '../inventory/inventory.service';
import { EquipmentService } from '../equipment/equipment.service';
import { PartyService } from './party.service';

/** Convert existing HTTP commands into durable data before any old mutation can execute. */
@Injectable()
export class PartyActionInterceptor implements NestInterceptor {
 constructor(private readonly party:PartyService,private readonly characters:CharacterService,private readonly inventory:InventoryService,private readonly equipment:EquipmentService){}
 intercept(context:ExecutionContext,next:CallHandler){
  if(context.getType()!=='http')return next.handle();
  const req=context.switchToHttp().getRequest();if(!req.user?.userId)return next.handle();
  const route=`${context.getClass().name}.${context.getHandler().name}`,body=req.body??{};
  let kind:string,payload:any;
  switch(route){
   case 'EquipmentController.equipItem':kind='equip';payload=body;break;
   case 'EquipmentController.unequipItem':kind='unequip';payload={slot:req.params.slot};break;
   case 'InventoryController.useConsumable':kind='use_item';payload=body;break;
   case 'GambitController.updateGambitPage':if(body.lines===undefined)return next.handle();kind='gambit_update';payload={pageId:req.params.pageId,lines:body.lines};break;
   case 'GambitController.activateGambitPage':kind='gambit_activate';payload={pageId:req.params.pageId};break;
   case 'CharacterController.spendAttributes':kind='attributes';payload=body.attributes??body;break;
   default:return next.handle();
  }
  return from((async()=>{
   const c=await this.characters.getCharacterByUserId(req.user.userId);if(!c)throw new NotFoundException('Character not found');
   const state=await this.party.enqueue(c.id,String(body.clientRequestId??req.headers['idempotency-key']??randomUUID()),kind,payload);
   const character=await this.characters.getCharacterDtoById(c.id);
   const action=state.actions[0];
   return {...(route==='CharacterController.spendAttributes'?character:{}),...state,intent:action,character,equipment:await this.equipment.getEquipment(c.id),inventory:await this.inventory.getInventory(c.id),stateVersion:character?.stateVersion};
  })());
 }
}
