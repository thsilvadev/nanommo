import { MigrationInterface, QueryRunner } from 'typeorm';

/** One-time repair of duplicate legacy Diet slots; inventory quantities are untouched. */
export class DietUniqueFoodStreakRotation1797000000000 implements MigrationInterface {
  name = 'DietUniqueFoodStreakRotation1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; diet: any[] | null; dietLevels: Record<string, any> | null }> =
      await queryRunner.query('SELECT id, diet, "dietLevels" FROM characters');
    for (const row of rows) {
      const source = Array.isArray(row.diet) ? row.diet : [];
      const levels = row.dietLevels ?? {};
      const merged = new Map<string, any>();
      for (const entry of source) {
        if (!entry?.itemId) continue;
        const old = merged.get(entry.itemId);
        const oldTime = old ? Date.parse(old.consumedAt) || 0 : -1;
        const newTime = Date.parse(entry.consumedAt) || 0;
        const digestUntil = [entry.digestUntil, old?.digestUntil, levels[entry.itemId]?.lastDigestUntil]
          .filter(Boolean).sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0] ?? entry.digestUntil;
        const dietLevel = Math.max(0, Math.min(3, Number(entry.dietLevel ?? 0)), Number(old?.dietLevel ?? 0));
        if (!old || newTime >= oldTime) merged.set(entry.itemId, { ...entry, digestUntil, dietLevel });
        else { old.digestUntil = digestUntil; old.dietLevel = dietLevel; }
      }
      const diet = [...merged.values()].sort((a, b) => (Date.parse(a.consumedAt) || 0) - (Date.parse(b.consumedAt) || 0)).slice(-3);
      const retained = new Set(diet.map((entry) => entry.itemId));
      const dietLevels: Record<string, { level: number; lastDigestUntil: string }> = {};
      for (const [itemId, value] of Object.entries(levels)) {
        const lastDigestUntil = (value as any)?.lastDigestUntil;
        if (lastDigestUntil) dietLevels[itemId] = { level: retained.has(itemId) ? Math.max(0, Math.min(3, Number((value as any).level ?? 0))) : 0, lastDigestUntil };
      }
      for (const entry of diet) {
        const oldDigest = dietLevels[entry.itemId]?.lastDigestUntil;
        const lastDigestUntil = [entry.digestUntil, oldDigest].filter(Boolean)
          .sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0] ?? entry.digestUntil;
        entry.digestUntil = lastDigestUntil;
        dietLevels[entry.itemId] = { level: Math.max(0, Math.min(3, Number(entry.dietLevel ?? 0))), lastDigestUntil };
      }
      await queryRunner.query('UPDATE characters SET diet = $1::jsonb, "dietLevels" = $2::jsonb WHERE id = $3', [JSON.stringify(diet), JSON.stringify(dietLevels), row.id]);
    }
  }

  public async down(): Promise<void> {
    throw new Error('Diet duplicate normalization is intentionally irreversible');
  }
}
