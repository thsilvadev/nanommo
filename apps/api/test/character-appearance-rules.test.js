const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  HEIGHT_CM_MIN,
  HEIGHT_CM_MAX,
  APPEARANCE_TRAITS,
  SHARED_APPEARANCE_TRAITS,
  heightBandFromCm,
  heightAttributeAdjustment,
  validateAppearanceInput,
  defaultAppearance,
  resolveHandAttachments,
  validateAppearanceCatalog,
  MAX_APPEARANCE_OPTIONS,
} = require('../../../packages/shared/dist');

const root = path.resolve(__dirname, '../../..');
const catalogPath = path.join(root, 'appearance_catalog.json');
const mirrorPath = path.join(root, 'apps/frontend/public/data/appearance_catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

function validInput(overrides = {}) {
  return { sex: 'male', heightCm: 170, appearance: defaultAppearance(), ...overrides };
}
function withAppearance(patch) {
  return validInput({ appearance: { ...defaultAppearance(), ...patch } });
}
function rejects(input, label) {
  const errors = validateAppearanceInput(input, catalog);
  assert.ok(Array.isArray(errors) && errors.length > 0, `must reject: ${label}`);
}

// --- Height bands -----------------------------------------------------------
assert.equal(HEIGHT_CM_MIN, 145);
assert.equal(HEIGHT_CM_MAX, 205);
assert.equal(heightBandFromCm(145), 1);
assert.equal(heightBandFromCm(146), 2);
assert.equal(heightBandFromCm(175), 2);
assert.equal(heightBandFromCm(176), 3);
assert.equal(heightBandFromCm(204), 3);
assert.equal(heightBandFromCm(205), 4);
for (const bad of [144, 206, 175.5, NaN, '170', null]) {
  assert.throws(() => heightBandFromCm(bad), RangeError, `heightBandFromCm must refuse ${String(bad)}`);
}

assert.deepEqual(heightAttributeAdjustment(1), { str: -2, luk: 2 });
assert.deepEqual(heightAttributeAdjustment(2), { str: -1, luk: 1 });
assert.deepEqual(heightAttributeAdjustment(3), { str: 1, luk: -1 });
assert.deepEqual(heightAttributeAdjustment(4), { str: 2, luk: -2 });

assert.equal(MAX_APPEARANCE_OPTIONS, 8);
assert.deepEqual([...APPEARANCE_TRAITS], ['hair', 'hairColor', 'skin', 'face', 'nose', 'mouth', 'mouthDetails', 'chest', 'facialHair', 'piercing', 'tattoo']);
for (const sex of ['male', 'female']) {
  assert.equal(catalog[sex].mouthDetails.length, 8, `${sex} has eight mouth details`);
  assert.equal(catalog[sex].mouth.length, 3, `${sex} has three mouth shapes`);
  for (const option of catalog[sex].mouth) for (const key of ['width', 'thickness']) assert.equal(typeof option.params?.[key], 'number', `${sex}.mouth.${option.id}.${key}`);
  assert.ok(catalog[sex].mouth.every((option) => !option.asset), `${sex} mouth shapes are geometry only`);
  assert.equal(catalog[sex].face.length, 5, `${sex} has five face shapes`);
  for (const option of catalog[sex].face) for (const key of ['jaw', 'chin', 'chinWidth', 'cheeks']) assert.equal(typeof option.params?.[key], 'number', `${sex}.face.${option.id}.${key}`);
}

// --- Default appearance -----------------------------------------------------
const def = defaultAppearance();
assert.equal(def.v, 1);
assert.deepEqual(Object.keys(def).sort(), ['v', ...APPEARANCE_TRAITS].sort());
for (const trait of APPEARANCE_TRAITS) assert.equal(def[trait], 0);
assert.notEqual(defaultAppearance(), defaultAppearance(), 'defaultAppearance returns a fresh object');

// --- Validation against the real catalogue ----------------------------------
assert.deepEqual(validateAppearanceInput(validInput(), catalog), []);
assert.deepEqual(validateAppearanceInput(validInput({ sex: 'female', heightCm: 145 }), catalog), []);
assert.deepEqual(validateAppearanceInput(validInput({ heightCm: 205 }), catalog), []);
for (const sex of ['male', 'female']) {
  const last = { v: 1 };
  for (const trait of APPEARANCE_TRAITS) last[trait] = catalog[sex][trait].length - 1;
  assert.deepEqual(validateAppearanceInput({ sex, heightCm: 180, appearance: last }, catalog), [], `last option of every ${sex} trait is valid`);
}

rejects(null, 'null input');
rejects(undefined, 'undefined input');
rejects([], 'array input');
rejects('x', 'string input');
rejects(validInput({ sex: 'other' }), 'unknown sex');
rejects(validInput({ sex: undefined }), 'missing sex');
rejects(validInput({ heightCm: 144 }), 'height below range');
rejects(validInput({ heightCm: 206 }), 'height above range');
rejects(validInput({ heightCm: 175.5 }), 'fractional height');
rejects(validInput({ heightCm: '170' }), 'height as string');
rejects(validInput({ appearance: null }), 'null appearance');
rejects(validInput({ appearance: [] }), 'array appearance');
rejects({ ...validInput(), extra: 1 }, 'unknown top-level key');
rejects(withAppearance({ v: 2 }), 'unsupported appearance version');
rejects(withAppearance({ hair: '2' }), 'index as string');
rejects(withAppearance({ hair: 1.5 }), 'fractional index');
rejects(withAppearance({ hair: -1 }), 'negative index');
rejects(withAppearance({ hair: catalog.male.hair.length }), 'index equal to list length');
rejects(withAppearance({ wings: 0 }), 'unknown appearance key');
{
  const missing = defaultAppearance();
  delete missing.tattoo;
  rejects(validInput({ appearance: missing }), 'missing trait');
}
{
  // An index valid for one sex must be rejected for the other when the lists differ in size.
  const trait = APPEARANCE_TRAITS.find((t) => catalog.male[t].length !== catalog.female[t].length);
  if (trait) {
    const longer = catalog.male[trait].length > catalog.female[trait].length ? 'male' : 'female';
    const shorter = longer === 'male' ? 'female' : 'male';
    const index = catalog[longer][trait].length - 1;
    assert.deepEqual(validateAppearanceInput({ sex: longer, heightCm: 170, appearance: { ...defaultAppearance(), [trait]: index } }, catalog), []);
    rejects({ sex: shorter, heightCm: 170, appearance: { ...defaultAppearance(), [trait]: index } }, `index out of the ${shorter} ${trait} list`);
  }
}
assert.doesNotThrow(() => validateAppearanceInput(validInput(), null), 'a missing catalogue is reported, not thrown');
assert.ok(validateAppearanceInput(validInput(), null).length > 0);

// --- Hand attachments -------------------------------------------------------
assert.deepEqual(resolveHandAttachments('right', 'dagger', null), { right: 'dagger', left: null });
assert.deepEqual(resolveHandAttachments('left', 'dagger', null), { right: null, left: 'dagger' });
assert.deepEqual(resolveHandAttachments('left', 'sword', 'shield'), { right: 'shield', left: 'sword' });
assert.deepEqual(resolveHandAttachments('right', 'sword', 'shield'), { right: 'sword', left: 'shield' });
assert.deepEqual(resolveHandAttachments('left', 'dagger', 'dagger'), { right: 'dagger', left: 'dagger' });
assert.deepEqual(resolveHandAttachments('right', 'greatsword', null), { right: 'greatsword', left: null });
assert.deepEqual(resolveHandAttachments('left', 'bow', null), { right: null, left: 'bow' });
assert.deepEqual(resolveHandAttachments('right', null, null), { right: null, left: null });

// --- Catalogue shape --------------------------------------------------------
assert.equal(catalog.version, 1);
assert.deepEqual([...SHARED_APPEARANCE_TRAITS].sort(), ['piercing', 'tattoo']);
for (const sex of ['male', 'female']) {
  assert.deepEqual(Object.keys(catalog[sex]).sort(), [...APPEARANCE_TRAITS].sort(), `${sex} declares exactly the eleven traits`);
  for (const trait of APPEARANCE_TRAITS) {
    const options = catalog[sex][trait];
    assert.ok(Array.isArray(options) && options.length >= 1 && options.length <= MAX_APPEARANCE_OPTIONS, `${sex}.${trait} has 1–${MAX_APPEARANCE_OPTIONS} options`);
    const ids = options.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, `${sex}.${trait} ids are unique`);
    for (const option of options) {
      assert.ok(typeof option.id === 'string' && option.id.length > 0, `${sex}.${trait} option id`);
      // Same shape as every other catalogue: { locales: { 'pt-BR', 'en-US' } } (LocaleService keys).
      for (const locale of ['en-US', 'pt-BR']) {
        assert.ok(typeof option.name?.locales?.[locale] === 'string' && option.name.locales[locale].trim().length > 0, `${sex}.${trait}.${option.id} has a ${locale} name`);
      }
    }
  }
  for (const trait of ['hairColor', 'skin']) {
    for (const option of catalog[sex][trait]) assert.match(option.color, /^#[0-9a-f]{6}$/i, `${sex}.${trait}.${option.id} colour`);
  }
  for (const trait of ['piercing', 'tattoo']) assert.equal(catalog[sex][trait][0].id, 'none', `${sex}.${trait}[0] is "none"`);
}
assert.equal(catalog.male.facialHair[0].id, 'none');
for (const trait of SHARED_APPEARANCE_TRAITS) {
  assert.deepEqual(catalog.male[trait], catalog.female[trait], `${trait} is shared between sexes`);
}

// --- Catalogue validator (used by DataService at boot) -----------------------
assert.deepEqual(validateAppearanceCatalog(catalog), [], 'the shipped catalogue is valid');
function brokenCatalog(mutate) {
  const copy = JSON.parse(JSON.stringify(catalog));
  mutate(copy);
  return validateAppearanceCatalog(copy);
}
assert.ok(validateAppearanceCatalog(null).length > 0, 'null catalogue');
assert.ok(brokenCatalog((c) => { c.version = 2; }).length > 0, 'wrong version');
assert.ok(brokenCatalog((c) => { delete c.female; }).length > 0, 'missing sex');
assert.ok(brokenCatalog((c) => { delete c.male.nose; }).length > 0, 'missing trait');
assert.ok(brokenCatalog((c) => { c.male.wings = []; }).length > 0, 'unknown trait');
assert.ok(brokenCatalog((c) => { c.male.hair = []; }).length > 0, 'empty list');
assert.ok(brokenCatalog((c) => { for (let i = c.male.mouthDetails.length; i <= MAX_APPEARANCE_OPTIONS; i++) c.male.mouthDetails.push({ ...c.male.mouthDetails[0], id: `extra${i}` }); }).length > 0, 'more than eight options');
assert.ok(brokenCatalog((c) => { c.male.skin[1].id = c.male.skin[0].id; }).length > 0, 'duplicate id');
assert.ok(brokenCatalog((c) => { delete c.female.mouth[0].name.locales['pt-BR']; }).length > 0, 'missing pt name');
assert.ok(brokenCatalog((c) => { c.male.skin[0].color = 'red'; }).length > 0, 'invalid colour');
assert.ok(brokenCatalog((c) => { c.female.tattoo = c.female.tattoo.slice(0, 2); }).length > 0, 'shared trait differs between sexes');
assert.ok(brokenCatalog((c) => { c.male.piercing[0].id = 'ring'; c.female.piercing[0].id = 'ring'; }).length > 0, 'optional trait without "none" first');

// --- Mirror -----------------------------------------------------------------
assert.ok(fs.existsSync(mirrorPath), 'frontend mirror exists');
assert.ok(fs.readFileSync(catalogPath).equals(fs.readFileSync(mirrorPath)), 'frontend mirror is byte-identical to the canonical catalogue');
assert.match(fs.readFileSync(path.join(root, 'scripts/sync-frontend-data.js'), 'utf8'), /'appearance_catalog\.json'/);

console.log('character-appearance-rules: height bands, adjustments, validation, hand attachments, catalogue shape and mirror passed');
