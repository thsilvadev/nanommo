/** All inputs come from authoritative server catalogs, never request metadata. */
export function safeNpcSellPrice(basePayment: number, cheapestInfiniteBuyPrice: number | null): number {
  const base = Number.isSafeInteger(basePayment) && basePayment >= 0 ? basePayment : 0;
  if (cheapestInfiniteBuyPrice === null) return base;
  if (!Number.isSafeInteger(cheapestInfiniteBuyPrice) || cheapestInfiniteBuyPrice < 0) return 0;
  return Math.min(base, Math.floor(cheapestInfiniteBuyPrice * 0.4));
}

export function craftedNpcSellPrice(inputValue: number, droppedEquivalentValue: number | null): number {
  if (!Number.isFinite(inputValue) || inputValue < 0) return 0;
  const margin = Math.floor(inputValue * 105 / 100);
  return droppedEquivalentValue === null ? margin : Math.max(0, Math.min(margin, Math.floor(droppedEquivalentValue / 4)));
}

/** Structural catalog access keeps pricing and reservation simulation identical across services. */
export function recipeForOutput(data: any, itemId: string): any {
  return [data.getCookingRecipes?.(), data.getAlchemyRecipes?.(), data.getBlacksmithRecipes?.()]
    .flatMap(catalog => catalog?.recipes ?? []).find(recipe => recipe.outputItemId === itemId);
}
export function catalogNpcPayment(data: any, itemId: string, rate = 40): number {
  const item = data.getItemById(itemId);
  if (!item) return 0;
  let cheapest: number | null = null;
  const vendors = [data.getNpcVendor(), ...(data.getNpcCatalog?.()?.npcs ?? []).map((npc: any) => npc.vendor)].filter(Boolean);
  for (const vendor of vendors) for (const entry of vendor.sellStock ?? []) {
    if (entry.itemId !== itemId || entry.infiniteStock !== true) continue;
    const buy = Number(entry.priceFromItem ? item.marketBasePrice ?? item.sellPriceToVendor ?? 0 : entry.price);
    if (!Number.isSafeInteger(buy) || buy <= 0) return 0;
    cheapest = cheapest === null ? buy : Math.min(cheapest, buy);
  }
  return safeNpcSellPrice(Math.floor(Number(item.marketBasePrice ?? item.sellPriceToVendor ?? 0) * rate / 100), cheapest);
}
export function droppedEquivalentPayment(data: any, itemId: string, rate = 40): number | null {
  const item = data.getItemById(itemId);
  return item && (['consumable', 'food'].includes(item.type) || item.droppedBy?.length || item.randomRollOnDrop?.enabled || item.dropPool?.length)
    ? catalogNpcPayment(data, itemId, rate) : null;
}
export function instanceNpcPayment(data: any, itemId: string, metadata: any, rate = 40, seen = new Set<string>()): number {
  const base = catalogNpcPayment(data, itemId, rate);
  if (metadata?.origin !== 'crafted' && !metadata?.craftedByProfession && !metadata?.craftedRecipeId) return base;
  if (seen.has(itemId)) return 0;
  const recipe = recipeForOutput(data, itemId);
  if (!recipe) return 0;
  const next = new Set(seen).add(itemId);
  const inputs = recipe.ingredients.reduce((sum: number, req: any) => sum + Number(req.quantity) *
    instanceNpcPayment(data, req.itemId, recipeForOutput(data, req.itemId) ? { origin: 'crafted' } : null, rate, next), 0);
  const current = craftedNpcSellPrice(inputs, droppedEquivalentPayment(data, itemId, rate));
  const snapshot = Number(metadata.npcSellValueAtCraft);
  return Math.max(0, Math.min(base, current, Number.isSafeInteger(snapshot) && snapshot >= 0 ? snapshot : current));
}
export function craftOriginFor(data: any, recipe: any, rows: any[]): any {
  let inputValue = 0;
  for (const req of recipe.ingredients) {
    let remaining = Number(req.quantity);
    for (const row of rows.filter(row => row.itemId === req.itemId).sort((a, b) => a.slotIndex - b.slotIndex)) {
      const take = Math.min(remaining, Number(row.quantity));
      inputValue += take * instanceNpcPayment(data, req.itemId, row.instanceData);
      remaining -= take;
      if (!remaining) break;
    }
    if (remaining) throw new Error('Reserved ingredient missing: ' + req.itemId);
  }
  return { origin: 'crafted', craftedRecipeId: recipe.id,
    npcSellValueAtCraft: craftedNpcSellPrice(inputValue, droppedEquivalentPayment(data, recipe.outputItemId)) };
}
