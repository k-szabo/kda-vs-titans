// Between-wave merch shop UI: stock grids, removal/heal/slots buttons,
// cut picker. State-agnostic rendering; app wires purchases via callbacks.
import { SHOP_HEAL_AMOUNT, SHOP_PRICES, SLOT_PRICE } from './shop.js';

export function createShopUI(deps) {
  const {
    getState,
    getCardDatabase,
    getRelicDatabase,
    createCardElement,
    onBuyShopCard,
    onBuyShopRelic,
    onBuyShopRemoval,
    onBuyShopHeal,
    onPullSlots
  } = deps;

function renderShop(shop, tokens) {
    const section = document.getElementById('merchShopSection');
    if (!section) return;
    const balance = document.getElementById('shopBalance');
    if (balance) balance.textContent = `${tokens ?? 0} 🪙`;
    const cardGrid = document.getElementById('shopCardGrid');
    const relicGrid = document.getElementById('shopRelicGrid');
    const cutSection = document.getElementById('shopCutSection');
    const cutGrid = document.getElementById('shopCutGrid');
    const healButton = document.getElementById('btnShopHeal');
    const removalButton = document.getElementById('btnShopRemoval');
    const slotsButton = document.getElementById('btnShopSlots');
    const slotsResult = document.getElementById('shopSlotsResult');
    if (!cardGrid || !relicGrid || !cutSection || !cutGrid || !healButton || !removalButton || !slotsButton) return;
    const cardDatabase = getCardDatabase();
    const relicDatabase = getRelicDatabase();
    const state = getState();
    cutSection.classList.add('hidden');
    cutGrid.replaceChildren();

    cardGrid.replaceChildren();
    (shop?.cards || []).forEach((cardId) => {
      const card = cardDatabase[cardId];
      if (!card) return;
      const affordable = (tokens ?? 0) >= SHOP_PRICES.card;
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.disabled = !affordable;
      choice.className = affordable
        ? 'rounded-2xl border border-amber-300/40 bg-black/25 p-2 text-left transition hover:border-amber-200 hover:bg-amber-500/10'
        : 'rounded-2xl border border-white/10 bg-black/25 p-2 text-left opacity-50 cursor-not-allowed';
      choice.appendChild(createCardElement(card, true, -1, { upgradeLevel: 0 }));
      const price = document.createElement('span');
      price.className = 'mt-1 block text-center font-display text-[10px] font-black text-amber-200';
      price.textContent = `BUY ${SHOP_PRICES.card} 🪙`;
      choice.appendChild(price);
      if (affordable) choice.addEventListener('click', () => onBuyShopCard(cardId));
      cardGrid.appendChild(choice);
    });
    if ((shop?.cards || []).length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-[11px] italic text-slate-500';
      empty.textContent = 'Sold out.';
      cardGrid.appendChild(empty);
    }

    relicGrid.replaceChildren();
    if (shop?.relic) {
      const relic = relicDatabase[shop.relic];
      if (relic) {
        const affordable = (tokens ?? 0) >= SHOP_PRICES.relic;
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.disabled = !affordable;
        choice.className = affordable
          ? 'rounded-2xl border border-amber-300/40 bg-gradient-to-br from-amber-400/15 to-slate-950/80 p-4 text-left transition hover:border-amber-200 hover:bg-amber-400/20'
          : 'rounded-2xl border border-white/10 bg-black/25 p-4 text-left opacity-50 cursor-not-allowed';
        const name = document.createElement('span');
        name.className = 'block font-display text-sm font-black text-amber-200 mb-1';
        name.textContent = `✦ ${relic.name}`;
        const description = document.createElement('span');
        description.className = 'block text-xs leading-relaxed text-slate-300';
        description.textContent = relic.description;
        const price = document.createElement('span');
        price.className = 'mt-2 block font-display text-[10px] font-black text-amber-200';
        price.textContent = `BUY ${SHOP_PRICES.relic} 🪙`;
        choice.append(name, description, price);
        if (affordable) choice.addEventListener('click', () => onBuyShopRelic());
        relicGrid.appendChild(choice);
      }
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-[11px] italic text-slate-500';
      const unownedRemain = Object.keys(relicDatabase)
        .some((id) => !relicDatabase[id].leaderId && !state?.relics.includes(id));
      empty.textContent = unownedRemain ? 'Sold out.' : 'No relics left to buy.';
      relicGrid.appendChild(empty);
    }

    const canCut = state ? state.masterDeck.length > 1 && !state.modifiers?.limitedRemovals : false;
    const removalAffordable = (tokens ?? 0) >= SHOP_PRICES.removal && !shop?.removalUsed && canCut;
    removalButton.disabled = !removalAffordable;
    removalButton.textContent = state?.modifiers?.limitedRemovals
      ? 'REMOVALS SEALED'
      : shop?.removalUsed
        ? 'REMOVAL USED'
        : `✂️ REMOVE 1 CARD (${SHOP_PRICES.removal} 🪙)`;
    removalButton.className = removalAffordable
      ? 'px-3 py-2 rounded-xl border border-rose-300/40 bg-rose-500/15 font-display text-[10px] font-bold text-rose-100 transition hover:bg-rose-500/25'
      : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5 font-display text-[10px] font-bold text-slate-500 cursor-not-allowed';
    removalButton.onclick = () => showShopCutPicker();

    const healAffordable = Boolean(state) &&
      (tokens ?? 0) >= SHOP_PRICES.heal &&
      !shop?.healUsed &&
      state.player.hp < state.player.maxHp;
    healButton.disabled = !healAffordable;
    healButton.textContent = shop?.healUsed
      ? 'PATCH-UP USED'
      : `💖 HEAL +${SHOP_HEAL_AMOUNT} HP (${SHOP_PRICES.heal} 🪙)`;
    healButton.className = healAffordable
      ? 'px-3 py-2 rounded-xl border border-emerald-300/40 bg-emerald-500/15 font-display text-[10px] font-bold text-emerald-100 transition hover:bg-emerald-500/25'
      : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5 font-display text-[10px] font-bold text-slate-500 cursor-not-allowed';
    healButton.onclick = healAffordable ? () => onBuyShopHeal() : null;

    const slotsAffordable = (tokens ?? 0) >= SLOT_PRICE;
    slotsButton.disabled = !slotsAffordable;
    slotsButton.textContent = `🎰 SLOTS (${SLOT_PRICE} 🪙)`;
    slotsButton.className = slotsAffordable
      ? 'px-3 py-2 rounded-xl border border-fuchsia-300/40 bg-fuchsia-500/15 font-display text-[10px] font-bold text-fuchsia-100 transition hover:bg-fuchsia-500/25'
      : 'px-3 py-2 rounded-xl border border-white/10 bg-white/5 font-display text-[10px] font-bold text-slate-500 cursor-not-allowed';
    slotsButton.onclick = slotsAffordable ? () => onPullSlots() : null;
    if (slotsResult) slotsResult.textContent = shop?.slotsLast ? `🎰 Last pull: ${shop.slotsLast}` : '';
  }

function showShopCutPicker() {
    const state = getState();
    const cutSection = document.getElementById('shopCutSection');
    const cutGrid = document.getElementById('shopCutGrid');
    const cardDatabase = getCardDatabase();
    if (!cutSection || !cutGrid || !state) return;
    cutGrid.replaceChildren();
    state.masterDeck.forEach((instance) => {
      const card = cardDatabase[instance.cardId];
      if (!card || state.masterDeck.length <= 1) return;
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'rounded-2xl border border-rose-300/30 bg-black/25 p-2 text-left transition hover:border-rose-200 hover:bg-rose-500/10';
      choice.appendChild(createCardElement(card, true, -1, instance));
      choice.addEventListener('click', () => {
        cutSection.classList.add('hidden');
        onBuyShopRemoval(instance.instanceId);
      });
      cutGrid.appendChild(choice);
    });
    cutSection.classList.remove('hidden');
    cutSection.scrollIntoView({ block: 'nearest' });
  }
  return { renderShop };
}
