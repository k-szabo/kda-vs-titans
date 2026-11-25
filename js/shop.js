// Between-wave merch shop: flat prices, seeded stock, no free cut/rest.
// Created once per boot with app callbacks; all token spending and deck
// mutations go through here so pile coverage stays valid.

import { addInstanceToDeck, removeInstanceFromPiles } from './deck.js';

export const SHOP_PRICES = Object.freeze({ card: 12, relic: 18, removal: 8, heal: 6 });
export const SHOP_HEAL_AMOUNT = 15;
export const SLOT_PRICE = 5;
export const SLOT_HEAL_AMOUNT = 20;

// Pure slots paytable: roll in [0, 1). Boundaries covered by harness.
export function resolveSlotsOutcome(roll, hasRelic) {
  if (roll < 0.45) return 'card';
  if (roll < 0.70) return 'heal';
  if (roll < 0.90) return hasRelic ? 'relic' : 'heal';
  return 'jackpot';
}

export function createShop(deps) {
  const {
    getState,
    getCardDatabase,
    getRelicDatabase,
    shuffle,
    nextRandom,
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
    const chaos = state.modifiers?.chaosDraft === true;
    const draftPool = Object.values(getCardDatabase()).filter((c) =>
      (chaos || !c.starter) && c.draftable !== false
    );
    const cards = shuffle(draftPool).slice(0, 2).map((card) => card.id);
    const relicPool = shuffle(getUnownedRelicIds(chaos));
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
    const chaos = state.modifiers?.chaosDraft === true;
    if (state.relics.includes(state.shop.relic)) {
      state.shop.relic = null;
      saveRunState();
      showRouting();
      return;
    }
    if ((!chaos && relic.leaderId) || state.merchTokens < SHOP_PRICES.relic) return;
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
    if (state.modifiers?.limitedRemovals) return;
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

  function pullSlots() {
    const state = getState();
    if (state.runStatus !== 'draft' || !state.shop) return;
    if (state.merchTokens < SLOT_PRICE) return;
    state.merchTokens -= SLOT_PRICE;
    const chaos = state.modifiers?.chaosDraft === true;
    const draftPool = Object.values(getCardDatabase()).filter((c) =>
      (chaos || !c.starter) && c.draftable !== false
    );
    const unowned = shuffle(getUnownedRelicIds(chaos));
    const outcome = resolveSlotsOutcome(nextRandom(), unowned.length > 0);
    const won = [];
    const takeCard = () => {
      if (draftPool.length === 0) return;
      const id = shuffle(draftPool)[0].id;
      addInstanceToDeck(state, id);
      won.push(`“${getCardDatabase()[id].name}”`);
    };
    const takeRelic = () => {
      if (unowned.length === 0) return;
      const id = shuffle(unowned)[0];
      if (state.relics.includes(id)) return;
      state.relics.push(id);
      pruneStaleRelicChoices();
      won.push(`✦ ${getRelicDatabase()[id].name}`);
    };
    const takeHeal = () => {
      const healed = Math.min(state.player.maxHp - state.player.hp, SLOT_HEAL_AMOUNT);
      if (healed <= 0) {
        // Full HP: a heal win would look like nothing happened — deal a card instead.
        takeCard();
        return;
      }
      state.player.hp += healed;
      won.push(`+${healed} HP`);
    };
    if (outcome === 'card') takeCard();
    else if (outcome === 'heal') takeHeal();
    else if (outcome === 'relic') {
      const before = won.length;
      takeRelic();
      if (won.length === before) takeHeal();
    } else {
      takeCard();
      const before = won.length;
      takeRelic();
      if (won.length === before) takeHeal();
    }
    state.slotsLast = won.length > 0 ? won.join(' + ') : 'nothing';
    addLog(`🎰 Backstage Slots (−${SLOT_PRICE} 🪙): won ${state.slotsLast}!`, 'text-amber-300 font-bold');
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
    buyShopHeal,
    pullSlots
  };
}
