/** One elemental contract for combat, equipment projections and comparisons. */
export const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'holy', 'shadow'] as const;
export type Element = 'neutral' | typeof ELEMENTS[number];
export type ElementalResistances = Record<typeof ELEMENTS[number], number>;
export function normalizeElement(value: unknown): Element {
  const element = String(value ?? 'neutral').toLowerCase();
  if (element === 'light') return 'holy';
  if (element === 'ice') return 'water';
  if (element === 'lightning') return 'wind';
  return (ELEMENTS as readonly string[]).includes(element) ? element as Element : 'neutral';
}
const ADVANTAGE: Partial<Record<Element, Element>> = { fire: 'earth', earth: 'wind', wind: 'water', water: 'fire', holy: 'shadow', shadow: 'holy' };
export function elementalMultiplier(damageElement: unknown, targetAffinity: unknown): number {
  const damage = normalizeElement(damageElement), target = normalizeElement(targetAffinity);
  if (damage === 'neutral' || target === 'neutral') return 1;
  if (damage === target) return 0.5;
  if (ADVANTAGE[damage] === target) return 1.5;
  if (ADVANTAGE[target] === damage) return 0.75;
  return 1;
}
/** Positive resistance reduces damage; negative resistance is vulnerability. */
export function elementalResistances(affinity: unknown): ElementalResistances {
  return Object.fromEntries(ELEMENTS.map(element => [element, (1 - elementalMultiplier(element, affinity)) * 100])) as ElementalResistances;
}
export function itemAffinity(definition: any): Element {
  return normalizeElement(definition?.fixedStats?.elementalAffinity ?? definition?.fixedStats?.elementalImmunity);
}
export function equipmentAffinity(rows: readonly { slot?: string; definition?: any; instanceData?: any }[]): Element {
  const boots = rows.find(row => (row.slot ?? row.definition?.slot) === 'shoes');
  return itemAffinity(boots?.definition);
}
/** Instance enchantments override catalogue elements. An enchantment never changes defense. */
export function weaponElement(definition: any, instanceData?: any): Element {
  return normalizeElement(instanceData?.enchantedElement ?? instanceData?.element ?? definition?.element ?? definition?.fixedStats?.element);
}
export interface BasicAttackElement { slot: 'mainHand' | 'offHand'; element: Element; attack: number }
/** The existing combined strike keeps one hit/crit roll; secondary ATK carries its own element. */
export function basicAttackElementMultiplier(source: { atk: number; element?: unknown; basicAttackElement?: unknown; basicAttackElements?: BasicAttackElement[] }, target: { element?: unknown }): number {
  const hands = source.basicAttackElements ?? [];
  const primary = hands.find(hand => hand.slot === 'mainHand');
  const secondary = hands.find(hand => hand.slot === 'offHand');
  const secondaryShare = secondary ? Math.min(1, Math.max(0, secondary.attack) / Math.max(1, source.atk)) : 0;
  return elementalMultiplier(primary?.element ?? source.basicAttackElement ?? source.element, target.element) * (1 - secondaryShare)
    + elementalMultiplier(secondary?.element, target.element) * secondaryShare;
}

/** Resolve catalogue/instance weapon elements once when building an immutable encounter snapshot. */
export function equipmentElementSnapshot(rows: readonly { slot?: string; definition?: any; instanceData?: any }[]): { element: Element; basicAttackElement: Element; basicAttackElements: BasicAttackElement[] } {
  const hands = rows.flatMap(row => {
    const item = row.definition;
    if (!item?.weaponType || !['mainHand', 'offHand'].includes(String(row.slot)) || ['shield', 'rune'].includes(item.weaponType)) return [];
    const rolled = row.instanceData?.rolledStat === 'atk' ? Math.max(0, Number(row.instanceData.rolledStatValue ?? 0)) : 0;
    const attack = Math.max(0, Number(item.fixedStats?.atk ?? 0)) + rolled;
    return [{ slot: row.slot as BasicAttackElement['slot'], element: weaponElement(item, row.instanceData), attack: row.slot === 'offHand' ? Math.floor(Math.max(0, Number(item.fixedStats?.atk ?? 0)) / 2) + Math.floor(rolled / 2) : attack }];
  });
  return { element: equipmentAffinity(rows), basicAttackElement: hands.find(hand => hand.slot === 'mainHand')?.element ?? 'neutral', basicAttackElements: hands };
}
