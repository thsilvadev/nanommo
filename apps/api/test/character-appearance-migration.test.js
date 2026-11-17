const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const COLUMNS = { sex: 'varchar(6)', height: 'smallint', heightCm: 'smallint', appearance: 'jsonb' };

(async () => {
  const { CharacterAppearance1800400000000 } = require('../dist/apps/api/src/database/migrations/1800400000000-CharacterAppearance');
  const migration = new CharacterAppearance1800400000000();
  assert.equal(migration.name, 'CharacterAppearance1800400000000');

  const up = [];
  await migration.up({ query: async (sql) => { up.push(String(sql)); } });
  assert.equal(up.length, 4, 'one statement per column');
  for (const [column, type] of Object.entries(COLUMNS)) {
    const statement = up.find((sql) => sql.includes(`"${column}" `));
    assert.ok(statement, `migration adds ${column}`);
    assert.match(statement, /^ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS /);
    assert.ok(statement.toLowerCase().includes(`"${column.toLowerCase()}" ${type}`), `${column} is ${type}`);
    assert.ok(!/NOT NULL|DEFAULT/i.test(statement), `${column} is nullable with no default: NULL means "no appearance yet"`);
  }
  assert.ok(!up.some((sql) => /\b(UPDATE|DELETE|INSERT)\b/i.test(sql)), 'migration does not rewrite existing characters');

  const down = [];
  await migration.down({ query: async (sql) => { down.push(String(sql)); } });
  for (const column of Object.keys(COLUMNS)) {
    assert.ok(down.some((sql) => sql === `ALTER TABLE "characters" DROP COLUMN IF EXISTS "${column}"`), `down drops ${column}`);
  }

  // Entity, DTO and frontend model expose the four nullable fields.
  const { getMetadataArgsStorage } = require('typeorm');
  const { Character } = require('../dist/apps/api/src/database/entities/character.entity');
  const columns = getMetadataArgsStorage().columns.filter((c) => c.target === Character);
  for (const [column, type] of Object.entries(COLUMNS)) {
    const meta = columns.find((c) => c.propertyName === column);
    assert.ok(meta, `Character entity declares ${column}`);
    assert.equal(meta.options.nullable, true, `${column} is nullable on the entity`);
    assert.equal(meta.options.name ?? column, column, `${column} keeps its camelCase column name`);
    assert.equal(meta.options.type, type.replace(/\(.*/, ''), `${column} entity type`);
    assert.ok(!('default' in meta.options) || meta.options.default === undefined, `${column} has no default`);
  }

  const dtoSource = fs.readFileSync(path.join(root, 'packages/shared/src/dto/index.ts'), 'utf8');
  const characterDto = dtoSource.slice(dtoSource.indexOf('export class CharacterDto'));
  for (const field of ['sex!: Sex | null', 'height!: HeightBand | null', 'heightCm!: number | null', 'appearance!: CharacterAppearance | null']) {
    assert.ok(characterDto.includes(field), `CharacterDto declares ${field}`);
  }
  const createDto = dtoSource.slice(dtoSource.indexOf('export class CreateCharacterDto'), dtoSource.indexOf('export class SpendAttributePointsDto'));
  for (const field of ['name!: string', "dominantHand!: 'right' | 'left'", 'sex!: Sex', 'heightCm!: number', 'appearance!: CharacterAppearance']) {
    assert.ok(createDto.includes(field), `CreateCharacterDto declares ${field}`);
  }
  assert.match(dtoSource, /export class SetCharacterAppearanceDto implements AppearanceInput/);

  const models = fs.readFileSync(path.join(root, 'apps/frontend/src/app/core/game.models.ts'), 'utf8');
  const characterModel = models.slice(models.indexOf('export interface Character '), models.indexOf('}', models.indexOf('export interface Character ')));
  for (const field of ['sex:', 'height:', 'heightCm:', 'appearance:']) assert.ok(characterModel.includes(field), `frontend Character declares ${field}`);

  // The DTO mapper carries the fields through, with null for characters that have none.
  const service = fs.readFileSync(path.join(root, 'apps/api/src/modules/character/character.service.ts'), 'utf8');
  for (const field of ['sex', 'height', 'heightCm', 'appearance']) {
    assert.match(service, new RegExp(`${field}: character\\.${field} \\?\\? null`), `CharacterDto mapper returns ${field}`);
  }

  console.log('character-appearance-migration: additive nullable columns, reversible down, entity/DTO/model fields passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
