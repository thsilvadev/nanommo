/**
 * Who a gambit `use_item` line uses its item on. Shared by the engine, the
 * server-side gambit validator and the gambit editor.
 *
 * The condition picks the subject (each line has exactly one condition):
 *   Self:  → Use item (Self)
 *   Ally:  → Use item (Ally) on the ally that met the condition, or Use item (Self)
 *   Foe:   → Use item (Foe) on the foe that met the condition, or Use item (Self)
 * Fairy in a Bottle: only Self: Status = KO → Use item (Self).
 * Sapupema Leaf Tea (revives an ally): only Ally: Status = KO → Use item (Ally).
 * A KO ally only takes a revive item (anything else would never fire).
 * Any other consumable may be used on a foe and applies its normal effect there.
 *
 * Lines saved before `target` existed keep their old behaviour (`legacyItemTarget`).
 */
export type GambitItemTarget = 'self' | 'ally' | 'foe';
export const GAMBIT_ITEM_TARGETS: readonly GambitItemTarget[] = ['self', 'ally', 'foe'];

export const conditionScopeOf = (conditionId: string | null | undefined): GambitItemTarget => {
  const id = String(conditionId ?? '');
  return id.startsWith('foe_') ? 'foe' : id.startsWith('ally_') ? 'ally' : 'self';
};

/** Targets offered for a condition scope (the subject's own side first). */
export function itemTargetsForScope(scope: GambitItemTarget): GambitItemTarget[] {
  return scope === 'ally' ? ['ally', 'self'] : scope === 'foe' ? ['foe', 'self'] : ['self'];
}

const REVIVE_SELF = 'revive_full_cleanse';
const REVIVE_ALLY = new Set(['revive_ally', 'revive_half']);

/** The pre-`target` rule: revive items by kind, then an ally condition, else self. */
export function legacyItemTarget(conditionIds: string[], effectType: string | null | undefined): GambitItemTarget {
  if (effectType && REVIVE_ALLY.has(effectType)) return 'ally';
  if (effectType === REVIVE_SELF) return 'self';
  return conditionIds.some((id) => String(id ?? '').startsWith('ally_')) ? 'ally' : 'self';
}

const isKoCondition = (condition: { id?: string; status?: string; params?: Record<string, unknown> } | null | undefined, scope: 'self' | 'ally') =>
  condition?.id === `${scope}_has_status` && String(condition?.params?.['status'] ?? condition?.status ?? '').toLowerCase() === 'ko';

/**
 * Why `item` cannot be used on `target` by a line with `condition`, or null when it can.
 * `item` is the catalogue entry (only its effect type and `type` are read).
 */
export function itemTargetError(
  target: GambitItemTarget,
  condition: { id?: string; status?: string; params?: Record<string, unknown> } | null | undefined,
  item: { type?: string; effect?: { type?: string } } | null | undefined,
): string | null {
  const scope = conditionScopeOf(condition?.id);
  if (!itemTargetsForScope(scope).includes(target)) return `Use item (${label(target)}) is not available for a ${label(scope)} condition`;
  const effectType = item?.effect?.type;
  if (isKoCondition(condition, 'self') && effectType !== REVIVE_SELF) return 'Self: Status = KO can only use Fairy in a Bottle';
  if (effectType === REVIVE_SELF && !(target === 'self' && isKoCondition(condition, 'self'))) return 'Fairy in a Bottle can only be used as Self: Status = KO → Use item (Self)';
  if (effectType && REVIVE_ALLY.has(effectType) && !(target === 'ally' && isKoCondition(condition, 'ally'))) return 'This item can only be used as Ally: Status = KO → Use item (Ally)';
  if (target === 'ally' && isKoCondition(condition, 'ally') && !(effectType && REVIVE_ALLY.has(effectType))) return 'Only a revive item can be used on a KO ally';
  if (target === 'foe' && (item?.type === 'food' || effectType === 'food_buff')) return 'Food cannot be used on a foe';
  return null;
}

const label = (t: GambitItemTarget) => (t === 'self' ? 'Self' : t === 'ally' ? 'Ally' : 'Foe');
