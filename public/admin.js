// 👑 THE ADMIN PANEL: only on the computer that runs the server (the boss's computer!).
// Press ` (the key left of 1) to open it. The server checks again for every command,
// so other computers can never use it.

const panel = document.getElementById('admin');
const list = document.getElementById('adminplayers');
const input = document.getElementById('admininput');
const log = document.getElementById('adminlog');
const safe = (text) => String(text).replace(/[<>&"]/g, '');

export class Admin {
  constructor(game, allowed) {
    this.game = game;
    this.allowed = allowed;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();                      // typing here doesn't fly the plane
      if (e.key === 'Enter' && input.value.trim()) {
        this.run(input.value.trim());
        input.value = '';
      }
      if (e.key === 'Escape' || e.key === '`' || e.key === '²' || e.code === 'IntlBackslash' || e.code === 'F2') { e.preventDefault(); this.close(); }
    });
    panel.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      button.blur();   // so pressing Space later doesn't click it again
      if (button.dataset.command) this.run(button.dataset.command);
      if (button.dataset.local === 'wanted') {
        game.police.clear();
        this.write('🚓 The police went home');
      }
      if (button.dataset.local === 'close') this.close();
    });
  }

  get isOpen() {
    return !panel.hidden;
  }

  toggle() {
    if (!this.allowed) return;
    if (this.isOpen) this.close();
    else {
      panel.hidden = false;
      this.render();
      input.focus();
    }
  }

  close() {
    panel.hidden = true;
    input.blur();
  }

  run(command) {
    this.write(`> ${command}`);
    this.game.network.send({ type: 'admin', command });
  }

  write(text) {
    log.innerHTML = `<div>${safe(text)}</div>` + log.innerHTML;
  }

  // The list of players, with a row of buttons for each one
  render() {
    if (!this.isOpen) return;
    const people = this.game.playerList.filter((p) => !p.robot);
    list.innerHTML = people.map((p) => {
      const n = p.name.toLowerCase();
      const me = p.id === this.game.network.id;
      return `<div class="row"><b>${safe(p.name)}${me ? ' 👑' : ''}</b>
        <span>
          <button data-command="/coins 100 ${n}">🎁 +100 🪙</button>
          <button data-command="/cash 1000 ${n}">💵 +$1000</button>
          <button data-command="/heal ${n}">❤️</button>
          ${me ? '' : `<button data-command="/kill ${n}">💀</button>
          <button data-command="/kick ${n}">👢 Kick</button>
          <button data-command="/ban ${n}" class="danger">⛔ Ban</button>`}
        </span></div>`;
    }).join('');
  }
}
