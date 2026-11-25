/** Curated terms; keep ambiguous identity and animal words out of this list. */
const TERMS = [
  'fdp', 'puta', 'putas', 'puto', 'putos', 'vagabunda', 'vagabundas', 'vagabundo',
  'bitch', 'bitches', 'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'asshole',
  'caralho', 'porra', 'merda', 'filho da puta', 'filha da puta', 'vai se foder',
  'foda se', 'fuder', 'fudido', 'fudida', 'arrombado', 'arrombada', 'cuzao',
  'nigger', 'nigga', 'faggot', 'retard', 'nazista', 'nazi',
];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function containsProhibitedLanguage(value: string, name = false): boolean {
  const normalized = normalize(value);
  if (!normalized) return false;
  if (name) return TERMS.some(term => normalized.includes(normalize(term).replace(/ /g, '')));
  const padded = ` ${normalized} `;
  return TERMS.some(term => padded.includes(` ${normalize(term)} `));
}
