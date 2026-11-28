import { craftOriginFor } from '../town/npc-price-policy';
import { sessionRecipeMatches } from '../town/recipe-version';

export function projectedGrant(rows: any[], item: any, quantity: number, instanceData: any = null): any[] | null {
  const projected = rows.map(row => ({ ...row, quantity: Number(row.quantity) }));
  const max = item.stackable ? Math.max(1, Number(item.maxStack ?? 1)) : 1;
  let remaining = quantity;
  if (item.stackable) for (const row of projected) {
    if (row.itemId !== item.id || JSON.stringify(row.instanceData ?? null) !== JSON.stringify(instanceData ?? null)) continue;
    const add = Math.min(remaining, Math.max(0, max - row.quantity)); row.quantity += add; remaining -= add;
    if (!remaining) return projected;
  }
  while (remaining > 0) {
    const used = new Set(projected.map(row => row.slotIndex));
    const slotIndex = Array.from({ length: 50 }, (_, i) => i).find(i => !used.has(i));
    if (slotIndex === undefined) return null;
    const add = Math.min(remaining, max);
    projected.push({ itemId: item.id, quantity: add, slotIndex, instanceData }); remaining -= add;
  }
  return projected;
}

/** Dry-run every pending unit, including exact ingredient provenance and the slots its consumption frees. */
export function pendingCraftsFit(data: any, rows: any[], character: any): boolean {
  let projected = rows.map(row => ({ ...row, quantity: Number(row.quantity) }));
  for (const [profession, session] of [['cooking', character?.cookingSession], [character?.craftingSession?.profession, character?.craftingSession]] as any[]) {
    if (!session) continue;
    const recipes = profession === 'cooking' ? data.getCookingRecipes?.() : profession === 'alchemy' ? data.getAlchemyRecipes?.() : data.getBlacksmithRecipes?.();
    const recipe = recipes?.recipes?.find((r: any) => r.id === session.recipeId);
    // An obsolete session will be cancelled before it can consume or grant anything.
    if (!sessionRecipeMatches(session, recipe, profession)) continue;
    const count = Math.max(0, Number(session.quantity ?? session.outputQuantity ?? 1) - Number(session.completedQuantity ?? 0));
    for (let unit = 0; unit < count; unit++) {
      let origin: any;
      try { origin = craftOriginFor(data, recipe, projected); } catch { return false; }
      for (const req of recipe.ingredients) {
        let remaining = Number(req.quantity);
        for (const row of projected.filter(row => row.itemId === req.itemId).sort((a, b) => a.slotIndex - b.slotIndex)) {
          const take = Math.min(remaining, row.quantity); row.quantity -= take; remaining -= take;
          if (!row.quantity) projected.splice(projected.indexOf(row), 1);
          if (!remaining) break;
        }
      }
      const next = projectedGrant(projected, data.getItemById(recipe.outputItemId), 1, origin);
      if (!next) return false;
      projected = next;
    }
  }
  return true;
}
