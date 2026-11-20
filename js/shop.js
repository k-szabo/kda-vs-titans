// Between-wave merch shop: flat prices, seeded stock, no free cut/rest.
// Created once per boot with app callbacks; all token spending and deck
// mutations go through here so pile coverage stays valid.

import { addInstanceToDeck, removeInstanceFromPiles } from './deck.js';

export const SHOP_PRICES = Object.freeze({ card: 12, relic: 18, removal: 8, heal: 6 });
export const SHOP_HEAL_AMOUNT = 15;

export function createShop(deps) {
  const {
    getState,
    getCardDatabase,
    getRelicDatabase,
    shuffle,
    addLog,
    saveRunState,
    renderAll,
    showRouting,
    getUnownedRelicIds,
    pruneStaleRelicChoices
  } = deps;

  function awardMerchTokens() {
    const state = getState();
    const award = 10 + state.stageIndex + state.encoreLevel * 2;
    state.merchTokens = Math.min(9999, state.merchTokens + award);
    addLog(`🪙 Merch stand payout: +${award} Merch Tokens (${state.merchTokens} total).`, 'text-amber-300');
  }

  function rollShopInventory() {
    const state = getState();
    const draftPool = Object.values(getCardDatabase()).filter((c) => !c.starter && c.draftable !== false);
    const cards = shuffle(draftPool).slice(0, 2).map((card) => card.id);
    const relicPool = shuffle(getUnownedRelicIds());
    state.shop = {
      cards,
      relic: relicPool.length > 0 ? relicPool[0] : null,
      removalUsed: false,
      healUsed: false
    };
  }

  function buyShopCard(cardId) {
    const state = getState();
    if (state.runStatus !== 'draft' || !state.shop) return;
    if (!state.shop.cards.includes(cardId)) return;
    if (state.merchTokens < SHOP_PRICES.card) return;
    const card = getCardDatabase()[cardId];
    if (!card || card.starter || card.draftable === false) return;
    state.merchTokens -= SHOP_PRICES.card;
    addInstanceToDeck(state, cardId);
    state.shop.cards = state.shop.cards.filter((id) => id !== cardId);
    addLog(`🪙 Bought "${card.name}" for ${SHOP_PRICES.card} Merch Tokens.`, 'text-amber-300');
    saveRunState();
    showRouting();
    renderAll();
  }

  function buyShopRelic() {
    const state = getState();
    if (state.runStatus !== 'draft' || !state.shop || !state.shop.relic) return;
    const relic = getRelicDatabase()[state.shop.relic];
    if (!relic) return;
    if (state.relics.includes(state.shop.relic)) {
      state.shop.relic = null;
      saveRunState();
      showRouting();
      return;
    }
    if (relic.leaderId || state.merchTokens < SHOP_PRICES.relic) return;
    state.merchTokens -= SHOP_PRICES.relic;
    state.relics.push(state.shop.relic);
    addLog(`🪙 Bought ${relic.name} for ${SHOP_PRICES.relic} Merch Tokens.`, 'text-amber-300');
    state.shop.relic = null;
    pruneStaleRelicChoices();
    saveRunState();
    showRouting();
    renderAll();
  }

  function buyShopRemoval(instanceId) {
    const state = getState();
    if (state.runStatus !== 'draft' || !state.shop || state.shop.removalUsed) return;
    if (state.merchTokens < SHOP_PRICES.removal) return;
    if (state.masterDeck.length <= 1) return;
    const removedCardId = removeInstanceFromPiles(state, instanceId);
    if (!removedCardId) return;
    state.merchTokens -= SHOP_PRICES.removal;
    state.shop.removalUsed = true;
    addLog(`🪙 Removed ${getCardDatabase()[removedCardId].name} for ${SHOP_PRICES.removal} Merch Tokens.`, 'text-amber-300');
    saveRunState();
    showRouting();
    renderAll();
  }

  function buyShopHeal() {
    const state = getState();
    if (state.runStatus !== 'draft' || !state.shop || state.shop.healUsed) return;
    if (state.merchTokens < SHOP_PRICES.heal) return;
    if (state.player.hp >= state.player.maxHp) return;
    state.merchTokens -= SHOP_PRICES.heal;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + SHOP_HEAL_AMOUNT);
    state.shop.healUsed = true;
    addLog(`🪙 Backstage patch-up: +${SHOP_HEAL_AMOUNT} HP for ${SHOP_PRICES.heal} Merch Tokens.`, 'text-amber-300');
    saveRunState();
    showRouting();
    renderAll();
  }

  return {
    awardMerchTokens,
    rollShopInventory,
    buyShopCard,
    buyShopRelic,
    buyShopRemoval,
    buyShopHeal
  };
}
