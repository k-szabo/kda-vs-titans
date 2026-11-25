import { isValidDefaultKeybinds } from './keybinds.js';
import { TOUR_EVENTS } from './tour-events.js';

const DATA_MANIFEST_URL = new URL('../assets/data.json', import.meta.url);
const CACHE_VERSION_KEY = 'kda-vs-titans:cache-version';

// Buff cards declare a single persistent trigger instead of immediate effects.
const SUPPORTED_BUFFS = Object.freeze({
  passive: Object.freeze(['bonusAttackDamage']),
  turnStart: Object.freeze(['gainBlock', 'heal', 'gainEnergy']),
  onLethal: Object.freeze(['revive']),
  onDamage: Object.freeze(['negateDamage'])
});

const CARD_EFFECT_TYPES = Object.freeze(['damage', 'gainBlock', 'stealBlock', 'healPlayer', 'applyEnemyStatus', 'addPlayerStatus', 'clearPlayerStatus', 'addCheer', 'draw', 'gainEnergy', 'raiseHandLimit']);
const CARD_MEMBER_IDS = Object.freeze(['ahri', 'akali', 'evelynn', 'kaisa']);
const RELIC_EFFECTS = Object.freeze([
  { trigger: 'stageStart', type: 'startingEnergy' },
  { trigger: 'stageStart', type: 'startingBlock' },
  { trigger: 'waveClear', type: 'maxHp' },
  { trigger: 'stageStart', type: 'heal' },
  { trigger: 'waveClear', type: 'heal' },
  { trigger: 'attackPlayed', type: 'gainBlock' },
  { trigger: 'cardPlayed', type: 'cheerGainPercent' },
  { trigger: 'attackPlayed', type: 'zeroCostAttackDamage' },
  { trigger: 'skillPlayed', type: 'charmDuration' },
  { trigger: 'skillPlayed', type: 'skillGainBlock' }
]);
const STAGE_EFFECTS = Object.freeze(['overcharge_grid', 'thermonuclear_heat', 'luminous_spores']);
const MISSION_STATS = Object.freeze({
  run: Object.freeze(['wavesCleared', 'peakDamage', 'deckSize', 'relicCount', 'isVictory', 'encoreLevel', 'runSeconds']),
  profile: Object.freeze(['bestWave', 'maxEncore', 'maxEncoreAhri', 'maxEncoreAkali', 'maxEncoreEvelynn', 'maxEncoreKaisa', 'streakBest', 'totalWins', 'winsAhri', 'winsAkali', 'winsEvelynn', 'winsKaisa'])
});
const TOUR_EVENT_REQUIRES = new Set(['canCut', 'hasRelicAvailable', 'canTune', 'canUpgrade', 'canBleed']);
const VERSION_PATTERN = /^v\d+\.\d+\.\d+_[0-9a-f]{8}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Per-file validators below throw a single Error listing every problem found
// (capped). Each line names the offending entry so broken data is one glance
// away from the fix instead of one generic message.
function failWith(file, problems) {
  const shown = problems.slice(0, 8);
  const more = problems.length > shown.length ? `\n- …and ${problems.length - shown.length} more` : '';
  throw new Error(`Invalid ${file} (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n- ${shown.join('\n- ')}${more}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateManifest(manifest) {
  const problems = [];
  const need = (cond, reason) => { if (!cond) problems.push(reason); };
  need(typeof manifest?.version === 'string', 'missing string "version"');
  need(isRecord(manifest?.portraits), 'missing "portraits"');
  need(isRecord(manifest?.leaderArts), 'missing "leaderArts"');
  need(isRecord(manifest?.backdrops), 'missing "backdrops"');
  need(typeof manifest?.cards === 'string' && manifest.cards, 'missing "cards" path');
  need(typeof manifest?.relics === 'string' && manifest.relics, 'missing "relics" path');
  need(typeof manifest?.missions === 'string' && manifest.missions, 'missing "missions" path');
  need(typeof manifest?.keybinds === 'string' && manifest.keybinds, 'missing "keybinds" path');
  need(typeof manifest?.changelog === 'string' && manifest.changelog, 'missing "changelog" path');
  need(Array.isArray(manifest?.encounterPools) && manifest.encounterPools.length > 0, 'missing non-empty "encounterPools"');
  (manifest?.encounterPools || []).forEach((slot, index) => {
    if (!Array.isArray(slot) || slot.length === 0) problems.push(`encounterPools[${index}] is not a non-empty array`);
    else slot.forEach((bossPath) => {
      if (typeof bossPath !== 'string') problems.push(`encounterPools[${index}] has a non-string boss path`);
    });
  });
  for (const leaderId of CARD_MEMBER_IDS) {
    const portraits = manifest?.portraits?.[leaderId];
    const arts = manifest?.leaderArts?.[leaderId];
    if (typeof portraits !== 'string') problems.push(`portraits missing "${leaderId}" splash`);
    if (!isRecord(arts)) problems.push(`leaderArts missing "${leaderId}" entry`);
    else for (const art of ['more', 'firestarter', 'prestige']) {
      if (typeof arts[art] !== 'string') problems.push(`leaderArts["${leaderId}"] missing "${art}" splash`);
    }
  }
  if (problems.length > 0) failWith('data.json', problems);
}

function checkCardEffect(effect, index) {
  if (!effect || typeof effect !== 'object') return `effects[${index}]: not an object`;
  if (typeof effect.type !== 'string') return `effects[${index}]: missing type`;
  if (!CARD_EFFECT_TYPES.includes(effect.type)) return `effects[${index}]: unknown type "${effect.type}"`;
  if (effect.upgradeAmount !== undefined && (!Number.isFinite(effect.upgradeAmount) || effect.upgradeAmount < 0)) {
    return `effects[${index}]: bad upgradeAmount`;
  }
  if (effect.type === 'damage') {
    if (!Number.isFinite(effect.amount) || effect.amount <= 0) return `effects[${index}]: damage needs amount > 0`;
    if (effect.pierce !== undefined && (!Number.isFinite(effect.pierce) || effect.pierce < 0 || effect.pierce > 1)) {
      return `effects[${index}]: pierce must be 0..1`;
    }
    if (effect.hits !== undefined && (!Number.isInteger(effect.hits) || effect.hits < 1)) {
      return `effects[${index}]: hits must be an integer >= 1`;
    }
  }
  if (effect.type === 'stealBlock' && (!Number.isFinite(effect.amount) || effect.amount <= 0)) {
    return `effects[${index}]: stealBlock needs amount > 0`;
  }
  if (effect.when !== undefined) {
    if (!isRecord(effect.when)) return `effects[${index}]: when is not an object`;
    if (!['enemy', 'player'].includes(effect.when.target)) return `effects[${index}]: when.target must be enemy|player`;
    if (typeof effect.when.status !== 'string') return `effects[${index}]: when.status must be a string`;
  }
  return null;
}

function checkCard(card) {
  const id = typeof card?.id === 'string' ? `"${card.id}"` : '(missing id)';
  const bad = (reason) => `card ${id}: ${reason}`;
  if (!isRecord(card)) return bad('not an object');
  if (typeof card.id !== 'string') return bad('missing string id');
  if (!Array.isArray(card.effects)) return bad('missing effects array');
  if (!card.log) return bad('missing log block');
  for (const key of ['draftable', 'ethereal', 'retain', 'retainInHand']) {
    if (card[key] !== undefined && typeof card[key] !== 'boolean') return bad(`"${key}" must be a boolean`);
  }
  if (card.endTurnDamage !== undefined &&
    (!Number.isFinite(card.endTurnDamage) || card.endTurnDamage <= 0 || card.type !== 'STATUS' || card.ethereal !== true)) {
    return bad('endTurnDamage requires a STATUS card with ethereal:true and amount > 0');
  }
  if (card.art !== undefined && typeof card.art !== 'string') return bad('"art" must be a URL string');
  if (card.costReductionIf !== undefined) {
    const duo = card.costReductionIf;
    if (!isRecord(duo)) return bad('costReductionIf is not an object');
    if (!CARD_MEMBER_IDS.includes(duo.member)) return bad(`costReductionIf.member must be one of ${CARD_MEMBER_IDS.join(', ')}`);
    if (!Number.isInteger(duo.amount) || duo.amount <= 0) return bad('costReductionIf.amount must be a positive integer');
    const extra = Object.keys(duo).filter((key) => key !== 'member' && key !== 'amount');
    if (extra.length > 0) return bad(`costReductionIf has unknown keys: ${extra.join(', ')}`);
  }
  if (card.requires !== undefined) {
    const req = card.requires;
    if (!isRecord(req)) return bad('requires is not an object');
    const keys = Object.keys(req);
    if (keys.length === 0) return bad('requires is empty');
    for (const key of keys) {
      if (key !== 'firstCard' && key !== 'lastEnergy') return bad(`requires has unknown key "${key}"`);
      if (req[key] !== true) return bad(`requires.${key} must be true`);
    }
  }
  if (card.type === 'BUFF') {
    const buff = card.buff;
    if (!isRecord(buff)) return bad('BUFF card needs a buff block');
    if (typeof buff.trigger !== 'string' || typeof buff.effect !== 'string') return bad('buff needs string trigger + effect');
    if (!SUPPORTED_BUFFS[buff.trigger]?.includes(buff.effect)) {
      return bad(`unsupported buff pair ${buff.trigger}/${buff.effect}`);
    }
    if (!Number.isFinite(buff.amount) || buff.amount <= 0) return bad('buff.amount must be > 0');
    if (buff.duration !== undefined && (!Number.isInteger(buff.duration) || buff.duration < 1)) {
      return bad('buff.duration must be an integer >= 1');
    }
    if (buff.upgradeAmount !== undefined && (!Number.isFinite(buff.upgradeAmount) || buff.upgradeAmount < 0)) {
      return bad('buff.upgradeAmount must be >= 0');
    }
  } else if (card.buff !== undefined) {
    return bad('non-BUFF card must not have a buff block');
  }
  if (card.upgrade !== undefined) {
    if (!isRecord(card.upgrade)) return bad('upgrade is not an object');
    if (typeof card.upgrade.description !== 'string') return bad('upgrade needs a description');
    if (card.upgrade.costReduction !== undefined &&
      (!Number.isInteger(card.upgrade.costReduction) || card.upgrade.costReduction < 0 || card.upgrade.costReduction > card.cost)) {
      return bad('upgrade.costReduction must be an integer within the card cost');
    }
  }
  for (let i = 0; i < card.effects.length; i++) {
    const problem = checkCardEffect(card.effects[i], i);
    if (problem) return bad(problem);
  }
  return null;
}

export function validateCards(cardData) {
  const problems = [];
  if (!isRecord(cardData) || !Array.isArray(cardData.cards) || cardData.cards.length === 0) {
    throw new Error('Invalid cards.json: missing non-empty "cards" array.');
  }
  const seen = new Set();
  for (const card of cardData.cards) {
    if (typeof card?.id === 'string') {
      if (seen.has(card.id)) problems.push(`card "${card.id}": duplicate id`);
      seen.add(card.id);
    }
    const problem = checkCard(card);
    if (problem) problems.push(problem);
  }
  const starterDecks = cardData.starterDecks;
  const decksValid = isRecord(starterDecks) && CARD_MEMBER_IDS.every((id) =>
    Array.isArray(starterDecks[id]) &&
    starterDecks[id].length === 10 &&
    starterDecks[id].every((cardId) => typeof cardId === 'string' && seen.has(cardId))
  );
  if (!decksValid) problems.push('starterDecks: each leader needs exactly 10 existing card ids');
  if (problems.length > 0) failWith('cards.json', problems);
}

export function validateRelics(relicData) {
  const problems = [];
  if (!isRecord(relicData) || !Array.isArray(relicData.relics) || relicData.relics.length === 0) {
    throw new Error('Invalid relics.json: missing non-empty "relics" array.');
  }
  const seen = new Set();
  for (const relic of relicData.relics) {
    const id = typeof relic?.id === 'string' ? `"${relic.id}"` : '(missing id)';
    if (typeof relic?.id === 'string') {
      if (seen.has(relic.id)) problems.push(`relic "${relic.id}": duplicate id`);
      seen.add(relic.id);
    }
    const bad = (reason) => `relic ${id}: ${reason}`;
    if (!isRecord(relic)) { problems.push(bad('not an object')); continue; }
    if (typeof relic.id !== 'string') { problems.push(bad('missing string id')); continue; }
    if (typeof relic.name !== 'string') problems.push(bad('missing string name'));
    if (typeof relic.description !== 'string') problems.push(bad('missing string description'));
    if (relic.leaderId !== undefined && !CARD_MEMBER_IDS.includes(relic.leaderId)) {
      problems.push(bad(`unknown leaderId "${relic.leaderId}" (leader relics are starter-only)`));
    }
    if (!Array.isArray(relic.effects) || relic.effects.length === 0) {
      problems.push(bad('needs a non-empty effects array'));
      continue;
    }
    relic.effects.forEach((effect, index) => {
      if (!isRecord(effect)) { problems.push(bad(`effects[${index}]: not an object`)); return; }
      if (!RELIC_EFFECTS.some((supported) => supported.trigger === effect.trigger && supported.type === effect.type)) {
        problems.push(bad(`effects[${index}]: unsupported pair ${effect.trigger}/${effect.type}`));
        return;
      }
      if (!Number.isFinite(effect.amount) || effect.amount <= 0) {
        problems.push(bad(`effects[${index}]: amount must be > 0`));
      }
    });
  }
  if (problems.length > 0) failWith('relics.json', problems);
}

function checkBossIntent(intent, cardDatabase, where) {
  const bad = (reason) => `${where}: ${reason}`;
  if (!isRecord(intent)) return bad('intent is not an object');
  if (intent.interruptThreshold !== undefined &&
    !(Number.isFinite(intent.interruptThreshold) && intent.interruptThreshold > 0 &&
      intent.charged === true && Number.isFinite(intent.dmg))) {
    return bad('interruptThreshold needs charged:true and numeric dmg');
  }
  if (intent.interruptBonus !== undefined &&
    !(Number.isFinite(intent.interruptBonus) && intent.interruptBonus >= 0)) {
    return bad('interruptBonus must be >= 0');
  }
  if (intent.pierce !== undefined &&
    !(Number.isFinite(intent.pierce) && intent.pierce >= 0 && intent.pierce <= 1)) {
    return bad('pierce must be 0..1');
  }
  if (intent.type === 'injectStatus') {
    const card = intent.cardId && cardDatabase[intent.cardId];
    if (!card || card.type !== 'STATUS' || card.draftable !== false) {
      return bad(`injectStatus needs a non-draftable STATUS cardId (got "${intent.cardId}")`);
    }
    if (!Number.isInteger(intent.count) || intent.count <= 0) return bad('injectStatus needs integer count > 0');
    if (intent.block !== undefined && !(Number.isFinite(intent.block) && intent.block >= 0)) {
      return bad('injectStatus block must be >= 0');
    }
  }
  if (intent.type === 'steal_energy' &&
    !(Number.isInteger(intent.amount) && intent.amount > 0 && intent.amount <= 3)) {
    return bad('steal_energy amount must be an integer 1..3');
  }
  return null;
}

function checkBossPassive(passive) {
  if (!isRecord(passive)) return 'passive is not an object';
  if (typeof passive.desc !== 'string' || !passive.desc.trim()) return 'passive needs a non-empty desc';
  const positiveInt = (value) => Number.isInteger(value) && value > 0;
  if (passive.trigger === 'onPlayerAttack' && passive.effect === 'gainBlock') {
    return positiveInt(passive.value) ? null : 'gainBlock passive needs integer value > 0';
  }
  if (passive.trigger === 'onPlayerAttack' && passive.effect === 'reflect') {
    return positiveInt(passive.value) ? null : 'reflect passive needs integer value > 0';
  }
  if (passive.trigger === 'onSkillPlayed' && passive.effect === 'gainStrengthEvery') {
    return positiveInt(passive.value) && Number.isInteger(passive.every) && passive.every > 0
      ? null : 'gainStrengthEvery passive needs integer value > 0 and every > 0';
  }
  if (passive.trigger === 'onTurnEnd' && passive.effect === 'gainStrength') {
    return positiveInt(passive.value) ? null : 'gainStrength passive needs integer value > 0';
  }
  if (passive.trigger === 'onHpBelowHalf' && passive.effect === 'enrage') {
    return Number.isInteger(passive.strength) && passive.strength > 0 && Number.isInteger(passive.block) && passive.block >= 0
      ? null : 'enrage passive needs integer strength > 0 and block >= 0';
  }
  return `unsupported passive pair ${passive.trigger}/${passive.effect}`;
}

export function validateBosses(encounters, cardDatabase) {
  const problems = [];
  if (!Array.isArray(encounters)) throw new Error('Invalid bosses: expected an encounter array.');
  const seen = new Set();
  for (const encounter of encounters) {
    const id = typeof encounter?.id === 'string' ? `"${encounter.id}"` : '(missing id)';
    if (typeof encounter?.id === 'string') {
      if (seen.has(encounter.id)) problems.push(`boss "${encounter.id}": duplicate id`);
      seen.add(encounter.id);
    }
    const bad = (reason) => `boss ${id}: ${reason}`;
    if (!isRecord(encounter)) { problems.push(bad('not an object')); continue; }
    if (typeof encounter.id !== 'string') { problems.push(bad('missing string id')); continue; }
    if (!Array.isArray(encounter.patterns) || encounter.patterns.length === 0) {
      problems.push(bad('needs a non-empty patterns array'));
    } else {
      encounter.patterns.forEach((intent, index) => {
        const problem = checkBossIntent(intent, cardDatabase, `patterns[${index}]`);
        if (problem) problems.push(bad(problem));
      });
    }
    if (encounter.strength !== undefined && !Number.isFinite(encounter.strength)) {
      problems.push(bad('strength must be finite'));
    }
    if (encounter.stageEffect !== undefined && !STAGE_EFFECTS.includes(encounter.stageEffect)) {
      problems.push(bad(`unknown stageEffect "${encounter.stageEffect}"`));
    }
    if (encounter.passives !== undefined) {
      if (!Array.isArray(encounter.passives)) problems.push(bad('passives must be an array'));
      else encounter.passives.forEach((passive, index) => {
        const problem = checkBossPassive(passive);
        if (problem) problems.push(bad(`passives[${index}]: ${problem}`));
      });
    }
    if (encounter.phase2Patterns !== undefined) {
      if (!Array.isArray(encounter.phase2Patterns) || encounter.phase2Patterns.length === 0) {
        problems.push(bad('phase2Patterns must be a non-empty array when present'));
      } else {
        encounter.phase2Patterns.forEach((intent, index) => {
          const problem = checkBossIntent(intent, cardDatabase, `phase2Patterns[${index}]`);
          if (problem) problems.push(bad(problem));
        });
      }
    }
    if (encounter.assets !== undefined && !isRecord(encounter.assets)) problems.push(bad('assets must be an object'));
    if (encounter.visuals !== undefined && !isRecord(encounter.visuals)) problems.push(bad('visuals must be an object'));
  }
  if (problems.length > 0) failWith('bosses/*.json', problems);
}

function checkMissionClause(clause, where) {
  if (!isRecord(clause)) return `${where}: clause is not an object`;
  if (clause.scope !== 'run' && clause.scope !== 'profile') return `${where}: scope must be run|profile`;
  if (!MISSION_STATS[clause.scope].includes(clause.stat)) return `${where}: unknown stat "${clause.stat}" for scope ${clause.scope}`;
  if (!['gte', 'lte', 'eq'].includes(clause.op)) return `${where}: op must be gte|lte|eq`;
  if (!Number.isFinite(clause.value)) return `${where}: value must be finite`;
  return null;
}

export function validateMissions(missionData) {
  const problems = [];
  if (!isRecord(missionData) || !Array.isArray(missionData.missions) || missionData.missions.length === 0) {
    throw new Error('Invalid missions.json: missing non-empty "missions" array.');
  }
  const seen = new Set();
  for (const mission of missionData.missions) {
    const id = typeof mission?.id === 'string' ? `"${mission.id}"` : '(missing id)';
    if (typeof mission?.id === 'string') {
      if (seen.has(mission.id)) problems.push(`mission "${mission.id}": duplicate id`);
      seen.add(mission.id);
    }
    const bad = (reason) => `mission ${id}: ${reason}`;
    if (!isRecord(mission)) { problems.push(bad('not an object')); continue; }
    if (typeof mission.id !== 'string') { problems.push(bad('missing string id')); continue; }
    if (typeof mission.name !== 'string') problems.push(bad('missing string name'));
    if (typeof mission.description !== 'string') problems.push(bad('missing string description'));
    if (!Number.isInteger(mission.reward) || mission.reward <= 0) problems.push(bad('reward must be a positive integer'));
    if (mission.serverAwarded !== undefined && typeof mission.serverAwarded !== 'boolean') {
      problems.push(bad('serverAwarded must be a boolean'));
    }
    const all = Array.isArray(mission.requiresAll) ? mission.requiresAll : [];
    const any = Array.isArray(mission.requiresAny) ? mission.requiresAny : [];
    if (!mission.serverAwarded && all.length === 0 && any.length === 0) {
      problems.push(bad('needs requiresAll, requiresAny, or serverAwarded:true'));
    }
    all.forEach((clause, index) => {
      const problem = checkMissionClause(clause, `requiresAll[${index}]`);
      if (problem) problems.push(bad(problem));
    });
    any.forEach((clause, index) => {
      const problem = checkMissionClause(clause, `requiresAny[${index}]`);
      if (problem) problems.push(bad(problem));
    });
  }
  if (problems.length > 0) failWith('missions.json', problems);
}

export function validateTourEvents(events = TOUR_EVENTS) {
  const problems = [];
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('Invalid tour events: missing non-empty event list.');
  }
  const seen = new Set();
  for (const event of events) {
    const id = typeof event?.id === 'string' ? `"${event.id}"` : '(missing id)';
    if (typeof event?.id === 'string') {
      if (seen.has(event.id)) problems.push(`tour event "${event.id}": duplicate id`);
      seen.add(event.id);
    }
    const bad = (reason) => `tour event ${id}: ${reason}`;
    if (!isRecord(event)) { problems.push(bad('not an object')); continue; }
    if (typeof event.id !== 'string') { problems.push(bad('missing string id')); continue; }
    if (typeof event.name !== 'string') problems.push(bad('missing string name'));
    if (typeof event.description !== 'string') problems.push(bad('missing string description'));
    if (!Array.isArray(event.options) || event.options.length === 0) {
      problems.push(bad('needs a non-empty options array'));
      continue;
    }
    event.options.forEach((option, index) => {
      if (!isRecord(option)) { problems.push(bad(`options[${index}]: not an object`)); return; }
      for (const key of ['id', 'label', 'summary', 'tag']) {
        if (typeof option[key] !== 'string') problems.push(bad(`options[${index}]: missing string "${key}"`));
      }
      if (option.requires !== undefined && !TOUR_EVENT_REQUIRES.has(option.requires)) {
        problems.push(bad(`options[${index}]: unknown requires "${option.requires}"`));
      }
    });
  }
  if (problems.length > 0) failWith('tour events', problems);
}

export function validateChangelog(changelogData, manifestVersion) {
  const problems = [];
  const bad = (reason) => `changelog: ${reason}`;
  if (!isRecord(changelogData)) throw new Error('Invalid changelog.json: not an object.');
  if (typeof changelogData.currentVersion !== 'string') problems.push(bad('missing string currentVersion'));
  if (changelogData.currentVersion !== manifestVersion) {
    problems.push(bad(`currentVersion "${changelogData.currentVersion}" does not match manifest "${manifestVersion}"`));
  }
  if (!Array.isArray(changelogData.releases) || changelogData.releases.length === 0) {
    problems.push(bad('missing non-empty releases array'));
  } else {
    if (changelogData.releases[0]?.version !== changelogData.currentVersion) {
      problems.push(bad('newest release must equal currentVersion'));
    }
    const seen = new Set();
    changelogData.releases.forEach((release, index) => {
      const tag = `releases[${index}]${typeof release?.version === 'string' ? ` "${release.version}"` : ''}`;
      if (seen.has(release?.version)) problems.push(bad(`${tag}: duplicate version`));
      seen.add(release?.version);
      if (!isRecord(release)) { problems.push(bad(`${tag}: not an object`)); return; }
      if (typeof release.version !== 'string' || !VERSION_PATTERN.test(release.version)) {
        problems.push(bad(`${tag}: bad version format (want vMAJOR.MINOR.PATCH_8hex)`));
      }
      if (typeof release.date !== 'string' || !DATE_PATTERN.test(release.date)) {
        problems.push(bad(`${tag}: bad date (want YYYY-MM-DD)`));
      }
      if (!Array.isArray(release.changes) || release.changes.length === 0) {
        problems.push(bad(`${tag}: needs a non-empty changes array`));
      } else if (release.changes.some((change) => typeof change !== 'string' || change.trim().length === 0)) {
        problems.push(bad(`${tag}: changes must be non-empty strings`));
      }
    });
  }
  if (problems.length > 0) failWith('changelog.json', problems);
}

export function validateLeaderArts(manifest) {
  const problems = [];
  for (const leaderId of CARD_MEMBER_IDS) {
    const portraits = manifest?.portraits?.[leaderId];
    const arts = manifest?.leaderArts?.[leaderId];
    if (typeof portraits !== 'string') problems.push(`manifest: portraits missing "${leaderId}" splash`);
    if (!isRecord(arts)) problems.push(`manifest: leaderArts missing "${leaderId}" entry`);
    else for (const art of ['more', 'firestarter', 'prestige']) {
      if (typeof arts[art] !== 'string') problems.push(`manifest: leaderArts["${leaderId}"] missing "${art}" splash`);
    }
  }
  if (problems.length > 0) failWith('data.json (leader art)', problems);
}

function buildLeaderArts(manifest) {
  // Runs after validateLeaderArts, so every entry is known to exist.
  return Object.fromEntries(CARD_MEMBER_IDS.map((leaderId) => {
    const additionalArts = manifest.leaderArts[leaderId];
    return [leaderId, {
      popstars: manifest.portraits[leaderId],
      more: additionalArts.more,
      firestarter: additionalArts.firestarter,
      prestige: additionalArts.prestige
    }];
  }));
}

async function loadJson(url, cacheVersion) {
  const requestUrl = new URL(url);
  if (cacheVersion) requestUrl.searchParams.set('v', cacheVersion);
  const response = await fetch(requestUrl, cacheVersion ? undefined : { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function resetCacheForVersion(version) {
  try {
    if (window.localStorage.getItem(CACHE_VERSION_KEY) === version) return;
  } catch {
    return;
  }

  try {
    if ('caches' in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
    }
  } catch (error) {
    console.warn('Unable to clear the previous app cache.', error);
  }

  try {
    window.localStorage.setItem(CACHE_VERSION_KEY, version);
  } catch (error) {
    console.warn('Unable to record the app cache version.', error);
  }
}

export async function loadGameData() {
  const manifest = await loadJson(DATA_MANIFEST_URL);
  validateManifest(manifest);
  validateLeaderArts(manifest);

  await resetCacheForVersion(manifest.version);

  const cardDataUrl = new URL(manifest.cards, DATA_MANIFEST_URL);
  const relicDataUrl = new URL(manifest.relics, DATA_MANIFEST_URL);
  const missionDataUrl = new URL(manifest.missions, DATA_MANIFEST_URL);
  const keybindDataUrl = new URL(manifest.keybinds, DATA_MANIFEST_URL);
  const changelogUrl = new URL(manifest.changelog, DATA_MANIFEST_URL);
  const [cardData, relicData, missionData, keybindData, changelogData, poolEncounters] = await Promise.all([
    loadJson(cardDataUrl, manifest.version),
    loadJson(relicDataUrl, manifest.version),
    loadJson(missionDataUrl, manifest.version),
    loadJson(keybindDataUrl, manifest.version),
    loadJson(changelogUrl, manifest.version),
    Promise.all(manifest.encounterPools.map(async (slot, slotIndex) => Promise.all(slot.map(async (bossPath) => {
      const bossUrl = new URL(bossPath, DATA_MANIFEST_URL);
      const boss = await loadJson(bossUrl, manifest.version);
      const backdrop = boss.assets && manifest.backdrops[boss.assets.backdrop];
      if (!backdrop || !boss.assets.illustration || !boss.visuals || !boss.visuals.background) {
        throw new Error(`Boss data is missing required assets or visuals: ${bossPath}`);
      }
      return {
        ...boss,
        slot: slotIndex + 1,
        assets: {
          backdrop: new URL(backdrop, DATA_MANIFEST_URL).href,
          illustration: new URL(boss.assets.illustration, DATA_MANIFEST_URL).href
        }
      };
    }))))
  ]);
  const allEncounters = poolEncounters.flat();
  const encountersById = Object.fromEntries(allEncounters.map((encounter) => [encounter.id, encounter]));
  if (Object.keys(encountersById).length !== allEncounters.length) {
    throw new Error('Duplicate boss id across encounter pools.');
  }
  const encounterPools = poolEncounters.map((slot) => slot.map((encounter) => encounter.id));
  const encounters = allEncounters;

  if (!isValidDefaultKeybinds(keybindData)) {
    throw new Error('The keybind file must define one unique printable key for every game action.');
  }

  validateCards(cardData);
  const cardDatabase = Object.fromEntries(cardData.cards.map((card) => [card.id, card]));
  const starterDecks = cardData.starterDecks;
  validateRelics(relicData);
  const relicDatabase = Object.fromEntries(relicData.relics.map((relic) => [relic.id, relic]));
  validateBosses(allEncounters, cardDatabase);
  validateMissions(missionData);
  validateTourEvents();
  validateChangelog(changelogData, manifest.version);

  return {
    artAssets: { ...manifest.portraits, leaderArts: buildLeaderArts(manifest) },
    cardDatabase,
    changelog: changelogData,
    defaultKeybinds: keybindData,
    encounters,
    encountersById,
    encounterPools,
    relicDatabase,
    starterDecks,
    missions: missionData.missions,
  };
}
