const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const npcCatalog = JSON.parse(fs.readFileSync(path.join(root, 'npc_catalog.json'), 'utf8'));
const quests = JSON.parse(fs.readFileSync(path.join(root, 'quests.json'), 'utf8')).quests;
const locales = ['pt-BR', 'en-US'];

function requireLocales(owner, field, metadata, pathLabel) {
  assert(metadata && typeof metadata === 'object', pathLabel + ' is missing locale metadata for ' + field);
  for (const locale of locales) {
    assert.equal(typeof metadata[locale], 'string', pathLabel + '.' + field + ' is missing ' + locale);
    assert(metadata[locale].trim().length > 0, pathLabel + '.' + field + ' has an empty ' + locale + ' value');
  }
}
function dialogueNode(node, pathLabel) {
  if (node.npcText) requireLocales(node, 'npcText', node.npcTextLocales, pathLabel);
  for (const choice of node.choices ?? []) {
    if (choice.text) requireLocales(choice, 'text', choice.textLocales, pathLabel + '.choice.' + choice.id);
  }
}
function localizedFields(record, fields, pathLabel) {
  for (const field of fields) {
    const key = field + 'Locales';
    if (record[field]) requireLocales(record, field, record[key], pathLabel);
  }
}
for (const npc of npcCatalog.npcs) {
  requireLocales(npc, 'name', Object.fromEntries(locales.map(locale => [locale, npc.locales?.[locale]?.name])), 'npc.' + npc.id);
  for (const field of ['greeting', 'monologue']) {
    const canonical = npc[field] ?? (field === 'greeting' ? npc.vendor?.greeting : undefined);
    // Locale-only greetings are valid: this avoids repeating en-US text in a top-level field.
    const hasLocalizedValue = locales.some(locale => typeof npc.locales?.[locale]?.[field] === 'string' && npc.locales[locale][field].trim());
    if (canonical || hasLocalizedValue) requireLocales(npc, field, Object.fromEntries(locales.map(locale => [locale, npc.locales?.[locale]?.[field]])), 'npc.' + npc.id);
  }
  for (const [nodeId, node] of Object.entries(npc.dialogue?.nodes ?? {})) dialogueNode(node, 'npc.' + npc.id + '.dialogue.' + nodeId);
}
const paje = npcCatalog.npcs.find(npc => npc.id === 'paje_piata');
assert(paje, 'Pajé Piatã must exist in the Town NPC catalogue');
assert.equal(Object.prototype.hasOwnProperty.call(paje, 'greeting'), false, 'Pajé greeting must have one locale-based source, not a duplicate top-level English field');
assert.equal(paje.types.includes('dialogue'), true, 'Pajé keeps ordinary dialogue, unified with the quest speech surface');
assert.equal(paje.dialogue.nodes.greeting.choices.some(choice => choice.id === 'forest_quest'), false, 'Quest start is supplied by the state-aware quest action, not a duplicate dialogue option');
assert.equal(paje.dialogue.nodes.greeting.choices.some(choice => choice.id === 'alchemy'), true, 'Ordinary Alchemy choice remains in the unified conversation UI');
assert.equal(paje.dialogue.nodes.greeting.choices.find(choice => choice.id === 'farewell')?.close, true, 'Farewell returns to the catalogue greeting instead of replaying the same dialogue node');
assert.equal(paje.locales?.['pt-BR']?.greeting, 'Aruandê, viajante. A floresta guarda presentes e histórias.');
assert.equal(paje.locales?.['en-US']?.greeting, 'Aruandê, traveler. The forest holds gifts and stories.');

for (const quest of quests) {
  requireLocales(quest, 'title', quest.titleLocales, 'quest.' + quest.id);
  requireLocales(quest, 'description', quest.descriptionLocales, 'quest.' + quest.id);
  for (let i = 0; i < (quest.offerDialogue ?? []).length; i++) localizedFields(quest.offerDialogue[i], ['npcText', 'buttonText'], 'quest.' + quest.id + '.offerDialogue[' + i + ']');
  for (const [nodeId, node] of Object.entries(quest.offerGraph?.nodes ?? {})) dialogueNode(node, 'quest.' + quest.id + '.offerGraph.' + nodeId);
  localizedFields(quest.activeDialogue ?? {}, ['npcText', 'waitButtonText', 'handleItemsButtonText', 'readyButtonText'], 'quest.' + quest.id + '.activeDialogue');
  localizedFields(quest.completionDialogue ?? {}, ['npcText', 'buttonText'], 'quest.' + quest.id + '.completionDialogue');
  for (const objective of quest.objectives ?? []) localizedFields(objective, ['description'], 'quest.' + quest.id + '.objective.' + objective.id);
}
console.log('NPC and quest runtime locale completeness: all catalogue dialogue/name/quest fields have pt-BR and en-US values.');
