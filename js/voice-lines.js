// Member voice lines for combos, finales, and run endings.
// Cosmetic only: never read by game logic, so no save validation is needed.

export const VOICE_LINES = Object.freeze({
  spotlight: Object.freeze({
    ahri: Object.freeze([
      'Feel the charm, darling!',
      'Too slow — follow my lead!'
    ]),
    akali: Object.freeze([
      'Too fast to hit!',
      'Neon strike, lights out!'
    ]),
    evelynn: Object.freeze([
      'Come a little closer...',
      'Mine now — every shield, every heart.'
    ]),
    kaisa: Object.freeze([
      'Evolve and overcome!',
      'Second skin, second wind!'
    ])
  }),
  quartet: Object.freeze([
    'Four voices, one stage!',
    'Together — this is our encore!'
  ]),
  finale: Object.freeze([
    'K/DA — light it up, all together!',
    'This finale is for every fan out there!'
  ]),
  victory: Object.freeze([
    'World tour saved — thank you, fans!',
    'Ten waves down. We are legends!'
  ]),
  defeat: Object.freeze([
    'The stage goes dark... but we will return.',
    'We lost the dome tonight — forgive us.'
  ])
});

export function pickVoiceLine(category, memberId = null, rng = Math.random) {
  let pool = null;
  if (category === 'spotlight' && memberId) {
    pool = VOICE_LINES.spotlight[memberId] || null;
  } else if (Object.hasOwn(VOICE_LINES, category)) {
    pool = VOICE_LINES[category];
  }
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const index = Math.floor(rng() * pool.length) % pool.length;
  const text = pool[index];
  const speaker = category === 'spotlight' && memberId
    ? memberId === 'kaisa' ? "KAI'SA" : memberId.toUpperCase()
    : category === 'quartet' || category === 'finale'
      ? 'K/DA TOGETHER'
      : category === 'victory' || category === 'defeat'
        ? 'K/DA'
        : 'K/DA';
  return { speaker, text };
}
