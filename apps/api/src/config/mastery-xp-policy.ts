export function getMasteryXpPolicy(env: NodeJS.ProcessEnv = process.env) {
  const read = (name: string, fallback: number) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
    return parsed;
  };
  return {
    twoHandedAction: read('MASTERY_XP_TWO_HANDED_ACTION', 2),
    oneHandedAction: read('MASTERY_XP_ONE_HANDED_ACTION', 1),
    shieldOnHit: read('MASTERY_XP_SHIELD_ON_HIT', 1),
    runeOnHit: read('MASTERY_XP_RUNE_ON_HIT', 1),
  };
}
