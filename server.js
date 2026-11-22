// This is the game SERVER. It does two jobs:
//  1. It sends the game files to the web browsers.
//  2. It is the "referee" for multiplayer: it passes messages between the players,
//     and keeps track of health, scores and balloons so everything is fair.
// Start it with:  npm start

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = 3000;
const MAX_HEALTH = 10;        // how many bullet hits a plane can take
const SHOOT_DOWN_POINTS = 5;  // points for shooting down another plane
const BALLOON_POINTS = 1;     // points for popping a balloon

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
// 2. MULTIPLAYER
// =====================================================================
const wss = new WebSocketServer({ server });

// Everybody gets the same seed number, so everybody builds the same city
const citySeed = Math.floor(Math.random() * 1e9);
const players = new Map();  // everybody who is flying
const balloons = {};        // balloons that moved since the start
let nextId = 1;

// Send a message to everybody (except maybe one person)
function sendToAll(message, except) {
  const text = JSON.stringify(message);
  for (const socket of wss.clients) {
    if (socket !== except && socket.readyState === socket.OPEN) socket.send(text);
  }
}

function sendPlayerList() {
  sendToAll({ type: 'players', players: [...players.values()] });
}

wss.on('connection', (socket) => {
  const id = nextId++;
  socket.send(JSON.stringify({ type: 'welcome', id, seed: citySeed, balloons, maxHealth: MAX_HEALTH }));

  socket.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const me = players.get(id);

    switch (msg.type) {
      // A new pilot typed their name and clicked "Fly!"
      case 'join': {
        const name = String(msg.name || 'Pilot').slice(0, 12);
        players.set(id, { id, name, color: Number(msg.color) || 0xd32f2f, score: 0, health: MAX_HEALTH, alive: true });
        console.log(`  ✈️  ${name} joined the game`);
        sendPlayerList();
        break;
      }

      // Where my plane is right now (sent 20 times per second)
      case 'state': {
        if (!me) return;
        if (msg.alive && !me.alive) {         // back in the air: full health again
          me.alive = true;
          me.health = MAX_HEALTH;
          sendPlayerList();
        } else if (!msg.alive && me.alive) {  // crashed
          me.alive = false;
          sendPlayerList();
        }
        sendToAll({ ...msg, id }, socket);
        break;
      }

      // Bullets and bombs: just tell the others so they can see them
      case 'shoot':
      case 'bomb':
        if (me) sendToAll({ ...msg, id }, socket);
        break;

      // My bullet or bomb hit somebody!
      case 'hit': {
        const target = players.get(msg.target);
        if (!me || !target || !target.alive || target.health <= 0) return;
        const damage = Math.max(0, Math.min(MAX_HEALTH, Number(msg.damage) || 0));
        target.health = Math.max(0, target.health - damage);
        if (target.health === 0) {
          target.alive = false;
          me.score += SHOOT_DOWN_POINTS;
          console.log(`  💥 ${me.name} shot down ${target.name}!`);
          sendToAll({ type: 'killed', victim: target.id, killer: id });
        }
        sendPlayerList();
        break;
      }

      // I popped a balloon! Only the first person to pop it gets the point.
      case 'pop': {
        if (!me) return;
        const balloon = balloons[msg.id] || { v: 0 };
        if (msg.v !== balloon.v) return;      // too late, somebody else popped it first
        balloons[msg.id] = { v: balloon.v + 1, x: msg.x, y: msg.y, z: msg.z, color: msg.color };
        me.score += BALLOON_POINTS;
        sendToAll({ type: 'balloon', id: msg.id, ...balloons[msg.id], by: id });
        sendPlayerList();
        break;
      }
    }
  });

  socket.on('close', () => {
    const player = players.get(id);
    players.delete(id);
    if (player) console.log(`  👋 ${player.name} left the game`);
    sendToAll({ type: 'left', id });
    sendPlayerList();
  });
});

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
