// This is the game SERVER. It does two jobs:
//  1. It sends the game files to the web browsers.
//  2. It is the "referee" for multiplayer: it passes messages between the players,
//     and keeps track of health, scores, coins, rounds, balloons, power-ups, robots,
//     the weather and broken buildings, so everything is fair.
// Start it with:  npm start

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const SHOOT_DOWN_POINTS = 5;        // points for shooting down another plane
const ROBOT_POINTS = 2;             // points for shooting down a robot
const BALLOON_POINTS = 1;           // points for popping a balloon
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS) || 180; // how long a round lasts (3 minutes)
const BREAK_SECONDS = 10;           // how long the winner screen stays before the next round
const POWER_UP_RETURN_SECONDS = 20; // how long before a power-up box comes back
const POWER_UP_TYPES = ['repair', 'speed', 'triple', 'shield'];
const ROBOT_COUNT = 3;              // how many enemy robot planes

// COINS you earn 🪙
const COINS = { balloon: 1, robot: 3, shootDown: 10 };

// How many bullet hits each plane can take (+2 for each armor upgrade)
const HEALTH = { fighter: 10, jet: 10, bomber: 16, stunt: 8, golden: 10, heli: 12, robot: 6 };

// THE SHOP 🛒 — what you can buy, and how much it costs
const SHOP = {
  upgrades: {
    engine:   { name: '⚡ Faster engine', about: '+10% speed per level', prices: [20, 40, 80] },
    armor:    { name: '🛡️ Stronger armor', about: '+2 health per level', prices: [20, 40, 80] },
    guns:     { name: '🔫 Faster guns', about: 'Shoot 20% faster per level', prices: [15, 30, 60] },
    missiles: { name: '🚀 Faster missiles', about: 'Reload 0.8 s faster per level', prices: [15, 30, 60] },
  },
  planes: { golden: 150, heli: 200 },
  exchange: { cash: 100, coins: 10 },   // trade $100 for 10 coins
  stickers: { flames: 30, shark: 30, lightning: 30, stars: 30 },
};
const FREE_PLANES = ['fighter', 'jet', 'bomber', 'stunt'];

// =====================================================================
// 1. SENDING THE GAME FILES
// =====================================================================
const PUBLIC_FOLDER = path.join(__dirname, 'public');
const THREE_FOLDER = path.join(__dirname, 'node_modules', 'three');

const FILE_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((request, response) => {
  let url = decodeURIComponent(request.url.split('?')[0]);
  if (url === '/') url = '/index.html';

  // Files starting with /three/ come from the 3D library, everything else from "public"
  let baseFolder = PUBLIC_FOLDER;
  if (url.startsWith('/three/')) {
    baseFolder = THREE_FOLDER;
    url = url.slice('/three'.length);
  }

  const file = path.join(baseFolder, url);

  // Safety check: only send files that are inside the right folder
  if (!file.startsWith(baseFolder + path.sep)) {
    response.writeHead(403);
    response.end('Not allowed');
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const type = FILE_TYPES[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type });
    response.end(data);
  });
});

// =====================================================================
// 2. SAVED PROFILES: coins, upgrades, planes and stickers, remembered by name
// =====================================================================
const PROFILES_FILE = process.env.PROFILES_FILE || path.join(__dirname, 'profiles.json');
let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); } catch {}

let saveTimer = null;
function saveProfiles() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2), () => {}), 1000);
}

const newProfile = () => ({
  coins: 0, cash: 0, upgrades: { engine: 0, armor: 0, guns: 0, missiles: 0 },
  planes: [...FREE_PLANES], stickers: ['none'],
});

// Find the saved profile for this name (a new one is only saved when you click "Fly!")
function profileFor(name, create = true) {
  const key = name.trim().toLowerCase();
  if (!profiles[key]) {
    if (!create) return newProfile();
    profiles[key] = newProfile();
  }
  profiles[key].cash ??= 0;   // old profiles from before there was cash
  return profiles[key];
}

const ON_FOOT_HEALTH = 10;    // health when you walk or drive a car
const BUSTED_LOSS = 0.2;      // caught by the police: you lose 20% of your cash

// =====================================================================
// 👑 ADMIN: only the computer the server runs on is the boss.
// Other computers connect over the network, so they can never be admin.
// =====================================================================
const BANS_FILE = process.env.BANS_FILE || path.join(__dirname, 'bans.json');
let bans = { names: [], addresses: [] };
try { bans = JSON.parse(fs.readFileSync(BANS_FILE, 'utf8')); } catch {}
const saveBans = () => fs.writeFile(BANS_FILE, JSON.stringify(bans, null, 2), () => {});
// "This computer" = localhost, OR one of this computer's own Wi-Fi addresses (like 192.168.1.110)
function isThisComputer(address) {
  const mine = ['127.0.0.1', '::1'];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list) mine.push(a.address);
  return mine.some((m) => address === m || address === `::ffff:${m}`);
}

const maxHealthFor = (plane, profile) => HEALTH[plane] + 2 * (profile ? profile.upgrades.armor : 0);

// =====================================================================
// 3. MULTIPLAYER
// =====================================================================
const wss = new WebSocketServer({ server });

// Everybody gets the same seed number, so everybody builds the same city
const citySeed = Math.floor(Math.random() * 1e9);
let dayStartedAt = Date.now();    // so everybody has the same time of day
const players = new Map();        // everybody who is flying (and the robots)
const sockets = new Map();        // player id -> their connection
const balloons = {};              // balloons that moved since the start
const powerUps = {};              // power-up boxes that were taken or moved
const buildingHealth = new Map(); // damaged buildings: id -> health left
const destroyed = new Set();      // buildings that fell down
let nuked = false;                // ☢️ was the whole city destroyed this round?
let round = { phase: 'waiting', endsAt: 0, number: 0 };
let roundTimer = null;
let robotsOn = true;
let nextId = 1;

// Send a message to everybody (except maybe one person)
function sendToAll(message, except) {
  const text = JSON.stringify(message);
  for (const socket of wss.clients) {
    if (socket !== except && socket.readyState === socket.OPEN) socket.send(text);
  }
}

function sendTo(id, message) {
  const socket = sockets.get(id);
  if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

// The real players (not robots)
const humans = () => [...players.values()].filter((p) => !p.robot);

function sendPlayerList() {
  const people = humans();
  // One computer moves the robots around: the first player whose game is showing on the screen
  // (a browser pauses the game when its window is hidden, and then the robots would freeze)
  const showing = people.filter((p) => !p.hidden);
  const choices = showing.length ? showing : people;
  const robotOwner = choices.length ? Math.min(...choices.map((p) => p.id)) : null;
  sendToAll({ type: 'players', players: [...players.values()], robotOwner });
}

function sendProfile(id) {
  const player = players.get(id);
  if (player) sendTo(id, { type: 'profile', profile: profiles[player.key] });
}

function giveCoins(player, amount) {
  if (!player || player.robot) return;
  profiles[player.key].coins += amount;
  saveProfiles();
  sendProfile(player.id);
}

// ---------- ROBOTS 👾 ----------
function updateRobots() {
  const wanted = robotsOn && humans().length > 0;
  for (let i = 1; i <= ROBOT_COUNT; i++) {
    const id = `r${i}`;
    if (wanted && !players.has(id)) {
      players.set(id, {
        id, name: `🤖 Robo-${i}`, robot: true, plane: 'fighter', sticker: 'none', color: 0x777777,
        score: 0, health: HEALTH.robot, maxHealth: HEALTH.robot, alive: false, shield: false,
      });
    } else if (!wanted) {
      players.delete(id);
    }
  }
}

// ---------- WEATHER 🌧️ ----------
const WEATHERS = ['clear', 'clear', 'cloudy', 'rain', 'storm', 'fog'];
let weather = 'clear';
function changeWeather() {
  weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
  sendToAll({ type: 'weather', weather });
  setTimeout(changeWeather, (70 + Math.random() * 80) * 1000);
}
setTimeout(changeWeather, 60 * 1000);

// ---------- ROUNDS: 3 minutes of playing, then the winner screen ----------
function roundInfo() {
  return { phase: round.phase, remaining: Math.max(0, round.endsAt - Date.now()), number: round.number };
}

function startRound() {
  clearTimeout(roundTimer);
  round = { phase: 'playing', endsAt: Date.now() + ROUND_SECONDS * 1000, number: round.number + 1 };
  for (const p of players.values()) {
    p.score = 0;
    p.health = p.maxHealth;
  }
  buildingHealth.clear();
  destroyed.clear();
  nuked = false;
  console.log(`  🏁 Round ${round.number} starts!`);
  sendToAll({ type: 'newRound', round: roundInfo() });
  sendPlayerList();
  roundTimer = setTimeout(endRound, ROUND_SECONDS * 1000);
}

function endRound() {
  round = { ...round, phase: 'ended', endsAt: Date.now() + BREAK_SECONDS * 1000 };
  const ranking = humans()
    .sort((a, b) => b.score - a.score)
    .map(({ id, name, color, score }) => ({ id, name, color, score }));
  if (ranking.length) console.log(`  🏆 ${ranking[0].name} wins round ${round.number} with ${ranking[0].score} points!`);
  sendToAll({ type: 'roundOver', ranking, round: roundInfo() });
  roundTimer = setTimeout(() => (humans().length > 0 ? startRound() : stopRounds()), BREAK_SECONDS * 1000);
}

function stopRounds() {
  clearTimeout(roundTimer);
  round = { phase: 'waiting', endsAt: 0, number: round.number };
}

const playing = () => round.phase === 'playing';
const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);

// Somebody (or a robot) was shot down
function shootDown(target, killer, how) {
  target.alive = false;
  target.health = 0;
  if (killer) {
    if (playing()) killer.score += target.robot ? ROBOT_POINTS : SHOOT_DOWN_POINTS;
    giveCoins(killer, target.robot ? COINS.robot : COINS.shootDown);
  }
  console.log(`  💥 ${killer ? killer.name : 'Someone'} shot down ${target.name}!`);
  sendToAll({ type: 'killed', victim: target.id, killer: killer ? killer.id : null, how });
}

wss.on('connection', (socket, request) => {
  const address = request.socket.remoteAddress;
  const admin = isThisComputer(address);
  if (!admin && bans.addresses.includes(address)) {
    socket.send(JSON.stringify({ type: 'banned' }));
    socket.close();
    return;
  }
  const id = nextId++;
  sockets.set(id, socket);
  socket.send(JSON.stringify({
    type: 'welcome', id, seed: citySeed, admin, balloons, powerUps, destroyed: [...destroyed], nuked,
    serverNow: Date.now(), dayStartedAt, round: roundInfo(), weather, shop: SHOP, robotsOn,
  }));

  socket.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const me = players.get(id);

    switch (msg.type) {
      // The start screen asks: what does this name own?
      case 'lookup': {
        const name = String(msg.name || '').trim().slice(0, 12);
        if (name) socket.send(JSON.stringify({ type: 'profile', profile: profileFor(name, false) }));
        break;
      }

      // A new pilot typed their name, picked a plane, and clicked "Fly!"
      case 'join': {
        const name = String(msg.name || 'Pilot').trim().slice(0, 12) || 'Pilot';
        const key = name.toLowerCase();
        if (!admin && bans.names.includes(key)) {
          socket.send(JSON.stringify({ type: 'banned' }));
          socket.close();
          return;
        }
        const profile = profileFor(name);
        const plane = profile.planes.includes(msg.plane) ? msg.plane : 'fighter';
        const sticker = profile.stickers.includes(msg.sticker) ? msg.sticker : 'none';
        const maxHealth = maxHealthFor(plane, profile);
        players.set(id, {
          id, key, name, plane, sticker, color: Number(msg.color) || 0xd32f2f,
          score: 0, health: maxHealth, maxHealth, alive: true, shield: false, admin, address,
        });
        saveProfiles();
        console.log(`  ✈️  ${name} joined the game (${plane}) with ${profile.coins} coins`);
        if (typeof msg.robots === 'boolean') robotsOn = msg.robots;
        updateRobots();
        if (round.phase === 'waiting') startRound();
        else socket.send(JSON.stringify({ type: 'round', round: roundInfo() }));
        sendProfile(id);
        sendPlayerList();
        break;
      }

      // 👑 Admin commands (only from this computer!)
      case 'admin':
        if (!admin || !me) {
          socket.send(JSON.stringify({ type: 'adminResult', text: '⛔ Only the boss can do that!' }));
          return;
        }
        socket.send(JSON.stringify({ type: 'adminResult', text: runAdminCommand(me, String(msg.command || '')) }));
        break;

      // My game window was hidden or shown again
      case 'visible':
        if (me) {
          me.hidden = !msg.on;
          sendPlayerList();
        }
        break;

      // Turn the robots on or off
      case 'robots': {
        if (!me) return;
        robotsOn = !!msg.on;
        updateRobots();
        sendToAll({ type: 'robotsOn', on: robotsOn });
        sendPlayerList();
        break;
      }

      // I'm spawning with a different plane or sticker
      case 'changePlane': {
        if (!me) return;
        const profile = profiles[me.key];
        if (profile.planes.includes(msg.plane)) me.plane = msg.plane;
        if (profile.stickers.includes(msg.sticker)) me.sticker = msg.sticker;
        me.maxHealth = me.onGround ? ON_FOOT_HEALTH : maxHealthFor(me.plane, profile);
        me.health = me.maxHealth;
        sendPlayerList();
        break;
      }

      // Where my plane (or one of the robots) is right now
      case 'state': {
        const who = msg.robot ? players.get(msg.robot) : me;
        if (!me || !who || (msg.robot && !who.robot)) return;
        who.shield = !!msg.shield;
        // On the ground (walking or in a car) you have 10 health. In a plane: your plane's health.
        const onGround = msg.mode === 'walk' || msg.mode === 'car';
        if (!who.robot && onGround !== !!who.onGround) {
          who.onGround = onGround;
          who.maxHealth = onGround ? ON_FOOT_HEALTH : maxHealthFor(who.plane, profiles[who.key]);
          who.health = onGround ? Math.min(who.health || ON_FOOT_HEALTH, ON_FOOT_HEALTH) : who.maxHealth;
          if (!who.alive) who.health = who.maxHealth;
          sendPlayerList();
        }
        if (msg.alive && !who.alive) {         // back in the air: full health again
          who.alive = true;
          who.health = who.maxHealth;
          sendPlayerList();
        } else if (!msg.alive && who.alive) {  // crashed
          who.alive = false;
          sendPlayerList();
        }
        sendToAll({ ...msg, id: who.id }, socket);
        break;
      }

      // Bullets, bombs, missiles and the nuke falling: just tell the others so they can see them
      case 'shoot':
      case 'bomb':
      case 'missile':
      case 'missileBoom':
      case 'nuke':
      case 'honk':
        if (me) sendToAll({ ...msg, id: msg.robot && players.get(msg.robot) ? msg.robot : id }, socket);
        break;

      // My bullet, bomb or missile (or a robot's bullet, or a person in the street) hit somebody!
      case 'hit': {
        const shooter = msg.robot ? players.get(msg.robot) : msg.npc ? null : me;
        const target = players.get(msg.target);
        if (!me || (!shooter && !msg.npc) || !playing() || !target || !target.alive || target.health <= 0) return;
        if (target.god) return;                               // 👑 the admin's god mode
        if (msg.npc && target !== me) return;                 // people in the street: only report hits on yourself
        if (target.shield && !msg.unstoppable) return;        // the super missile even goes through shields!
        const damage = Math.max(0, Math.min(100, Number(msg.damage) || 0));
        target.health = Math.max(0, target.health - damage);
        if (target.health === 0) {
          if (msg.police && !target.robot) {   // BUSTED by the police!
            const profile = profiles[target.key];
            profile.cash = Math.floor(profile.cash * (1 - BUSTED_LOSS));
            saveProfiles();
            sendProfile(target.id);
          }
          shootDown(target, shooter && !shooter.robot ? shooter : null, msg.police ? 'police' : 'shot');
        }
        sendPlayerList();
        break;
      }

      // I landed on the runway: repair my plane
      case 'repair':
        if (me && me.alive) {
          me.health = me.maxHealth;
          sendPlayerList();
        }
        break;

      // I robbed something, or picked up cash 💵
      case 'cash':
        if (me) {
          profiles[me.key].cash += Math.max(0, Math.min(10000, Math.floor(Number(msg.amount) || 0)));
          saveProfiles();
          sendProfile(id);
        }
        break;

      // I picked up a coin
      case 'coin':
        if (me) giveCoins(me, Math.max(0, Math.min(2, Math.floor(Number(msg.amount) || 0))));
        break;

      // I want to buy something in the shop
      case 'buy': {
        if (!me) return;
        const profile = profiles[me.key];
        let price = null;
        if (msg.kind === 'upgrade' && SHOP.upgrades[msg.item]) {
          price = SHOP.upgrades[msg.item].prices[profile.upgrades[msg.item]];  // undefined when maxed out
        } else if (msg.kind === 'plane' && SHOP.planes[msg.item] && !profile.planes.includes(msg.item)) {
          price = SHOP.planes[msg.item];
        } else if (msg.kind === 'sticker' && SHOP.stickers[msg.item] && !profile.stickers.includes(msg.item)) {
          price = SHOP.stickers[msg.item];
        } else if (msg.kind === 'exchange') {
          // Trade cash for coins
          if (profile.cash < SHOP.exchange.cash) return sendTo(id, { type: 'shopResult', ok: false, item: 'exchange' });
          profile.cash -= SHOP.exchange.cash;
          profile.coins += SHOP.exchange.coins;
          saveProfiles();
          sendTo(id, { type: 'shopResult', ok: true, item: 'exchange' });
          sendProfile(id);
          return;
        }
        if (price === null || price === undefined || profile.coins < price) {
          sendTo(id, { type: 'shopResult', ok: false, item: msg.item });
          return;
        }
        profile.coins -= price;
        if (msg.kind === 'upgrade') profile.upgrades[msg.item]++;
        if (msg.kind === 'plane') profile.planes.push(msg.item);
        if (msg.kind === 'sticker') profile.stickers.push(msg.item);
        if (msg.item === 'armor') me.maxHealth = maxHealthFor(me.plane, profile);
        saveProfiles();
        console.log(`  🛒 ${me.name} bought ${msg.item} for ${price} coins`);
        sendTo(id, { type: 'shopResult', ok: true, item: msg.item });
        sendProfile(id);
        sendPlayerList();
        break;
      }

      // My bomb or missile damaged some buildings
      case 'damage': {
        if (!me || !Array.isArray(msg.hits)) return;
        for (const hit of msg.hits.slice(0, 50)) {
          const building = Math.floor(Number(hit.id));
          if (!(building >= 0 && building < 100000) || destroyed.has(building)) continue;
          const start = Math.max(1, Math.min(10, Number(hit.maxHealth) || 1));
          const health = (buildingHealth.get(building) ?? start) - Math.max(0, Math.min(5, Number(hit.amount) || 0));
          if (health <= 0) {
            buildingHealth.delete(building);
            destroyed.add(building);
            sendToAll({ type: 'destroyed', building, by: id });
          } else {
            buildingHealth.set(building, health);
          }
        }
        break;
      }

      // ☢️ THE NUKE landed! The whole city falls down and everybody else is shot down.
      case 'nukeBoom': {
        if (!me || !Array.isArray(msg.p)) return;
        nuked = true;
        console.log(`  ☢️  ${me.name} dropped the NUKE!!!`);
        sendToAll({ type: 'nukeBoom', p: msg.p, by: id }, socket);
        for (const target of players.values()) {
          if (target !== me && target.alive) shootDown(target, me, 'nuke');
        }
        sendPlayerList();
        break;
      }

      // I popped a balloon! Only the first person to pop it gets the point.
      case 'pop': {
        if (!me || !isNumber(msg.x) || !isNumber(msg.y) || !isNumber(msg.z)) return;
        const balloon = balloons[msg.id] || { v: 0 };
        if (msg.v !== balloon.v) return;      // too late, somebody else popped it first
        balloons[msg.id] = { v: balloon.v + 1, x: msg.x, y: msg.y, z: msg.z, color: Number(msg.color) || 0xff4081 };
        if (playing()) me.score += BALLOON_POINTS;
        giveCoins(me, COINS.balloon);
        sendToAll({ type: 'balloon', id: msg.id, ...balloons[msg.id], by: id });
        sendPlayerList();
        break;
      }

      // I flew through a power-up box! Only the first person gets it.
      case 'take': {
        const boxId = Math.floor(Number(msg.id));
        if (!me || !(boxId >= 0 && boxId < 20) || !POWER_UP_TYPES.includes(msg.taken)) return;
        const box = powerUps[boxId] || { v: 0, visible: true };
        if (!box.visible || msg.v !== box.v) return;
        box.visible = false;
        box.v++;
        powerUps[boxId] = box;
        if (msg.taken === 'repair') me.health = me.maxHealth;
        sendToAll({ type: 'powerup', id: boxId, v: box.v, visible: false, takenBy: id, taken: msg.taken });
        sendPlayerList();
        // The box comes back later, somewhere else
        const next = msg.next || {};
        if (!isNumber(next.x) || !isNumber(next.y) || !isNumber(next.z) || !POWER_UP_TYPES.includes(next.type)) return;
        setTimeout(() => {
          Object.assign(box, { v: box.v + 1, visible: true, x: next.x, y: next.y, z: next.z, type: next.type });
          sendToAll({ type: 'powerup', id: boxId, ...box });
        }, POWER_UP_RETURN_SECONDS * 1000);
        break;
      }
    }
  });

  socket.on('close', () => {
    const player = players.get(id);
    players.delete(id);
    sockets.delete(id);
    if (player) console.log(`  👋 ${player.name} left the game`);
    updateRobots();
    sendToAll({ type: 'left', id });
    sendPlayerList();
    if (humans().length === 0 && round.phase === 'playing') stopRounds();
  });
});

// 👑 What the admin can do. Gives back a text that says what happened.
function runAdminCommand(me, command) {
  const words = command.trim().replace(/^\//, '').split(/\s+/);
  const what = (words[0] || '').toLowerCase();
  const findPlayer = (name) => [...players.values()].find((p) => !p.robot && p.key === String(name || '').toLowerCase());
  const amount = (text) => Math.max(-1e9, Math.min(1e9, Math.floor(Number(text) || 0)));
  // "coins 500" = me, "coins 500 dad" = dad
  const whoFor = (name) => (name ? findPlayer(name) : me);

  switch (what) {
    case 'help':
      return 'Commands: /coins 500 [name] · /cash 1000 [name] · /gift name 500 · /heal [name] · /kill name · ' +
             '/kick name · /ban name · /unban name · /bans · /god · /unlock [name] · /weather clear|cloudy|rain|storm|fog · ' +
             '/time morning|day|sunset|night · /round end|new · /robots on|off · /players';
    case 'coins':
    case 'cash': {
      const target = whoFor(words[2]);
      if (!target) return `❓ Nobody called "${words[2]}"`;
      const profile = profiles[target.key];
      profile[what] = Math.max(0, (profile[what] || 0) + amount(words[1]));
      saveProfiles();
      sendProfile(target.id);
      const sign = what === 'coins' ? '🪙' : '💵 $';
      if (target !== me) sendTo(target.id, { type: 'gift', text: `🎁 The boss gave you ${sign}${amount(words[1])}!` });
      return `✅ ${target.name} now has ${sign}${profile[what]}`;
    }
    case 'gift':
      return runAdminCommand(me, `coins ${words[2]} ${words[1]}`);
    case 'heal': {
      const target = whoFor(words[1]);
      if (!target) return `❓ Nobody called "${words[1]}"`;
      target.health = target.maxHealth;
      sendPlayerList();
      return `❤️ ${target.name} is healed`;
    }
    case 'kill': {
      const target = findPlayer(words[1]);
      if (!target || !target.alive) return `❓ "${words[1]}" can't be knocked out right now`;
      shootDown(target, null, 'boss');
      sendPlayerList();
      return `💀 ${target.name} was knocked out`;
    }
    case 'kick':
    case 'ban': {
      const target = findPlayer(words[1]);
      if (target && target.admin) return "😅 You can't kick or ban yourself!";
      if (what === 'ban' && words[1]) {
        const key = String(words[1]).toLowerCase();
        if (!bans.names.includes(key)) bans.names.push(key);
        if (target && !bans.addresses.includes(target.address)) bans.addresses.push(target.address);
        saveBans();
      }
      if (target) {
        sendTo(target.id, { type: what === 'ban' ? 'banned' : 'kicked' });
        sockets.get(target.id)?.close();
      }
      if (what === 'ban') return `⛔ ${words[1]} is banned`;
      return target ? `👢 ${target.name} was kicked out` : `❓ Nobody called "${words[1]}"`;
    }
    case 'unban': {
      const key = String(words[1] || '').toLowerCase();
      bans.names = bans.names.filter((n) => n !== key);
      bans.addresses = [];     // (forget the banned computers too)
      saveBans();
      return `✅ ${words[1]} can play again`;
    }
    case 'bans':
      return bans.names.length ? `⛔ Banned: ${bans.names.join(', ')}` : 'Nobody is banned';
    case 'god':
      me.god = !me.god;
      return me.god ? '😇 God mode ON: nobody can hurt you' : 'God mode OFF';
    case 'unlock': {
      const target = whoFor(words[1]);
      if (!target) return `❓ Nobody called "${words[1]}"`;
      const profile = profiles[target.key];
      profile.planes = [...FREE_PLANES, ...Object.keys(SHOP.planes)];
      profile.stickers = ['none', ...Object.keys(SHOP.stickers)];
      for (const u in SHOP.upgrades) profile.upgrades[u] = SHOP.upgrades[u].prices.length;
      saveProfiles();
      sendProfile(target.id);
      return `🔓 ${target.name} has every plane, sticker and upgrade!`;
    }
    case 'weather':
      if (!['clear', 'cloudy', 'rain', 'storm', 'fog'].includes(words[1])) return 'Try: /weather clear, cloudy, rain, storm or fog';
      weather = words[1];
      sendToAll({ type: 'weather', weather });
      return `🌦️ Weather: ${weather}`;
    case 'time': {
      const when = { morning: 0.02, day: 0.25, sunset: 0.535, night: 0.75 }[words[1]];
      if (when === undefined) return 'Try: /time morning, day, sunset or night';
      dayStartedAt = Date.now() - when * 480000;
      sendToAll({ type: 'time', dayStartedAt });
      return `🕐 It's ${words[1]} now`;
    }
    case 'round':
      if (words[1] === 'end' && round.phase === 'playing') { clearTimeout(roundTimer); endRound(); return '🏁 Round ended'; }
      if (words[1] === 'new') { startRound(); return '🏁 New round!'; }
      return 'Try: /round end or /round new';
    case 'robots':
      robotsOn = words[1] !== 'off';
      updateRobots();
      sendToAll({ type: 'robotsOn', on: robotsOn });
      sendPlayerList();
      return robotsOn ? '👾 Robots on' : 'Robots off';
    case 'players':
      return humans().map((p) => `${p.name} (🪙${profiles[p.key].coins} 💵$${profiles[p.key].cash || 0})`).join(' · ');
    default:
      return `❓ I don't know "${what}". Type /help`;
  }
}

server.listen(PORT, () => {
  console.log('');
  console.log('  ✈️  Skys is running!');
  console.log('');
  console.log(`  On this computer, open:   http://localhost:${PORT}`);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  On another computer:      http://${a.address}:${PORT}`);
      }
    }
  }
  console.log('');
  console.log('  Press Ctrl+C to stop the server.');
  console.log('');
});
