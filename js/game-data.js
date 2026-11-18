const DATA_MANIFEST_URL = new URL('../assets/data.json', import.meta.url);
const CACHE_VERSION_KEY = 'kda-vs-titans:cache-version';

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
    !manifest.backdrops ||
    !manifest.cards ||
    !manifest.relics ||
    !manifest.changelog ||
    !Array.isArray(manifest.bosses) ||
    manifest.bosses.length === 0
  ) {
    throw new Error('The asset manifest must define portraits, backdrops, card, relic, changelog, and boss files.');
  }

  await resetCacheForVersion(manifest.version);

  const cardDataUrl = new URL(manifest.cards, DATA_MANIFEST_URL);
  const relicDataUrl = new URL(manifest.relics, DATA_MANIFEST_URL);
  const changelogUrl = new URL(manifest.changelog, DATA_MANIFEST_URL);
  const [cardData, relicData, changelogData, encounters] = await Promise.all([
    loadJson(cardDataUrl, manifest.version),
    loadJson(relicDataUrl, manifest.version),
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
        effect.upgradeAmount !== undefined &&
        (!Number.isFinite(effect.upgradeAmount) || effect.upgradeAmount < 0)
      )
    ) ||
    cardData.starterDeck.some((cardId) => !Object.hasOwn(cardDatabase, cardId))
  ) {
    throw new Error('The card file contains invalid or duplicate card data.');
  }

  if (!Array.isArray(relicData.relics) || relicData.relics.length === 0) {
    throw new Error('The relic file must define at least one relic.');
  }
  const relicDatabase = Object.fromEntries(relicData.relics.map((relic) => [relic.id, relic]));
  const supportedRelicEffects = [
    { trigger: 'stageStart', type: 'startingEnergy' },
    { trigger: 'attackPlayed', type: 'gainBlock' }
  ];
  if (
    Object.keys(relicDatabase).length !== relicData.relics.length ||
    relicData.relics.some((relic) =>
      typeof relic.id !== 'string' ||
      typeof relic.name !== 'string' ||
      typeof relic.description !== 'string' ||
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

  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
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
    artAssets: manifest.portraits,
    cardDatabase,
    changelog: changelogData,
    encounters,
    relicDatabase,
    starterDeck: cardData.starterDeck
  };
}
