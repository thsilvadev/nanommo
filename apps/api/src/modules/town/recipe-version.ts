import { createHash } from 'crypto';
export function recipeVersion(recipe: any): string {
  return createHash('sha256').update(JSON.stringify({
    outputItemId: recipe.outputItemId, ingredients: recipe.ingredients,
    xpReward: recipe.xpReward, availability: recipe.availability ?? 'available',
  })).digest('hex');
}
export function sessionRecipeMatches(session: any, recipe: any, profession: string): boolean {
  if (!recipe || recipe.availability === 'future') return false;
  if (session.recipeVersion) return session.recipeVersion === recipeVersion(recipe);
  // Even unchanged ingredients now produce a different stack provenance, so every unversioned batch is affected.
  return false;
}
