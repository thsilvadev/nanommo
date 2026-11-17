export const CHARACTER_3D_CUTOVER_FLAG = 'CHARACTER_3D_CUTOVER_COMPLETE';

interface QueryableDataSource {
  query(sql: string, parameters?: unknown[]): Promise<any[]>;
}

/**
 * Fail-closed startup check for the 3D character cutover.
 *
 * A character with no appearance must be parked in Town with nothing queued:
 * the action block keeps it there until its owner goes through the creator.
 * The operator flag alone is not trusted — the data is checked as well, so a
 * skipped cutover or a restored backup cannot leave such a character grinding.
 */
export async function assertCharacter3dCutoverComplete(env: NodeJS.ProcessEnv, dataSource: QueryableDataSource): Promise<void> {
  if (env[CHARACTER_3D_CUTOVER_FLAG] !== 'true') {
    throw new Error(`${CHARACTER_3D_CUTOVER_FLAG} is not "true". Run the guarded 3D character cutover (docs/deployment/character-3d-cutover.md) and set the flag before starting the API.`);
  }
  const stray = await dataSource.query(
    `SELECT c."id" FROM "characters" c
      WHERE c."appearance" IS NULL
        AND (c."status" <> 'town'
          OR EXISTS (SELECT 1 FROM "battle_queue_entries" b WHERE b."characterId" = c."id" AND b."resolved" = false))
      LIMIT 1`,
  );
  if (stray.length > 0) {
    throw new Error(`Character ${stray[0].id} has no 3D appearance but is outside Town or still has queued battles. Startup refuses to continue: rerun the guarded 3D character cutover (docs/deployment/character-3d-cutover.md).`);
  }
}
