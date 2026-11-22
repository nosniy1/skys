// ✈️ SKYS — the main game file
import * as THREE from 'three';
import { Sounds } from './sounds.js';
import { createWorld, random } from './world.js';
import { makePlane, makeBomb, makeNameTag } from './plane.js';
import { Effects } from './effects.js';
import { Network } from './network.js';

// =====================================================================
// SETTINGS — try changing these numbers to change how the game feels!
// (Health and points are in server.js, because the server is the referee.)
// =====================================================================
const SETTINGS = {
  normalSpeed: 40,      // how fast the plane flies normally
  boostSpeed: 100,      // how fast the plane flies when you hold Shift
  turnSpeed: 1.3,       // how fast you turn left and right
  climbSpeed: 1.0,      // how fast the nose goes up and down
  maxClimbAngle: 1.1,   // how steep you can climb or dive
  shootDelay: 0.1,      // seconds between each bullet
  bulletSpeed: 300,     // how fast bullets fly
  bombDelay: 0.4,       // seconds between each bomb
  bombGravity: 30,      // how fast bombs fall
  bombBlastSize: 35,    // how far away a bomb can pop balloons and hurt planes
  maxHeight: 400,       // the highest you can fly
  cityBlocks: 20,       // how many blocks wide the city is
  balloonCount: 40,     // how many balloons to pop
};

const PLANE_COLORS = [0xd32f2f, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xfb8c00, 0xec407a, 0x263238];

// =====================================================================
// THE 3D WORLD: renderer, camera, lights
// =====================================================================
// logarithmicDepthBuffer stops flat things (like streets on grass) from flickering
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 6000);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5b6b4a, 1.4));
// The sun. It follows the plane so there are always nice shadows near you.
const sun = new THREE.DirectionalLight(0xfff1dc, 3);
const SUN_OFFSET = new THREE.Vector3(250, 450, 150);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -350, right: 350, top: 350, bottom: -350, near: 10, far: 1500 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// =====================================================================
// CONNECT TO THE SERVER (it tells us the city "seed" so everybody has the same city)
// =====================================================================
const statusText = document.getElementById('status');
const network = new Network();
let welcome;
try {
  welcome = await network.connect();
} catch {
  statusText.textContent = "😢 Can't connect to the server. Is it running? (npm start)";
  throw new Error('No server');
}

const world = createWorld(scene, renderer, SETTINGS, welcome.seed);
const effects = new Effects(scene);
const sounds = new Sounds();
const MAX_HEALTH = welcome.maxHealth;

// =====================================================================
// MY AIRPLANE
// =====================================================================
const planeMesh = makePlane(PLANE_COLORS[0]);
scene.add(planeMesh);

const player = {
  pos: new THREE.Vector3(),
  yaw: 0,      // which way we are facing (left/right)
  pitch: 0,    // nose up or down
  roll: 0,     // tilting the wings when turning
  speed: 0,
  alive: true,
  respawnTimer: 0,
  boosting: false,
  shootTimer: 0,
  bombTimer: 0,
};

function resetPlayer() {
  // Start outside the city, at a random spot so two players don't start in the same place
  player.pos.set((Math.random() - 0.5) * 300, 80, world.citySize / 2 + 150);
  player.yaw = 0;
  player.pitch = 0;
  player.roll = 0;
  player.speed = SETTINGS.normalSpeed;
  player.alive = true;
  planeMesh.visible = true;
}
resetPlayer();

// =====================================================================
// THE OTHER PLAYERS
// =====================================================================
const others = new Map();   // id -> the other player's plane, name tag, and where they are
let playerList = [];        // everybody, with names, colors, scores and health (from the server)
let me = null;              // my own entry in playerList

function addOther(info) {
  const mesh = makePlane(info.color);
  mesh.visible = false;
  scene.add(mesh);
  const tag = makeNameTag();
  tag.visible = false;
  scene.add(tag);
  const other = {
    info, mesh, tag,
    target: { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 0 },
    receivedAt: 0,
    alive: false,
    hasState: false,
  };
  others.set(info.id, other);
  if (started) showMessage(`👋 ${info.name} joined!`, 2.5);
  return other;
}

function removeOther(id) {
  const other = others.get(id);
  if (!other) return;
  scene.remove(other.mesh, other.tag);
  others.delete(id);
  if (started) showMessage(`👋 ${other.info.name} left`, 2.5);
}

function updatePlayerList(list) {
  playerList = list;
  const oldHealth = me ? me.health : null;
  me = list.find((p) => p.id === network.id) || null;

  for (const info of list) {
    if (info.id === network.id) continue;
    const other = others.get(info.id) || addOther(info);
    other.info = info;
    other.tag.userData.draw(info.name, info.color, info.health, MAX_HEALTH);
  }
  for (const id of [...others.keys()]) {
    if (!list.some((p) => p.id === id)) removeOther(id);
  }

  // Did I just get hit?
  if (me && oldHealth !== null && me.health < oldHealth && me.health > 0) {
    flashScreen(0.35, '#ff0000');
    sounds.hit();
  }
  updateScoreboard();
}

const ahead = new THREE.Vector3();
const guess = new THREE.Vector3();
const turnTo = (from, to, amount) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * amount;

// We only hear from the others 20 times per second, so in between we guess
// where they are by moving them forward at their speed. Then we glide there smoothly.
function updateOthers(dt) {
  const now = performance.now() / 1000;
  for (const other of others.values()) {
    other.mesh.visible = other.tag.visible = other.alive && other.hasState;
    if (!other.mesh.visible) continue;
    const t = other.target;
    ahead.set(0, 0, -1).applyEuler(new THREE.Euler(t.pitch, t.yaw, 0, 'YXZ'));
    guess.copy(t.pos).addScaledVector(ahead, t.speed * Math.min(now - other.receivedAt, 0.3));
    const smooth = 1 - Math.exp(-dt * 15);
    other.mesh.position.lerp(guess, smooth);
    const r = other.mesh.rotation;
    r.set(turnTo(r.x, t.pitch, smooth), turnTo(r.y, t.yaw, smooth), turnTo(r.z, t.roll, smooth));
    other.mesh.userData.propeller.rotation.z += dt * 40;
    other.tag.position.copy(other.mesh.position);
    other.tag.position.y += 5;
  }
}

function onOtherState(msg) {
  const other = others.get(msg.id);
  if (!other) return;
  const t = other.target;
  t.pos.fromArray(msg.p);
  t.yaw = msg.yaw;
  t.pitch = msg.pitch;
  t.roll = msg.roll;
  t.speed = msg.speed;
  other.receivedAt = performance.now() / 1000;
  if (msg.alive && (!other.alive || !other.hasState)) {
    // They just appeared (or came back after crashing): jump straight there
    other.mesh.position.copy(t.pos);
    other.mesh.rotation.set(t.pitch, t.yaw, t.roll);
  }
  if (other.alive && !msg.alive && other.hasState) {
    bigBang(other.mesh.position.clone(), 0.6, other.mesh.position.y < 3 ? 0 : null, false);
  }
  other.alive = msg.alive;
  other.hasState = true;
}

// Tell everybody where my plane is, 20 times per second
let sendTimer = 0;
const round = (n) => Math.round(n * 100) / 100;
function sendMyState(dt) {
  sendTimer -= dt;
  if (sendTimer > 0) return;
  sendTimer = 0.05;
  network.send({
    type: 'state',
    p: player.pos.toArray().map(round),
    yaw: round(player.yaw), pitch: round(player.pitch), roll: round(player.roll),
    speed: round(player.speed), alive: player.alive,
  });
}

// =====================================================================
// BALLOONS to shoot at (the same for everybody: first one to pop it gets the point!)
// =====================================================================
const balloons = [];
const balloonColors = [0xff4081, 0xffeb3b, 0x00e5ff, 0x76ff03, 0xff9100, 0xd500f9];
const balloonShape = new THREE.SphereGeometry(4, 16, 12);
const stringShape = new THREE.CylinderGeometry(0.05, 0.05, 6);
const stringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

// Find a free spot in the sky for a balloon (not inside a building)
function balloonSpot(randomNumber) {
  const spread = world.citySize / 2;
  const spot = new THREE.Vector3();
  do {
    spot.set((randomNumber() * 2 - 1) * spread, 30 + randomNumber() * 150, (randomNumber() * 2 - 1) * spread);
  } while (world.hitsBuilding(spot, 8));
  const color = balloonColors[Math.floor(randomNumber() * balloonColors.length)];
  return { x: round(spot.x), y: round(spot.y), z: round(spot.z), color };
}

function moveBalloon(balloon, spot) {
  balloon.baseY = spot.y;
  balloon.group.position.set(spot.x, spot.y, spot.z);
  balloon.color = spot.color;
  balloon.sphere.material.color.setHex(spot.color);
  balloon.group.visible = true;
}

for (let i = 0; i < SETTINGS.balloonCount; i++) {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(balloonShape, new THREE.MeshStandardMaterial({ roughness: 0.3 }));
  sphere.castShadow = true;
  const string = new THREE.Mesh(stringShape, stringMaterial);
  string.position.y = -7;
  group.add(sphere, string);
  scene.add(group);
  const balloon = { id: i, v: 0, group, sphere, baseY: 0, wobble: Math.random() * 10, color: 0 };
  moveBalloon(balloon, balloonSpot(random)); // "random" with the seed: same spots for everybody
  balloons.push(balloon);
}
// Balloons that were already popped and moved before I joined
for (const [id, spot] of Object.entries(welcome.balloons)) {
  balloons[id].v = spot.v;
  moveBalloon(balloons[id], spot);
}

function popBalloon(balloon) {
  if (!balloon.group.visible) return;
  effects.burst(balloon.group.position, balloon.color, 15, 25, 0.8, true);
  sounds.pop();
  balloon.group.visible = false;   // hide it until the server says where the new one goes
  network.send({ type: 'pop', id: balloon.id, v: balloon.v, ...balloonSpot(Math.random) });
}

// The server says a balloon was popped and moved
function onBalloonMoved(msg) {
  const balloon = balloons[msg.id];
  if (balloon.group.visible) {   // somebody else popped it
    effects.burst(balloon.group.position, balloon.color, 15, 25, 0.8, true);
    sounds.pop();
  }
  balloon.v = msg.v;
  moveBalloon(balloon, msg);
}

// =====================================================================
// BULLETS
// =====================================================================
const bullets = [];
const bulletShape = new THREE.BoxGeometry(0.15, 0.15, 3);
const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffee58 });
let gunSide = 1;

function addBullet(position, velocity, mine) {
  const mesh = new THREE.Mesh(bulletShape, bulletMaterial);
  mesh.position.copy(position);
  mesh.lookAt(position.clone().add(velocity));
  scene.add(mesh);
  bullets.push({ mesh, velocity, life: 2, mine });
}

function shoot(forward) {
  // Guns on the wings: left, right, left, right...
  const position = new THREE.Vector3(gunSide * 2.2, -0.3, -1.5).applyMatrix4(planeMesh.matrixWorld);
  gunSide = -gunSide;
  const velocity = forward.clone().multiplyScalar(SETTINGS.bulletSpeed + player.speed);
  addBullet(position, velocity, true);
  sounds.shoot();
  network.send({ type: 'shoot', p: position.toArray().map(round), v: velocity.toArray().map(round) });
}

// Bullets move a lot in one frame, so we check the whole line they moved along
const line = new THREE.Line3();
const closest = new THREE.Vector3();
function lineHits(from, to, center, radius) {
  line.set(from, to);
  line.closestPointToPoint(center, true, closest);
  return closest.distanceTo(center) < radius;
}

const before = new THREE.Vector3();
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    const p = b.mesh.position;
    before.copy(p);
    p.addScaledVector(b.velocity, dt);
    b.life -= dt;

    let gone = b.life <= 0;
    if (p.y < 0 || world.hitsBuilding(p, 0)) {
      effects.sparks(p);
      gone = true;
    }
    // Only MY bullets check what they hit. The other player's computer checks theirs.
    if (b.mine && !gone) {
      for (const balloon of balloons) {
        if (balloon.group.visible && lineHits(before, p, balloon.group.position, 5)) {
          popBalloon(balloon);
          gone = true;
          break;
        }
      }
      for (const [id, other] of others) {
        if (!gone && other.alive && other.hasState && lineHits(before, p, other.mesh.position, 4.5)) {
          network.send({ type: 'hit', target: id, damage: 1 });
          effects.sparks(p);
          sounds.hit(0.6);
          gone = true;
        }
      }
    }
    if (gone) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
    }
  }
}

// =====================================================================
// BOMBS 💣
// =====================================================================
const bombs = [];
const bombModel = makeBomb();
const noWhistle = { stop() {} };

function addBomb(position, velocity, mine) {
  const mesh = bombModel.clone();
  mesh.position.copy(position);
  scene.add(mesh);
  bombs.push({ mesh, velocity, mine, whistle: mine ? sounds.bombDrop() : noWhistle });
}

function dropBomb(forward) {
  const position = new THREE.Vector3(0, -1.2, -0.5).applyMatrix4(planeMesh.matrixWorld);
  // The bomb starts with the plane's speed, then gravity pulls it down
  const velocity = forward.clone().multiplyScalar(player.speed * 0.9);
  velocity.y -= 4;
  addBomb(position, velocity, true);
  network.send({ type: 'bomb', p: position.toArray().map(round), v: velocity.toArray().map(round) });
}

const aim = new THREE.Vector3();

function updateBombs(dt) {
  for (let i = bombs.length - 1; i >= 0; i--) {
    const bomb = bombs[i];
    bomb.velocity.y -= SETTINGS.bombGravity * dt;
    bomb.mesh.position.addScaledVector(bomb.velocity, dt);
    bomb.mesh.lookAt(aim.copy(bomb.mesh.position).add(bomb.velocity)); // nose points where it's going

    const p = bomb.mesh.position;
    const building = world.hitsBuilding(p, 0);
    const hitBalloon = balloons.some((b) => b.group.visible && b.group.position.distanceTo(p) < 6);
    const hitPlane = [...others.values()].some((o) => o.alive && o.hasState && o.mesh.position.distanceTo(p) < 5);
    if (p.y <= 0 || building || hitBalloon || hitPlane) {
      let surface = null;                              // exploded in the air
      if (!building && !hitBalloon && !hitPlane) {
        p.y = 0;
        surface = 0;                                   // hit the ground
      } else if (building && p.y > building.height - 4) {
        p.y = building.height;
        surface = building.height;                     // hit a roof
      }
      bomb.whistle.stop();
      bigBang(p.clone(), 1, surface, bomb.mine);
      scene.remove(bomb.mesh);
      bombs.splice(i, 1);
    }
  }
}

// A big explosion: fire, smoke, sound and shaking. If it's MY bomb, it also
// pops balloons and hurts other planes nearby.
function bigBang(position, size, surface, mine) {
  effects.explosion(position, size, surface);
  if (mine && size >= 1) {   // the bomb camera keeps watching the explosion for a moment
    lastBlast.copy(position);
    blastTimer = 2;
  }
  const distance = camera.position.distanceTo(position);
  sounds.bigBoom(THREE.MathUtils.clamp(1 - distance / 1500, 0.2, 1) * size);
  shake = Math.max(shake, Math.max(0, 1 - distance / 400) * 4 * size);
  if (distance < 250) flashScreen(0.6 * (1 - distance / 250), '#ffcc66');

  if (mine && size >= 1) {
    for (const balloon of balloons) {
      if (balloon.group.position.distanceTo(position) < SETTINGS.bombBlastSize) popBalloon(balloon);
    }
    for (const [id, other] of others) {
      if (!other.alive || !other.hasState) continue;
      const d = other.mesh.position.distanceTo(position);
      const damage = d < 15 ? 10 : d < SETTINGS.bombBlastSize ? 4 : 0;
      if (damage > 0) network.send({ type: 'hit', target: id, damage });
    }
    // Careful! If your own bomb explodes too close, you crash too.
    if (player.alive && player.pos.distanceTo(position) < 15) crash();
  }
}

// =====================================================================
// MESSAGES FROM THE SERVER
// =====================================================================
const nameOf = (id) => (playerList.find((p) => p.id === id) || { name: 'Someone' }).name;

network.onMessage = (msg) => {
  switch (msg.type) {
    case 'players': updatePlayerList(msg.players); break;
    case 'state': onOtherState(msg); break;
    case 'left': removeOther(msg.id); break;
    case 'balloon': onBalloonMoved(msg); break;
    case 'shoot': {
      const position = new THREE.Vector3().fromArray(msg.p);
      addBullet(position, new THREE.Vector3().fromArray(msg.v), false);
      sounds.shoot(0.6 * Math.max(0, 1 - camera.position.distanceTo(position) / 600));
      break;
    }
    case 'bomb':
      addBomb(new THREE.Vector3().fromArray(msg.p), new THREE.Vector3().fromArray(msg.v), false);
      break;
    case 'killed':
      if (msg.victim === network.id) {
        crash();
        showMessage(`💥 ${nameOf(msg.killer)} shot you down!`, 2.5);
      } else if (msg.killer === network.id) {
        showMessage(`🎯 You shot down ${nameOf(msg.victim)}! +5`, 2.5);
      }
      break;
  }
};

network.onClose = () => showMessage('😢 Lost connection to the server. Reload the page!', 1e9);

// =====================================================================
// KEYBOARD
// =====================================================================
const keys = {};
let cameraMode = 'behind';
let started = false;

addEventListener('keydown', (e) => {
  if (!started) return;        // while typing your name, keys don't fly the plane
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyC') {
    cameraMode = cameraMode === 'behind' ? 'cockpit' : 'behind';
    document.getElementById('crosshair').hidden = cameraMode !== 'cockpit';
    for (const part of planeMesh.userData.hideInCockpit) part.visible = cameraMode !== 'cockpit';
  }
  if (e.code === 'KeyM') sounds.toggleMusic();
  if (e.code === 'KeyF') toggleFullscreen();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

// =====================================================================
// SCREEN MESSAGES, SCORES AND HEALTH
// =====================================================================
const hudText = document.getElementById('hudtext');
const healthFill = document.querySelector('#healthbar div');
const scoreboard = document.getElementById('scoreboard');
const message = document.getElementById('message');
const flash = document.getElementById('flash');
let messageTimer = 0;

function showMessage(text, seconds) {
  message.textContent = text;
  messageTimer = seconds;
}

function flashScreen(strength, color) {
  flash.style.transition = 'none';
  flash.style.background = color;
  flash.style.opacity = strength;
  requestAnimationFrame(() => {
    flash.style.transition = 'opacity 0.8s';
    flash.style.opacity = 0;
  });
}

const hex = (color) => '#' + color.toString(16).padStart(6, '0');
const safe = (text) => text.replace(/[<>&"]/g, '');

function updateScoreboard() {
  scoreboard.hidden = !started || playerList.length === 0;
  scoreboard.innerHTML = [...playerList]
    .sort((a, b) => b.score - a.score)
    .map((p) => `<span class="${p.id === network.id ? 'me' : ''}"><span style="color:${hex(p.color)}">●</span> ${safe(p.name)}: ${p.score}</span>`)
    .join('');
}

function updateHud() {
  hudText.innerHTML =
    `💨 Speed: ${Math.round(player.speed * 3)} km/h<br>` +
    `⬆️ Height: ${Math.round(player.pos.y)} m`;
  const health = me ? me.health / MAX_HEALTH : 1;
  healthFill.style.width = `${health * 100}%`;
  healthFill.style.background = health > 0.5 ? '#4caf50' : health > 0.2 ? '#ff9800' : '#f44336';
}

// =====================================================================
// CRASH!
// =====================================================================
function crash() {
  if (!player.alive) return;
  player.alive = false;
  player.respawnTimer = 2.5;
  planeMesh.visible = false;
  bigBang(player.pos.clone(), 0.6, player.pos.y < 3 ? 0 : null, false);
  flashScreen(0.8, '#ff3300');
  showMessage('💥 BOOM! 💥', 2);
}

// =====================================================================
// UPDATE: this runs about 60 times every second
// =====================================================================
const forward = new THREE.Vector3();
let nearBuilding = false;

function updatePlayer(dt) {
  if (!player.alive) {
    player.respawnTimer -= dt;
    if (player.respawnTimer <= 0) resetPlayer();
    return;
  }

  // Read the keys: +1, 0 or -1
  const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  const climb = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);

  // Turn left and right
  player.yaw += turn * SETTINGS.turnSpeed * dt;

  // Nose up and down. If you let go, the plane slowly flies flat again.
  if (climb !== 0) player.pitch += climb * SETTINGS.climbSpeed * dt;
  else player.pitch -= player.pitch * Math.min(1, dt * 1.5);
  player.pitch = THREE.MathUtils.clamp(player.pitch, -SETTINGS.maxClimbAngle, SETTINGS.maxClimbAngle);

  // Tilt the wings when turning (it just looks cool)
  player.roll += (turn * 0.6 - player.roll) * Math.min(1, dt * 5);

  // Speed up with Shift
  const boosting = keys.ShiftLeft || keys.ShiftRight;
  if (boosting && !player.boosting) sounds.boost();
  player.boosting = boosting;
  const targetSpeed = boosting ? SETTINGS.boostSpeed : SETTINGS.normalSpeed;
  player.speed += (targetSpeed - player.speed) * Math.min(1, dt * (boosting ? 1.5 : 0.8));

  // Point the plane and move it forward
  planeMesh.rotation.set(player.pitch, player.yaw, player.roll);
  forward.set(0, 0, -1).applyQuaternion(planeMesh.quaternion);
  player.pos.addScaledVector(forward, player.speed * dt);

  if (player.pos.y > SETTINGS.maxHeight) {
    player.pos.y = SETTINGS.maxHeight;
    if (player.pitch > 0) player.pitch = 0;
  }

  planeMesh.position.copy(player.pos);
  planeMesh.updateMatrixWorld();
  planeMesh.userData.propeller.rotation.z += dt * 40;

  // Shoot with Space
  player.shootTimer -= dt;
  if (keys.Space && player.shootTimer <= 0) {
    shoot(forward);
    player.shootTimer = SETTINGS.shootDelay;
  }

  // Drop bombs with B
  player.bombTimer -= dt;
  if (keys.KeyB && player.bombTimer <= 0) {
    dropBomb(forward);
    player.bombTimer = SETTINGS.bombDelay;
  }

  // Too far away from the city?
  const edge = world.citySize / 2 + 700;
  if (Math.abs(player.pos.x) > edge || Math.abs(player.pos.z) > edge) {
    showMessage('Turn back! 🏙️', 0.2);
  }

  // Did we crash?
  nearBuilding = !!world.hitsBuilding(player.pos, 12);
  if (player.pos.y < 1.5 || world.hitsBuilding(player.pos, 1.5)) crash();
}

function updateBalloons(time) {
  for (const b of balloons) {
    b.group.position.y = b.baseY + Math.sin(time + b.wobble) * 2;
  }
}

const cameraTarget = new THREE.Vector3();
const behindOffset = new THREE.Vector3();
const lookPoint = new THREE.Vector3();
const lookWanted = new THREE.Vector3();
const lastBlast = new THREE.Vector3();
let blastTimer = 0;
let shake = 0;

function updateCamera(dt) {
  if (cameraMode === 'cockpit' && player.alive) {
    camera.position.set(0, 1.15, 0.1).applyMatrix4(planeMesh.matrixWorld);
    camera.quaternion.copy(planeMesh.quaternion);
  } else {
    // BOMB CAMERA: while my bomb falls (or just exploded), go up high and look down at it
    blastTimer -= dt;
    let watching = null;
    const myBomb = bombs.findLast((b) => b.mine);
    if (myBomb) watching = myBomb.mesh.position;
    else if (blastTimer > 0) watching = lastBlast;

    // Otherwise, float behind and a bit above the plane
    if (watching) behindOffset.set(0, 30, 40);
    else behindOffset.set(0, 5, 18);
    behindOffset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, player.yaw);
    cameraTarget.copy(player.pos).add(behindOffset);
    camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 4));

    lookWanted.copy(player.pos);
    if (watching) lookWanted.lerp(watching, 0.6);
    lookPoint.lerp(lookWanted, 1 - Math.exp(-dt * 6));
    camera.lookAt(lookPoint);
  }
  // Shake the camera after big explosions
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-dt * 4);
  }
}

// The sun's shadow picture moves with the plane. To stop the shadows from shimmering,
// it only moves in tiny steps that match the pixels of the shadow picture.
const sunDirection = SUN_OFFSET.clone().normalize();
const sunRight = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, sunDirection).normalize();
const sunUp = new THREE.Vector3().crossVectors(sunDirection, sunRight);
const shadowPixel = 700 / 2048;
const snap = (n) => Math.round(n / shadowPixel) * shadowPixel;

function updateSun() {
  const p = player.pos;
  sun.target.position.set(0, 0, 0)
    .addScaledVector(sunRight, snap(p.dot(sunRight)))
    .addScaledVector(sunUp, snap(p.dot(sunUp)))
    .addScaledVector(sunDirection, p.dot(sunDirection));
  sun.position.copy(sun.target.position).add(SUN_OFFSET);
}

// Factory chimneys puff out smoke
let smokeTimer = 0;
function updateChimneys(dt) {
  smokeTimer -= dt;
  if (smokeTimer > 0) return;
  smokeTimer = 0.35;
  for (const chimney of world.chimneys) {
    if (chimney.distanceTo(camera.position) < 1200) effects.chimneySmoke(chimney);
  }
}

// =====================================================================
// START SCREEN: type your name, pick a color, and fly!
// =====================================================================
const nameInput = document.getElementById('name');
const colorButtons = document.getElementById('colors');
const flyButton = document.getElementById('fly');
let myColor = PLANE_COLORS[0];

// Remember the name and color for next time
try {
  nameInput.value = localStorage.getItem('skys-name') || '';
  myColor = Number(localStorage.getItem('skys-color')) || myColor;
} catch {}

for (const color of PLANE_COLORS) {
  const button = document.createElement('button');
  button.style.background = hex(color);
  button.classList.toggle('picked', color === myColor);
  button.addEventListener('click', () => {
    myColor = color;
    for (const b of colorButtons.children) b.classList.remove('picked');
    button.classList.add('picked');
    planeMesh.userData.paint.color.setHex(color);
  });
  colorButtons.append(button);
}
planeMesh.userData.paint.color.setHex(myColor);

function startGame() {
  if (started) return;
  const name = nameInput.value.trim() || 'Pilot';
  try {
    localStorage.setItem('skys-name', name);
    localStorage.setItem('skys-color', String(myColor));
  } catch {}
  nameInput.blur();
  document.getElementById('start').hidden = true;
  document.getElementById('hud').hidden = false;
  document.documentElement.requestFullscreen().catch(() => {});
  sounds.init();
  network.send({ type: 'join', name, color: myColor });
  started = true;
  updateScoreboard();
}

flyButton.addEventListener('click', startGame);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });
flyButton.disabled = false;
statusText.textContent = '';
nameInput.focus();

// Put the camera in a nice spot before the game starts
planeMesh.position.copy(player.pos);
planeMesh.updateMatrixWorld();
camera.position.copy(player.pos).add(new THREE.Vector3(-8, 4, -14));
camera.lookAt(player.pos);
lookPoint.copy(player.pos);
updateSun();

// =====================================================================
// THE GAME LOOP
// =====================================================================
const clock = new THREE.Clock();

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (started) {
    updatePlayer(dt);
    sendMyState(dt);
    updateBullets(dt);
    updateBombs(dt);
    updateCamera(dt);
    updateSun();
    updateChimneys(dt);
    updateHud();
    sounds.update(player.speed, player.alive, nearBuilding);

    messageTimer -= dt;
    if (messageTimer <= 0) message.textContent = '';
  }
  updateOthers(dt);
  effects.update(dt);
  updateBalloons(time);
  world.update(dt, camera.position);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

// For testing: lets a test program look inside the game
window.skys = { player, keys, camera, balloons, others, network, world, get me() { return me; } };
