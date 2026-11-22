// 🛒 THE SHOP: buy upgrades, planes and stickers with your coins.
// Press T after landing at the airport to buy things.
// Press P anywhere to pick a plane or sticker you already own (you get it when you spawn next).
import { PLANE_TYPES, STICKERS } from './plane.js';

const panel = document.getElementById('shop');
const title = document.getElementById('shoptitle');
const coinsText = document.getElementById('shopcoins');
const tabs = document.getElementById('shoptabs');
const list = document.getElementById('shopitems');
const note = document.getElementById('shopnote');

export class Shop {
  constructor(game, catalog) {
    this.game = game;
    this.catalog = catalog;   // the prices come from the server
    this.tab = 'planes';
    this.canBuy = false;
    tabs.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      if (tab) { this.tab = tab; this.render(); }
    });
    list.addEventListener('click', (e) => this.onClick(e.target.closest('button')));
    document.getElementById('shopclose').addEventListener('click', () => this.close());
  }

  get isOpen() {
    return !panel.hidden;
  }

  // atAirport = true: you can buy things. false: you can only choose what you own.
  open(atAirport) {
    this.canBuy = atAirport;
    this.tab = atAirport ? 'upgrades' : 'planes';
    panel.hidden = false;
    this.render();
  }

  close() {
    panel.hidden = true;
  }

  render() {
    if (!this.isOpen) return;
    const profile = this.game.profile;
    if (!profile) return;
    title.textContent = this.canBuy ? '🛒 Airport Shop' : '✈️ Choose your plane';
    coinsText.textContent = `🪙 ${profile.coins}  💵 $${profile.cash || 0}`;
    for (const button of tabs.children) button.classList.toggle('picked', button.dataset.tab === this.tab);
    note.textContent = this.canBuy
      ? 'Your new plane or sticker arrives the next time you spawn.'
      : 'Your new plane arrives the next time you spawn. Land at the airport 🛬 and press T to buy things!';

    const rows = [];
    const priceButton = (kind, item, price) =>
      this.canBuy
        ? `<button data-buy="${kind}" data-item="${item}" ${profile.coins < price ? 'disabled' : ''}>Buy 🪙 ${price}</button>`
        : `<button disabled>🔒 🪙 ${price}</button>`;

    if (this.tab === 'upgrades') {
      for (const [item, info] of Object.entries(this.catalog.upgrades)) {
        const level = profile.upgrades[item];
        const dots = '●'.repeat(level) + '○'.repeat(info.prices.length - level);
        const price = info.prices[level];
        rows.push(`<div class="row"><div><b>${info.name}</b> <span class="dots">${dots}</span><br><small>${info.about}</small></div>
          ${price === undefined ? '<button disabled>MAX ⭐</button>' : priceButton('upgrade', item, price)}</div>`);
      }
      // Trade cash for coins
      const trade = this.catalog.exchange;
      rows.push(`<div class="row"><div><b>💵 Trade cash for coins</b><br><small>$${trade.cash} → 🪙 ${trade.coins}</small></div>
        <button data-buy="exchange" data-item="exchange" ${!this.canBuy || (profile.cash || 0) < trade.cash ? 'disabled' : ''}>Trade</button></div>`);
    } else if (this.tab === 'planes') {
      for (const [item, info] of Object.entries(PLANE_TYPES)) {
        const owned = profile.planes.includes(item);
        const chosen = this.game.nextPlane === item;
        const button = owned
          ? `<button data-choose="plane" data-item="${item}" ${chosen ? 'class="picked"' : ''}>${chosen ? '✓ Chosen' : 'Choose'}</button>`
          : priceButton('plane', item, this.catalog.planes[item]);
        rows.push(`<div class="row"><div><b>${info.name}</b><br><small>${info.about}</small></div>${button}</div>`);
      }
    } else {
      for (const [item, name] of Object.entries(STICKERS)) {
        const owned = profile.stickers.includes(item);
        const chosen = this.game.nextSticker === item;
        const button = owned
          ? `<button data-choose="sticker" data-item="${item}" ${chosen ? 'class="picked"' : ''}>${chosen ? '✓ Chosen' : 'Use'}</button>`
          : priceButton('sticker', item, this.catalog.stickers[item]);
        rows.push(`<div class="row"><div><b>${name}</b></div>${button}</div>`);
      }
    }
    list.innerHTML = rows.join('');
  }

  onClick(button) {
    if (!button || button.disabled) return;
    if (button.dataset.buy) {
      this.game.network.send({ type: 'buy', kind: button.dataset.buy, item: button.dataset.item });
    } else if (button.dataset.choose === 'plane') {
      this.game.choosePlane(button.dataset.item, this.game.nextSticker);
      this.render();
    } else if (button.dataset.choose === 'sticker') {
      this.game.choosePlane(this.game.nextPlane, button.dataset.item);
      this.render();
    }
  }
}
