/** Own-action presentation data. Never return the unfiltered command payload. */
export function publicCombatAction(action: any, item?: {twoHanded?: boolean}): any {
  const payload = action.payload ?? {};
  let target: Record<string, unknown> = {};
  switch (action.kind) {
    case 'equip':
    case 'unequip':
      target = {slot:payload.slot, slots:item?.twoHanded && payload.slot==='mainHand'?['mainHand','offHand']:[payload.slot],
        ...(typeof payload.itemId==='string'?{itemId:payload.itemId}:{}),
        ...(typeof payload.inventoryItemId==='string'?{inventoryItemId:payload.inventoryItemId}:{})};
      break;
    case 'use_item': target = {itemId:payload.itemId}; break;
    case 'gambit_update':
      target = {pageId:payload.pageId, draft:{...(typeof payload.title==='string'?{title:payload.title}:{}),...(Array.isArray(payload.lines)?{lines:payload.lines}:{})}};
      break;
    case 'gambit_activate': target = {pageId:payload.pageId}; break;
    case 'attributes': target = {attributes:Object.fromEntries(Object.entries(payload).filter(([key,value])=>['str','agi','dex','vit','int','luk'].includes(key)&&Number.isInteger(value)))}; break;
  }
  return {id:action.id,kind:action.kind,status:action.status,result:action.result,sequence:action.sequence,
    clientRequestId:action.clientRequestId,createdAt:action.createdAt,completedAt:action.completedAt,target};
}
