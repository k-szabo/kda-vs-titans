import { isValidDefaultKeybinds } from './keybinds.js';

const DATA_MANIFEST_URL = new URL('../assets/data.json', import.meta.url);
const CACHE_VERSION_KEY = 'kda-vs-titans:cache-version';

// Buff cards declare a single persistent trigger instead of immediate effects.
const SUPPORTED_BUFFS = Object.freeze({
  passive: Object.freeze(['bonusAttackDamage']),
  turnStart: Object.freeze(['gainBlock', 'heal', 'gainEnergy']),
  onLethal: Object.freeze(['revive']),
  onDamage: Object.freeze(['negateDamage'])
});

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
  if (
    typeof manifest.version !== 'string' ||
    !manifest.portraits ||
    !manifest.leaderArts ||
    !manifest.backdrops ||
    !manifest.cards ||
    !manifest.relics ||
    typeof manifest.keybinds !== 'string' ||
    !manifest.keybinds ||
    !manifest.changelog ||
    !Array.isArray(manifest.bosses) ||
    manifest.bosses.length === 0
  ) {
    throw new Error('The asset manifest must define portraits, leader art, backdrops, card, relic, keybind, changelog, and boss files.');
  }

  const leaderIds = ['ahri', 'akali', 'evelynn', 'kaisa'];
  const leaderArts = Object.fromEntries(leaderIds.map((leaderId) => {
    const additionalArts = manifest.leaderArts[leaderId];
    if (
      !manifest.portraits[leaderId] ||
      !additionalArts ||
      typeof additionalArts.more !== 'string' ||
      typeof additionalArts.firestarter !== 'string'
    ) {
      throw new Error(`The asset manifest is missing leader art for ${leaderId}.`);
    }
    return [leaderId, {
      popstars: manifest.portraits[leaderId],
      more: additionalArts.more,
      firestarter: additionalArts.firestarter
    }];
  }));

  await resetCacheForVersion(manifest.version);

  const cardDataUrl = new URL(manifest.cards, DATA_MANIFEST_URL);
  const relicDataUrl = new URL(manifest.relics, DATA_MANIFEST_URL);
  const keybindDataUrl = new URL(manifest.keybinds, DATA_MANIFEST_URL);
  const changelogUrl = new URL(manifest.changelog, DATA_MANIFEST_URL);
  const [cardData, relicData, keybindData, changelogData, encounters] = await Promise.all([
    loadJson(cardDataUrl, manifest.version),
    loadJson(relicDataUrl, manifest.version),
    loadJson(keybindDataUrl, manifest.version),
    loadJson(changelogUrl, manifest.version),
    Promise.all(manifest.bosses.map(async (bossPath) => {
      const bossUrl = new URL(bossPath, DATA_MANIFEST_URL);
      const boss = await loadJson(bossUrl, manifest.version);
      const backdrop = boss.assets && manifest.backdrops[boss.assets.backdrop];
      if (!backdrop || !boss.assets.illustration || !boss.visuals || !boss.visuals.background) {
        throw new Error(`Boss data is missing required assets or visuals: ${bossPath}`);
      }
      return {
        ...boss,
        assets: {
          backdrop: new URL(backdrop, DATA_MANIFEST_URL).href,
          illustration: new URL(boss.assets.illustration, DATA_MANIFEST_URL).href
        }
      };
    }))
  ]);

  if (!isValidDefaultKeybinds(keybindData)) {
    throw new Error('The keybind file must define one unique printable key for every game action.');
  }

  if (!Array.isArray(cardData.cards) || !Array.isArray(cardData.starterDeck) || cardData.cards.length === 0) {
    throw new Error('The card file must define cards and a starter deck.');
  }
  const cardDatabase = Object.fromEntries(cardData.cards.map((card) => [card.id, card]));
  if (
    Object.keys(cardDatabase).length !== cardData.cards.length ||
    cardData.cards.some((card) =>
      typeof card.id !== 'string' ||
      !Array.isArray(card.effects) ||
      !card.log ||
      card.draftable !== undefined && typeof card.draftable !== 'boolean' ||
      card.ethereal !== undefined && typeof card.ethereal !== 'boolean' ||
      card.retain !== undefined && typeof card.retain !== 'boolean' ||
      card.retainInHand !== undefined && typeof card.retainInHand !== 'boolean' ||
      card.endTurnDamage !== undefined &&
        (!Number.isFinite(card.endTurnDamage) || card.endTurnDamage <= 0 || card.type !== 'STATUS' || card.ethereal !== true) ||
      card.art !== undefined && typeof card.art !== 'string' ||
      (card.type === 'BUFF'
        ? !card.buff ||
          typeof card.buff !== 'object' ||
          typeof card.buff.trigger !== 'string' ||
          typeof card.buff.effect !== 'string' ||
          !SUPPORTED_BUFFS[card.buff.trigger]?.includes(card.buff.effect) ||
          !Number.isFinite(card.buff.amount) ||
          card.buff.amount <= 0 ||
          (card.buff.duration !== undefined &&
            (!Number.isInteger(card.buff.duration) || card.buff.duration < 1)) ||
          (card.buff.upgradeAmount !== undefined &&
            (!Number.isFinite(card.buff.upgradeAmount) || card.buff.upgradeAmount < 0))
        : card.buff !== undefined) ||
      (card.upgrade !== undefined && (
        !card.upgrade ||
        typeof card.upgrade !== 'object' ||
        typeof card.upgrade.description !== 'string' ||
        (card.upgrade.costReduction !== undefined &&
          (!Number.isInteger(card.upgrade.costReduction) ||
            card.upgrade.costReduction < 0 ||
            card.upgrade.costReduction > card.cost))
      )) ||
      card.effects.some((effect) =>
        !effect ||
        typeof effect !== 'object' ||
        typeof effect.type !== 'string' ||
        !['damage', 'gainBlock', 'stealBlock', 'healPlayer', 'applyEnemyStatus', 'addPlayerStatus', 'clearPlayerStatus', 'addCheer', 'draw', 'gainEnergy', 'raiseHandLimit'].includes(effect.type) ||
        (effect.upgradeAmount !== undefined &&
          (!Number.isFinite(effect.upgradeAmount) || effect.upgradeAmount < 0)) ||
        (effect.type === 'damage' &&
          ((!Number.isFinite(effect.amount) || effect.amount <= 0) ||
            (effect.pierce !== undefined && (!Number.isFinite(effect.pierce) || effect.pierce < 0 || effect.pierce > 1)) ||
            (effect.hits !== undefined && (!Number.isInteger(effect.hits) || effect.hits < 1)))) ||
        (effect.type === 'stealBlock' &&
          (!Number.isFinite(effect.amount) || effect.amount <= 0)) ||
        (effect.when !== undefined &&
          (typeof effect.when !== 'object' ||
            !['enemy', 'player'].includes(effect.when.target) ||
            typeof effect.when.status !== 'string'))
      )
    ) ||
    cardData.starterDeck.some((cardId) => !Object.hasOwn(cardDatabase, cardId))
  ) {
    throw new Error('The card file contains invalid or duplicate card data.');
  }

  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validIntent = (intent) =>
    isRecord(intent) &&
    (intent.interruptThreshold === undefined ||
      Number.isFinite(intent.interruptThreshold) &&
        intent.interruptThreshold > 0 &&
        intent.charged === true &&
        Number.isFinite(intent.dmg)) &&
    (intent.interruptBonus === undefined ||
      Number.isFinite(intent.interruptBonus) && intent.interruptBonus >= 0) &&
    (intent.pierce === undefined ||
      Number.isFinite(intent.pierce) && intent.pierce >= 0 && intent.pierce <= 1) &&
    (intent.type !== 'injectStatus' ||
      Object.hasOwn(cardDatabase, intent.cardId) &&
        cardDatabase[intent.cardId].type === 'STATUS' &&
        cardDatabase[intent.cardId].draftable === false &&
        Number.isInteger(intent.count) &&
        intent.count > 0 &&
        (intent.block === undefined || Number.isFinite(intent.block) && intent.block >= 0)) &&
    (intent.type !== 'steal_energy' ||
      Number.isInteger(intent.amount) && intent.amount > 0 && intent.amount <= 3);
  const validPassive = (passive) => {
    if (!isRecord(passive) || typeof passive.desc !== 'string' || !passive.desc.trim()) return false;
    if (passive.trigger === 'onPlayerAttack' && passive.effect === 'gainBlock') {
      return Number.isInteger(passive.value) && passive.value > 0;
    }
    if (passive.trigger === 'onPlayerAttack' && passive.effect === 'reflect') {
      return Number.isInteger(passive.value) && passive.value > 0;
    }
    if (passive.trigger === 'onSkillPlayed' && passive.effect === 'gainStrengthEvery') {
      return Number.isInteger(passive.value) &&
        passive.value > 0 &&
        Number.isInteger(passive.every) &&
        passive.every > 0;
    }
    if (passive.trigger === 'onTurnEnd' && passive.effect === 'gainStrength') {
      return Number.isInteger(passive.value) && passive.value > 0;
    }
    return passive.trigger === 'onHpBelowHalf' &&
      passive.effect === 'enrage' &&
      Number.isInteger(passive.strength) &&
      passive.strength > 0 &&
      Number.isInteger(passive.block) &&
      passive.block >= 0;
  };
  const validStageEffects = new Set([
    'overcharge_grid',
    'thermonuclear_heat',
    'luminous_spores'
  ]);
  if (encounters.some((encounter) =>
    !Array.isArray(encounter.patterns) ||
    encounter.patterns.length === 0 ||
    encounter.strength !== undefined && !Number.isFinite(encounter.strength) ||
    encounter.stageEffect !== undefined && !validStageEffects.has(encounter.stageEffect) ||
    encounter.patterns.some((intent) => !validIntent(intent)) ||
    encounter.passives !== undefined &&
      (!Array.isArray(encounter.passives) || encounter.passives.some((passive) => !validPassive(passive))) ||
    encounter.phase2Patterns !== undefined &&
      (!Array.isArray(encounter.phase2Patterns) ||
        encounter.phase2Patterns.length === 0 ||
        encounter.phase2Patterns.some((intent) => !validIntent(intent)))
  )) {
    throw new Error('The boss file contains invalid passive or intent data.');
  }

  if (!Array.isArray(relicData.relics) || relicData.relics.length === 0) {
    throw new Error('The relic file must define at least one relic.');
  }
  const relicDatabase = Object.fromEntries(relicData.relics.map((relic) => [relic.id, relic]));
  const supportedRelicEffects = [
    { trigger: 'stageStart', type: 'startingEnergy' },
    { trigger: 'stageStart', type: 'startingBlock' },
    { trigger: 'stageStart', type: 'heal' },
    { trigger: 'waveClear', type: 'heal' },
    { trigger: 'attackPlayed', type: 'gainBlock' },
    { trigger: 'cardPlayed', type: 'cheerGainPercent' },
    { trigger: 'attackPlayed', type: 'zeroCostAttackDamage' },
    { trigger: 'skillPlayed', type: 'charmDuration' },
    { trigger: 'skillPlayed', type: 'skillGainBlock' }
  ];
  if (
    Object.keys(relicDatabase).length !== relicData.relics.length ||
    relicData.relics.some((relic) =>
      typeof relic.id !== 'string' ||
      typeof relic.name !== 'string' ||
      typeof relic.description !== 'string' ||
      relic.leaderId !== undefined && !leaderIds.includes(relic.leaderId) ||
      !Array.isArray(relic.effects) ||
      relic.effects.some((effect) =>
        !effect ||
        typeof effect !== 'object' ||
        !supportedRelicEffects.some((supported) =>
          supported.trigger === effect.trigger && supported.type === effect.type
        ) ||
        !Number.isFinite(effect.amount) ||
        effect.amount <= 0
      )
    )
  ) {
    throw new Error('The relic file contains invalid or duplicate relic data.');
  }

  const versionPattern = /^v\d+\.\d+\.\d+_[0-9a-f]{8}$/;
  if (
    !isRecord(changelogData) ||
    typeof changelogData.currentVersion !== 'string' ||
    changelogData.currentVersion !== manifest.version ||
    !Array.isArray(changelogData.releases) ||
    changelogData.releases.length === 0 ||
    !changelogData.releases.every((release) => isRecord(release) && typeof release.version === 'string') ||
    changelogData.releases[0].version !== changelogData.currentVersion ||
    new Set(changelogData.releases.map((release) => release.version)).size !== changelogData.releases.length ||
    !versionPattern.test(changelogData.currentVersion) ||
    changelogData.releases.some((release) =>
      !versionPattern.test(release.version) ||
      typeof release.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(release.date) ||
      !Array.isArray(release.changes) ||
      release.changes.length === 0 ||
      release.changes.some((change) => typeof change !== 'string' || change.trim().length === 0)
    )
  ) {
    throw new Error('The changelog must contain a valid current version and release history.');
  }

  return {
    artAssets: { ...manifest.portraits, leaderArts },
    cardDatabase,
    changelog: changelogData,
    defaultKeybinds: keybindData,
    encounters,
    relicDatabase,
    starterDeck: cardData.starterDeck
  };
}
