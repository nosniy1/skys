// ✈️ SKYS — the main game file
import * as THREE from 'three';
import { Sounds } from './sounds.js';
import { createWorld, random } from './world.js';
import { makePlane, makeBomb, makeNameTag, makeParachute, makeNuke, makeHuman, animateHuman, PLANE_TYPES } from './plane.js';
import { Effects } from './effects.js';
import { Network } from './network.js';
import { Missiles, MISSILE_DELAY } from './missiles.js';
import { PowerUps, POWERUP_TYPES } from './powerups.js';
import { DayNight } from './daynight.js';
import { Rounds } from './rounds.js';
import { Traffic, Boats, makeCar, driveCar } from './vehicles.js';
import { Scenery } from './scenery.js';
import { Weather, WEATHER_NAMES } from './weather.js';
import { Robots } from './robots.js';
import { Shop } from './shop.js';
import { People } from './people.js';
import { Minimap } from './minimap.js';
import { Police } from './police.js';
import { Robbery } from './robbery.js';
import { Admin } from './admin.js';

// =====================================================================
// SETTINGS — try changing these numbers to change how the game feels!
// (Each plane's speed and turning is in plane.js. Health, points, coins and prices are in server.js.)
// =====================================================================
const SETTINGS = {
  shootDelay: 0.1,      // seconds between each bullet
  bulletSpeed: 300,     // how fast bullets fly
  bombGravity: 30,      // how fast bombs fall
  bombBlastSize: 35,    // how far away a bomb can pop balloons and hurt planes
  maxHeight: 400,       // the highest you can fly
  cityBlocks: 20,       // how many blocks wide the city is
  balloonCount: 40,     // how many balloons to pop
  superSpeed: 1.6,      // how much faster you go with the ⚡ power-up
  parachuteSpeed: 6,    // how fast the parachute falls
  nukeFallSpeed: 9,     // how fast the ☢️ nuke falls
  nukeWait: 60,         // seconds before you can drop another nuke
  superMissileWait: 20, // seconds before you can fire another super missile
  walkSpeed: 4.5,       // how fast you walk
  runSpeed: 10,         // how fast you run (hold Shift)
};

const keys = {};             // which keys are pressed right now
let cameraMode = 'behind';
let started = false;         // did I click "Fly!" yet?

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

const hemisphere = new THREE.HemisphereLight(0xcfe8ff, 0x5b6b4a, 1.4);
scene.add(hemisphere);
// The sun (or the moon at night). It follows you so there are always nice shadows near you.
const sun = new THREE.DirectionalLight(0xfff1dc, 3);
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
} catch (error) {
  statusText.textContent = error.message === 'banned'
    ? '⛔ You are banned from this game.'
    : "😢 Can't connect to the server. Is it running? (npm start)";
  throw new Error('No server');
}

const world = createWorld(scene, renderer, SETTINGS, welcome.seed);
const effects = new Effects(scene);
const sounds = new Sounds();
const dayNight = new DayNight(world, sun, hemisphere, welcome.serverNow, welcome.dayStartedAt);
const weather = new Weather(scene, sounds, hemisphere, welcome.weather);
dayNight.weather = weather;
const rounds = new Rounds(sounds);
rounds.set(welcome.round);
const scenery = new Scenery(scene, world, effects);
const traffic = new Traffic(scene, world);
const boats = new Boats(scene, world.ponds);
const minimap = new Minimap(world);

// PARKED PLANES at the airport: walk up to one and press V to fly it!
const parkedPlanes = [-60, 0, 60].map((z) => {
  const mesh = makePlane(0xb0bec5, 'fighter');
  const spot = new THREE.Vector3(world.airport.x - 45, mesh.userData.groundHeight + 0.22, z);
  mesh.position.copy(spot);
  mesh.rotation.y = -Math.PI / 2;   // pointing toward the runway
  scene.add(mesh);
  return { mesh, spot, gone: 0 };
});
const parkedCars = [];              // cars I got out of (I can get back in!)

// =====================================================================
// ME: my plane, my parachute and my car
// =====================================================================
let myType = 'fighter';
let myColor = PLANE_COLORS[0];
let mySticker = 'none';
let nextPlane = 'fighter';    // the plane I get when I spawn next (press P to change it)
let nextSticker = 'none';
let profile = null;           // my coins, upgrades, planes and stickers (from the server)
let planeMesh = makePlane(myColor, myType);
scene.add(planeMesh);
let myChute = makeParachute(myColor);
let myCar = makeCar(myColor);
let myHuman = makeHuman(myColor);
myChute.visible = myCar.visible = myHuman.visible = false;
scene.add(myChute, myCar, myHuman);

// mode: 'plane' (flying), 'landed', 'parachute', 'walk' (on foot), 'car', 'dead'
const player = {
  mode: 'plane',
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion(), // which way the plane points (it can be upside down!)
  bank: 0,                      // extra wing tilt when turning (it just looks cool)
  speed: 0,
  climb: 0,                     // the helicopter goes up and down with this
  heading: 0,                   // which way the helicopter, parachute or car points
  alive: true,                  // can I be hit right now?
  respawnTimer: 0,
  boosting: false,
  shootTimer: 0,
  bombTimer: 0,
  missileTimer: 0,
  nukeTimer: 0,
  takeOffTimer: 0,              // just took off: don't land again right away
  superTimer: 0,
  tumble: 0,                    // seconds left of being thrown around by the nuke's shock wave
  vy: 0,                        // falling speed when walking off a roof
  walkSpeed: 0,
  powers: { speed: 0, triple: 0, shield: 0 }, // seconds left for each power-up
  car: { pos: new THREE.Vector3(), yaw: 0, speed: 0 },
};

const type = () => PLANE_TYPES[myType];
const upgrade = (name) => (profile ? profile.upgrades[name] : 0);
// Can I be hit right now? (not when I'm hiding inside a building!)
let robbery = null;   // (made later on, see "ROBBING")
const isInside = () => robbery !== null && robbery.isInside;
const hittable = () => player.alive && ['plane', 'landed', 'car', 'walk'].includes(player.mode) && !isInside();
// Where am I on the map? (inside a building, that's in front of its door)
const myPosition = () => (isInside() ? robbery.outside : player.mode === 'car' ? player.car.pos : player.pos);

function showOnly(what) {
  planeMesh.visible = what === 'plane';
  myChute.visible = what === 'chute';
  myCar.visible = what === 'car';
  myHuman.visible = what === 'human';
}

function resetPlayer() {
  // Did I choose a different plane or sticker? I get it now!
  if (nextPlane !== myType || nextSticker !== mySticker) {
    setMyPlane(nextPlane, myColor, nextSticker);
    if (started) network.send({ type: 'changePlane', plane: myType, sticker: mySticker });
  }
  // Start outside the city, at a random spot so two players don't start in the same place
  player.pos.set((Math.random() - 0.5) * 300, 80, world.citySize / 2 + 150);
  player.quat.identity();
  player.heading = 0;
  player.bank = 0;
  player.climb = 0;
  player.speed = type().normalSpeed;
  player.alive = true;
  player.mode = 'plane';
  player.powers = { speed: 0, triple: 0, shield: 0 };
  player.tumble = 0;
  if (isInside()) robbery.kickOut();
  myHuman.rotation.x = 0;
  showOnly('plane');
  if (started) sounds.setEngine(type().engine);
}

// Change my plane (on the start screen, or when I spawn)
function setMyPlane(newType, newColor, newSticker = mySticker) {
  myType = nextPlane = newType;
  myColor = newColor;
  mySticker = nextSticker = newSticker;
  const visible = planeMesh.visible;
  const humanVisible = myHuman.visible;
  scene.remove(planeMesh, myChute, myCar, myHuman);
  planeMesh = makePlane(myColor, myType, mySticker);
  myChute = makeParachute(myColor);
  myCar = makeCar(myColor);
  myHuman = makeHuman(myColor);
  scene.add(planeMesh, myChute, myCar, myHuman);
  myChute.visible = myCar.visible = false;
  myHuman.visible = humanVisible;
  planeMesh.visible = visible;
  planeMesh.position.copy(player.pos);
  planeMesh.quaternion.copy(player.quat);
  planeMesh.updateMatrixWorld();
  for (const part of planeMesh.userData.hideInCockpit) part.visible = cameraMode !== 'cockpit';
}

// Pick a plane or sticker for next time (from the shop or the P menu)
function choosePlane(plane, sticker) {
  nextPlane = plane;
  nextSticker = sticker;
  showMessage(`✈️ ${PLANE_TYPES[plane].name}: next time you spawn!`, 2);
}

resetPlayer();

// =====================================================================
// THE OTHER PLAYERS (and the robots)
// Each one has a "holder" with their plane, parachute and car inside. Only one is shown.
// =====================================================================
const others = new Map();
let playerList = [];        // everybody, with names, colors, scores and health (from the server)
let robotOwner = null;      // which computer moves the robots
let me = null;              // my own entry in playerList

function addOther(info) {
  const holder = new THREE.Group();
  holder.visible = false;
  scene.add(holder);
  const tag = makeNameTag();
  tag.visible = false;
  scene.add(tag);
  const other = {
    info, mesh: holder, tag, plane: null, chute: null, car: null, human: null, look: '', mode: 'plane',
    target: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), speed: 0, boost: false },
    receivedAt: 0, alive: false, hasState: false,
  };
  others.set(info.id, other);
  if (started && !info.robot) showMessage(`👋 ${info.name} joined!`, 2.5);
  return other;
}

// Build (or rebuild) the other player's plane, parachute and car
function dressOther(other) {
  const { info } = other;
  const look = `${info.plane}|${info.sticker}|${info.color}`;
  if (look === other.look) return;
  other.look = look;
  for (const part of [other.plane, other.chute, other.car, other.human]) if (part) other.mesh.remove(part);
  other.plane = makePlane(info.color, info.plane, info.sticker);
  other.chute = makeParachute(info.color);
  other.chute.position.y = 6.9;
  other.car = makeCar(info.color);
  other.human = makeHuman(info.color);
  other.mesh.add(other.plane, other.chute, other.car, other.human);
  showOtherMode(other);
}

function showOtherMode(other) {
  if (!other.plane) return;
  other.plane.visible = other.mode === 'plane' || other.mode === 'landed';
  other.chute.visible = other.mode === 'parachute';
  other.car.visible = other.mode === 'car';
  other.human.visible = other.mode === 'walk';
}

function removeOther(id) {
  const other = others.get(id);
  if (!other) return;
  scene.remove(other.mesh, other.tag);
  others.delete(id);
  if (started && !other.info.robot) showMessage(`👋 ${other.info.name} left`, 2.5);
}

function updatePlayerList(list) {
  playerList = list;
  const oldHealth = me ? me.health : null;
  me = list.find((p) => p.id === network.id) || null;

  for (const info of list) {
    if (info.id === network.id) continue;
    const other = others.get(info.id) || addOther(info);
    other.info = info;
    dressOther(other);
    other.tag.userData.draw(info.name, info.color, info.health, info.maxHealth);
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

// We only hear from the others 20 times per second, so in between we guess
// where they are by moving them forward at their speed. Then we glide there smoothly.
function updateOthers(dt, time) {
  const now = performance.now() / 1000;
  for (const other of others.values()) {
    const showing = other.hasState && (other.alive || other.mode === 'parachute');
    other.mesh.visible = other.tag.visible = showing;
    if (!showing) continue;
    const t = other.target;
    ahead.set(0, 0, -1).applyQuaternion(t.quat);
    guess.copy(t.pos).addScaledVector(ahead, t.speed * Math.min(now - other.receivedAt, 0.3));
    const smooth = 1 - Math.exp(-dt * 15);
    other.mesh.position.lerp(guess, smooth);
    other.mesh.quaternion.slerp(t.quat, smooth);
    if (other.plane) spinPropellers(other.plane, dt, t.boost, time);
    if (other.mode === 'walk' && other.human) animateHuman(other.human, t.speed, time);
    other.tag.position.copy(other.mesh.position);
    other.tag.position.y += other.mode === 'parachute' ? 16 : other.mode === 'walk' ? 3 : 6;
  }
}

function spinPropellers(mesh, dt, boosting, time) {
  for (const propeller of mesh.userData.propellers) propeller.rotation.z += dt * 40;
  for (const rotor of mesh.userData.rotors) rotor.part.rotation[rotor.axis] += dt * 30;
  if (mesh.userData.flame) mesh.userData.flame.scale.set(1, 1, (boosting ? 1.6 : 0.7) + Math.sin(time * 40) * 0.1);
}

function onOtherState(msg) {
  const other = others.get(msg.id);
  if (!other) return;
  const t = other.target;
  t.pos.fromArray(msg.p);
  t.quat.fromArray(msg.q);
  t.speed = msg.speed;
  t.boost = msg.boost;
  if (other.plane) other.plane.userData.shield.visible = !!msg.shield;
  other.receivedAt = performance.now() / 1000;
  const mode = msg.mode || 'plane';
  if ((msg.alive && (!other.alive || !other.hasState)) || mode !== other.mode) {
    // They just appeared, came back, or changed between plane / parachute / car: jump straight there
    other.mesh.position.copy(t.pos);
    other.mesh.quaternion.copy(t.quat);
  }
  if (other.alive && !msg.alive && other.hasState && other.mode !== 'walk') {
    bigBang(other.mesh.position.clone(), 0.6, other.mesh.position.y < 3 ? 0 : null, false);
  }
  other.mode = mode;
  other.alive = msg.alive;
  other.hasState = true;
  showOtherMode(other);
}

// Tell everybody where I am, 20 times per second
let sendTimer = 0;
const round = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const headingQuat = new THREE.Quaternion();
function sendMyState(dt) {
  sendTimer -= dt;
  if (sendTimer > 0) return;
  sendTimer = 0.05;
  let quat = planeMesh.quaternion;
  if (player.mode === 'car') quat = headingQuat.setFromAxisAngle(WORLD_UP, player.car.yaw);
  if (player.mode === 'parachute' || player.mode === 'walk') quat = headingQuat.setFromAxisAngle(WORLD_UP, player.heading);
  const position = myPosition();
  network.send({
    type: 'state', mode: player.mode === 'dead' ? 'plane' : player.mode,
    p: position.toArray().map(round),
    q: quat.toArray().map(round3),
    speed: round(player.mode === 'car' ? player.car.speed : player.mode === 'plane' ? player.speed : player.mode === 'walk' ? player.walkSpeed : 0),
    alive: hittable() || (isInside() && player.alive), boost: player.boosting, shield: player.powers.shield > 0,
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

function popBalloonsNear(position, distance) {
  for (const balloon of balloons) {
    if (balloon.group.position.distanceTo(position) < distance) popBalloon(balloon);
  }
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
const robotBulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff5252 });
let gunSide = 1;

// mine = my bullet. robot = a robot's bullet that MY computer checks.
function addBullet(position, velocity, mine, robot = null) {
  const mesh = new THREE.Mesh(bulletShape, robot ? robotBulletMaterial : bulletMaterial);
  mesh.position.copy(position);
  mesh.lookAt(position.clone().add(velocity));
  scene.add(mesh);
  bullets.push({ mesh, velocity, life: 2, mine, robot });
}

const planeUp = new THREE.Vector3();
function shoot(forward) {
  // Guns on the wings: left, right, left, right...
  const position = new THREE.Vector3(gunSide * 2.2, -0.3, -1.5).applyMatrix4(planeMesh.matrixWorld);
  gunSide = -gunSide;
  // With TRIPLE GUNS, two more bullets go a little to the left and right
  const directions = [forward.clone()];
  if (player.powers.triple > 0) {
    planeUp.set(0, 1, 0).applyQuaternion(planeMesh.quaternion);
    directions.push(forward.clone().applyAxisAngle(planeUp, 0.05), forward.clone().applyAxisAngle(planeUp, -0.05));
  }
  for (const direction of directions) {
    const velocity = direction.multiplyScalar(SETTINGS.bulletSpeed + Math.max(0, player.speed));
    addBullet(position, velocity, true);
    network.send({ type: 'shoot', p: position.toArray().map(round), v: velocity.toArray().map(round) });
  }
  sounds.shoot();
}

// A robot shoots (only on the robot owner's computer)
function robotShoot(id, position, direction) {
  const velocity = direction.clone().multiplyScalar(SETTINGS.bulletSpeed + 45);
  addBullet(position, velocity, false, id);
  network.send({ type: 'shoot', robot: id, p: position.toArray().map(round), v: velocity.toArray().map(round) });
  sounds.shoot(0.5 * Math.max(0, 1 - camera.position.distanceTo(position) / 600));
}

// Where to aim at somebody, and how big they are (a person is much smaller than a plane!)
const centerSpot = new THREE.Vector3();
function hitCenter(mode, position) {
  centerSpot.copy(position);
  if (mode === 'walk' || mode === 'car') centerSpot.y += 1;
  return centerSpot;
}
const hitRadius = (mode, plane) => (mode === 'walk' ? 1.1 : mode === 'car' ? 3 : PLANE_TYPES[plane].hitSize);

// A person in the street (or the police 🚓) shot at me
function npcHitsMe(where, police = false) {
  if (hittable() && where.distanceTo(hitCenter(player.mode, myPosition())) < 4) {
    network.send({ type: 'hit', target: network.id, damage: 1, npc: true, police });
  }
}

// 💵 I got some cash
function giveCash(amount) {
  network.send({ type: 'cash', amount });
  sounds.cash();
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
    if (p.y < 0 || world.hitsBuilding(p, 0) || scenery.hits(p) !== null) {
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
        if (!gone && other.alive && other.hasState &&
            lineHits(before, p, hitCenter(other.mode, other.mesh.position), hitRadius(other.mode, other.info.plane))) {
          network.send({ type: 'hit', target: id, damage: 1 });
          effects.sparks(p);
          sounds.hit(0.6);
          gone = true;
        }
      }
    }
    // Robot bullets: can they hit me, or another player?
    if (b.robot && !gone) {
      if (hittable() && lineHits(before, p, hitCenter(player.mode, myPosition()), hitRadius(player.mode, myType))) {
        network.send({ type: 'hit', target: network.id, damage: 1, robot: b.robot });
        gone = true;
      }
      for (const [id, other] of others) {
        if (!gone && !other.info.robot && other.alive && other.hasState &&
            lineHits(before, p, hitCenter(other.mode, other.mesh.position), hitRadius(other.mode, other.info.plane))) {
          network.send({ type: 'hit', target: id, damage: 1, robot: b.robot });
          gone = true;
        }
      }
    }
    // People in the street get hurt, and my bullets can hit police cars
    if (!gone && (p.y < 4 || before.y < 4) && people.bulletHits(before, p, b.mine)) gone = true;
    if (!gone && b.mine && (p.y < 5 || before.y < 5) && police.bulletHits(before, p)) {
      effects.sparks(p);
      gone = true;
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
  // The bomber drops two bombs side by side
  const sides = type().bombsPerDrop === 2 ? [-1.5, 1.5] : [0];
  for (const side of sides) {
    const position = new THREE.Vector3(side, -1.8, -0.5).applyMatrix4(planeMesh.matrixWorld);
    // The bomb starts with the plane's speed, then gravity pulls it down
    const velocity = forward.clone().multiplyScalar(Math.max(0, player.speed) * 0.9);
    velocity.y -= 4;
    addBomb(position, velocity, true);
    network.send({ type: 'bomb', p: position.toArray().map(round), v: velocity.toArray().map(round) });
  }
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
    const deck = scenery.hits(p);
    const hitBalloon = balloons.some((b) => b.group.visible && b.group.position.distanceTo(p) < 6);
    const hitPlane = [...others.values()].some((o) => o.alive && o.hasState && o.mesh.position.distanceTo(p) < 5);
    if (p.y <= 0 || building || deck !== null || hitBalloon || hitPlane) {
      let surface = null;                              // exploded in the air
      if (deck !== null) {
        p.y = deck;
        surface = deck;                                // hit the ship
      } else if (!building && !hitBalloon && !hitPlane) {
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
// pops balloons, hurts other planes nearby, and damages buildings.
function bigBang(position, size, surface, mine) {
  const inSea = position.x > world.coast.shore && position.y < 3;
  effects.explosion(position, size, inSea ? null : surface);
  if (inSea) {
    effects.splash(position);
    sounds.splash();
  }
  if (mine && size >= 1) {   // the bomb camera keeps watching the explosion for a moment
    lastBlast.copy(position);
    blastTimer = 2;
  }
  const distance = camera.position.distanceTo(position);
  sounds.bigBoom(THREE.MathUtils.clamp(1 - distance / 1500, 0.2, 1) * size);
  shake = Math.max(shake, Math.max(0, 1 - distance / 400) * 4 * size);
  if (distance < 250) flashScreen(0.6 * (1 - distance / 250), '#ffcc66');

  // Cars and boats close by are blown up (on my screen)
  people.blast(position, 15 * size);
  police.blast(position, 14 * size);
  for (const spot of [...traffic.blast(position, 14 * size), ...boats.blast(position, 12 * size)]) {
    effects.burst(spot, 0xff6d00, 15, 25, 0.8, true);
    effects.burst(spot, 0x424242, 10, 20, 1);
  }

  if (mine && size >= 1) {
    popBalloonsNear(position, SETTINGS.bombBlastSize);
    for (const [id, other] of others) {
      if (!other.alive || !other.hasState) continue;
      const d = other.mesh.position.distanceTo(position);
      const damage = d < 15 ? 10 : d < SETTINGS.bombBlastSize ? 4 : 0;
      if (damage > 0) network.send({ type: 'hit', target: id, damage });
    }
    damageBuildings(position, [[15, 2], [SETTINGS.bombBlastSize, 1]]);
    // Careful! If your own bomb explodes too close, you crash too.
    if (hittable() && player.pos.distanceTo(position) < 15 && player.powers.shield <= 0) crash();
  }
}

// =====================================================================
// BUILDINGS FALLING DOWN 🏚️
// =====================================================================
// rules: [[distance, damage], ...] — closer buildings get more damage
function damageBuildings(position, rules) {
  const biggest = rules[rules.length - 1][0];
  const hits = [];
  for (const { id, distance, maxHealth } of world.structuresNear(position, biggest)) {
    const rule = rules.find(([d]) => distance < d);
    if (rule) hits.push({ id, amount: rule[1], maxHealth });
  }
  if (hits.length) network.send({ type: 'damage', hits });
}

function onBuildingDestroyed(msg, instantly = false) {
  const s = world.destroy(msg.building, instantly);
  if (!s || instantly) return;
  effects.dust(s.x, s.z, Math.max(s.width, s.depth), s.top);
  const distance = camera.position.distanceTo(new THREE.Vector3(s.x, s.top / 2, s.z));
  sounds.rumble(THREE.MathUtils.clamp(1 - distance / 1200, 0, 1) * Math.min(1, s.top / 40 + 0.3));
  shake = Math.max(shake, Math.max(0, 1 - distance / 300) * 2);
  if (msg.by === network.id && s.top > 60) showMessage('🏚️ TIMBER!', 1.5);
}

// =====================================================================
// ☢️ THE NUKE (secret key: N)
// =====================================================================
const nukes = [];
const nukeWarning = document.getElementById('nukewarning');
const collapseQueue = [];    // buildings waiting for the shock wave to reach them

function addNuke(position, drift, mine, id) {
  const mesh = makeNuke();
  mesh.position.copy(position);
  scene.add(mesh);
  nukes.push({ mesh, drift, mine, id, landedTimer: 0 });
  sounds.siren(Math.max(3, position.y / SETTINGS.nukeFallSpeed + 1));
  nukeWarning.hidden = false;
}

function dropNuke(forward) {
  const position = player.pos.clone();
  position.y += 12;   // the parachute opens above the bomb (the bomb hangs 16 meters under it)
  const drift = new THREE.Vector3(forward.x, 0, forward.z).normalize().multiplyScalar(6);
  addNuke(position, drift, true, network.id);
  network.send({ type: 'nuke', p: position.toArray().map(round), d: drift.toArray().map(round) });
  showMessage('☢️ NUKE AWAY! GET OUT OF THERE! ☢️', 3);
}

function updateNukes(dt, time) {
  for (let i = nukes.length - 1; i >= 0; i--) {
    const n = nukes[i];
    const p = n.mesh.position;
    const bottom = new THREE.Vector3(p.x, p.y - 16.5, p.z);
    const building = world.hitsBuilding(bottom, 0);
    const floor = building ? building.height : 0;
    if (bottom.y > floor) {
      p.y -= SETTINGS.nukeFallSpeed * dt;
      p.addScaledVector(n.drift, dt);
      n.mesh.rotation.z = Math.sin(time * 1.3) * 0.08;
    } else if (n.mine) {
      nukes.splice(i, 1);
      scene.remove(n.mesh);
      network.send({ type: 'nukeBoom', p: bottom.toArray().map(round) });
      nukeBoom(bottom);
    } else {
      n.landedTimer += dt;   // wait for the owner's computer to say BOOM
      if (n.landedTimer > 6) { nukes.splice(i, 1); scene.remove(n.mesh); }
    }
  }
  nukeWarning.hidden = nukes.length === 0;
}

function nukeBoom(position) {
  for (const n of nukes) scene.remove(n.mesh);
  nukes.length = 0;
  nukeWarning.hidden = true;
  sounds.stopSiren();
  sounds.nukeBoom();
  effects.nuke(position);
  flashScreen(1, '#ffffff', 7);
  shake = 30;
  dustCount = 0;
  dayNight.nukeGlow = 1;              // the sky burns red and orange
  showMessage('☢️☢️☢️ KA-BOOOOOOOOM!!! ☢️☢️☢️', 6);
  // EMP: the screen goes crazy
  document.getElementById('emp').hidden = false;
  document.body.classList.add('emp');
  setTimeout(() => {
    document.getElementById('emp').hidden = true;
    document.body.classList.remove('emp');
  }, 5000);
  // The shock wave throws my plane around (if I'm the one who dropped it, I survive... just!)
  if (player.mode === 'plane') player.tumble = 3.5;
  people.wipe();
  police.blast(position, 1e6);
  scenery.doom();
  for (const pp of parkedPlanes) { pp.gone = 1e9; pp.mesh.visible = false; }
  for (const c of parkedCars) scene.remove(c.mesh);
  parkedCars.length = 0;
  // Fires burning all over the city
  setTimeout(() => {
    const spots = world.structures.filter((s) => s.top > 15);
    for (let i = 0; i < 30 && spots.length; i++) {
      const s = spots[Math.floor(Math.random() * spots.length)];
      effects.startFire(new THREE.Vector3(s.x, 2, s.z), 35 + Math.random() * 25);
    }
  }, 2500);
  setTimeout(() => minimap.refresh(), 8000);
  // The shock wave knocks down EVERYTHING, starting close and going outward
  const now = performance.now() / 1000;
  for (const s of world.structures) {
    if (s.destroyed) continue;
    const distance = Math.hypot(s.x - position.x, s.z - position.z);
    collapseQueue.push({ id: s.id, at: now + distance / 600, big: s.top > 60 });
  }
  collapseQueue.sort((a, b) => a.at - b.at);
  for (const spot of [...traffic.blast(position, 1e6), ...boats.blast(position, 1e6)]) {
    if (spot.distanceTo(position) < 600) effects.burst(spot, 0xff6d00, 6, 20, 0.8, true);
  }
  scenery.sinkShip();
}

let dustCount = 0;
function updateCollapses() {
  const now = performance.now() / 1000;
  while (collapseQueue.length && collapseQueue[0].at <= now) {
    const { id, big } = collapseQueue.shift();
    const s = world.destroy(id, false, big);
    if (s && big && dustCount++ < 50) effects.dust(s.x, s.z, Math.max(s.width, s.depth), s.top);
  }
}

// =====================================================================
// MISSILES 🚀, POWER-UPS 🎁, ROBOTS 👾, SHOP 🛒
// The "game" object lets those files talk to the rest of the game.
// =====================================================================
const game = {
  scene, camera, world, effects, sounds, network, player, others, traffic,
  get myType() { return myType; },
  get playerList() { return playerList; },
  get robotOwner() { return robotOwner; },
  get profile() { return profile; },
  get nextPlane() { return nextPlane; },
  get nextSticker() { return nextSticker; },
  iCanBeHit: hittable,
  bigBang, damageBuildings, popBalloonsNear, showMissileWarning, applyPowerUp, onOtherState, robotShoot, choosePlane, npcHitsMe,
  giveCash, showMessage, flashScreen, weather, dropCash: (position, amount) => robbery.drop(position, amount),
  get isInside() { return isInside(); },
  get robberyOutside() { return robbery.outside; },
  get police() { return police; },
};
const missiles = new Missiles(game);
const powerUps = new PowerUps(game, random, welcome.powerUps);
const robots = new Robots(game);
const shop = new Shop(game, welcome.shop);
const people = new People(scene, world, game);
const police = new Police(game);
robbery = new Robbery(game);
const admin = new Admin(game, welcome.admin);   // 👑 only true on the computer that runs the server

// Buildings that were already destroyed before I joined
for (const building of welcome.destroyed) onBuildingDestroyed({ building }, true);
if (welcome.nuked) {
  for (const s of world.structures) world.destroy(s.id, true, false);
  people.wipe();
  minimap.refresh();
}

function applyPowerUp(kind) {
  const power = POWERUP_TYPES[kind];
  if (!power) return;
  if (power.seconds > 0) player.powers[kind] = power.seconds;
  showMessage(power.message, 2);
  sounds.powerUp();
  flashScreen(0.3, power.color);
}

const warning = document.getElementById('warning');
function showMissileWarning(show, superMissile) {
  warning.hidden = !show || !hittable();
  warning.textContent = superMissile ? "☠️ SUPER MISSILE! YOU CAN'T ESCAPE! ☠️" : '🚀 MISSILE! TURN! 🚀';
}

// =====================================================================
// MESSAGES FROM THE SERVER
// =====================================================================
const nameOf = (id) => (playerList.find((p) => p.id === id) || { name: 'Someone' }).name;

network.onMessage = (msg) => {
  switch (msg.type) {
    case 'players':
      robotOwner = msg.robotOwner;
      updatePlayerList(msg.players);
      admin.render();
      break;
    case 'adminResult': admin.write(msg.text); break;
    case 'gift': showMessage(msg.text, 3); sounds.powerUp(); break;
    case 'time': dayNight.dayStartedAt = msg.dayStartedAt; break;
    case 'kicked':
      kickedText = '👢 The boss kicked you out of the game!';
      break;
    case 'banned':
      kickedText = '⛔ You are banned from this game.';
      statusText.textContent = kickedText;
      break;
    case 'profile':
      profile = msg.profile;
      updateStartScreen();
      shop.render();
      break;
    case 'shopResult':
      if (msg.ok) { sounds.powerUp(); showMessage('✅ Bought!', 1.5); }
      else showMessage('🪙 Not enough coins!', 1.5);
      break;
    case 'state': onOtherState(msg); break;
    case 'left': removeOther(msg.id); break;
    case 'balloon': onBalloonMoved(msg); break;
    case 'powerup': powerUps.onMessage(msg); break;
    case 'missile': missiles.onRemoteMissile(msg); break;
    case 'missileBoom': missiles.onRemoteBoom(msg); break;
    case 'destroyed': onBuildingDestroyed(msg); break;
    case 'weather':
      weather.set(msg.weather);
      if (started) showMessage(WEATHER_NAMES[msg.weather], 2);
      break;
    case 'nuke':
      addNuke(new THREE.Vector3().fromArray(msg.p), new THREE.Vector3().fromArray(msg.d), false, msg.id);
      if (started) showMessage(`☢️ ${nameOf(msg.id)} DROPPED A NUKE! ☢️`, 3);
      break;
    case 'nukeBoom':
      nukeBoom(new THREE.Vector3().fromArray(msg.p));
      break;
    case 'honk': {
      const where = new THREE.Vector3().fromArray(msg.p);
      sounds.horn(Math.max(0, 1 - camera.position.distanceTo(where) / 400));
      break;
    }
    case 'shoot': {
      const position = new THREE.Vector3().fromArray(msg.p);
      addBullet(position, new THREE.Vector3().fromArray(msg.v), false);
      sounds.shoot(0.6 * Math.max(0, 1 - camera.position.distanceTo(position) / 600));
      break;
    }
    case 'bomb':
      addBomb(new THREE.Vector3().fromArray(msg.p), new THREE.Vector3().fromArray(msg.v), false);
      break;
    case 'killed': {
      const robotVictim = typeof msg.victim === 'string';
      if (robotVictim) robots.onKilled(msg.victim);
      if (msg.victim === network.id) {
        crash();
        if (msg.how === 'nuke') showMessage(`☢️ NUKED by ${nameOf(msg.killer)}!`, 3);
        else if (msg.how === 'police') showMessage('🚓 BUSTED! The police got you! (-20% 💵)', 3);
        else if (msg.how === 'boss') showMessage('👑 The boss knocked you out!', 3);
        else showMessage(msg.killer === null ? '💥 A robot shot you down!' : `💥 ${nameOf(msg.killer)} shot you down!`, 2.5);
      } else if (msg.killer === network.id && msg.how !== 'nuke') {
        showMessage(robotVictim ? '🎯 Robot down! +2 (🪙 +3)' : `🎯 You shot down ${nameOf(msg.victim)}! +5 (🪙 +10)`, 2.5);
      }
      break;
    }
    case 'round':
      rounds.set(msg.round);
      break;
    case 'roundOver':
      rounds.set(msg.round);
      if (started) rounds.showWinner(msg.ranking, network.id);
      break;
    case 'newRound':
      rounds.set(msg.round);
      rounds.hideWinner();
      world.restoreAll();
      effects.clearScorches();
      missiles.clear();
      collapseQueue.length = 0;
      scenery.unDoom();
      people.bringBack();
      dayNight.nukeGlow = 0;
      police.clear();
      robbery.reset();
      for (const pp of parkedPlanes) pp.gone = 0;
      setTimeout(() => minimap.refresh(), 100);
      if (started) {
        resetPlayer();
        showMessage('GO! ✈️', 1.5);
        sounds.beep(1320, 0.4, 0.3);
      }
      break;
  }
};

let kickedText = null;
network.onClose = () => showMessage(kickedText || '😢 Lost connection to the server. Reload the page!', 1e9);

// =====================================================================
// KEYBOARD
// =====================================================================
addEventListener('keydown', (e) => {
  if (!started) return;        // while typing your name, keys don't fly the plane
  // 👑 the boss panel: the key left of 1 (it has different names on different keyboards), or F2
  if (['Backquote', 'IntlBackslash', 'F2'].includes(e.code) || e.key === '`' || e.key === '²') {
    e.preventDefault();
    admin.toggle();
    return;
  }
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  const atAirport = inArea(player.pos, world.airport.area);
  switch (e.code) {
    case 'KeyC':
      cameraMode = cameraMode === 'behind' ? 'cockpit' : 'behind';
      document.getElementById('crosshair').hidden = cameraMode !== 'cockpit';
      for (const part of planeMesh.userData.hideInCockpit) part.visible = cameraMode !== 'cockpit';
      break;
    case 'KeyM': sounds.toggleMusic(); break;
    case 'KeyH': {
      const box = document.getElementById('controls');
      box.hidden = !box.hidden;
      break;
    }
    case 'KeyF': toggleFullscreen(); break;
    case 'Escape': shop.close(); break;
    case 'KeyP':
      if (shop.isOpen) shop.close();
      else shop.open(player.mode === 'landed' && atAirport);
      break;
    case 'KeyT':
      if (shop.isOpen) shop.close();
      else if (player.mode === 'landed' && atAirport) shop.open(true);
      else showMessage('🛬 Land at the airport to open the shop!', 1.5);
      break;
    case 'KeyV':   // get in or out of things
      if (player.mode === 'car') leaveCar();
      else if (player.mode === 'walk' && !isInside()) tryGetIn();
      else if (player.mode === 'landed' && player.speed < 6) getOut(player.pos, Math.atan2(-forward.x, -forward.z), 6);
      break;
    case 'KeyE':   // on foot: rob the building I'm standing next to
      if (player.mode === 'walk') robbery.start();
      break;
    case 'KeyG':   // on foot: a car appears right next to me!
      if (player.mode === 'walk' && player.pos.y < 2 && !isInside()) {
        const ahead = new THREE.Vector3(-Math.sin(player.heading), 0, -Math.cos(player.heading)).multiplyScalar(4);
        const colors = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xffffff, 0x212121, 0xfb8c00, 0x8e24aa];
        enterCar(colors[Math.floor(Math.random() * colors.length)], player.pos.clone().add(ahead), player.heading);
        effects.burst(player.car.pos.clone().setY(1), 0xffffff, 12, 8, 0.5, true);
        sounds.powerUp();
      }
      break;
    case 'KeyX':   // on foot: give up and get a new plane
      if (player.mode === 'walk') resetPlayer();
      break;
    case 'KeyK':   // 🤫 the secret super missile
      if (player.mode === 'plane' && player.superTimer <= 0) {
        player.superTimer = SETTINGS.superMissileWait;
        missiles.fire(new THREE.Vector3(0, -1, -3).applyMatrix4(planeMesh.matrixWorld), forward, true);
        showMessage('☠️ SUPER MISSILE! ☠️', 2);
      }
      break;
    case 'KeyN':   // 🤫 the secret nuke
      if (player.mode === 'plane' && player.nukeTimer <= 0) {
        player.nukeTimer = SETTINGS.nukeWait;
        dropNuke(forward);
      }
      break;
    case 'Space':
      if (player.mode === 'parachute') resetPlayer();
      if (player.mode === 'car') {
        sounds.horn();
        network.send({ type: 'honk', p: player.car.pos.toArray().map(round) });
      }
      break;
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
// Tell the server when my game window is hidden (then another computer moves the robots)
document.addEventListener('visibilitychange', () => {
  if (started) network.send({ type: 'visible', on: !document.hidden });
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

const inArea = (p, a) => p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ;
const inSea = (p) => p.x > world.coast.shore;

// =====================================================================
// SCREEN MESSAGES, SCORES AND HEALTH
// =====================================================================
const hudText = document.getElementById('hudtext');
const hudExtra = document.getElementById('hudextra');
const healthFill = document.querySelector('#healthbar div');
const scoreboard = document.getElementById('scoreboard');
const weatherText = document.getElementById('weather');
const wantedText = document.getElementById('wanted');
const tip = document.getElementById('tip');
const message = document.getElementById('message');
const flash = document.getElementById('flash');
let messageTimer = 0;

function showMessage(text, seconds) {
  message.textContent = text;
  messageTimer = seconds;
}

function flashScreen(strength, color, seconds = 0.8) {
  flash.style.transition = 'none';
  flash.style.background = color;
  flash.style.opacity = strength;
  requestAnimationFrame(() => {
    flash.style.transition = `opacity ${seconds}s`;
    flash.style.opacity = 0;
  });
}

const hex = (color) => '#' + color.toString(16).padStart(6, '0');
const safe = (text) => text.replace(/[<>&"]/g, '');

function updateScoreboard() {
  scoreboard.innerHTML = playerList.filter((p) => !p.robot)
    .sort((a, b) => b.score - a.score)
    .map((p) => `<span class="${p.id === network.id ? 'me' : ''}"><span style="color:${hex(p.color)}">●</span> ${safe(p.name)}: ${p.score}</span>`)
    .join('');
}

const TIPS = {
  landed: '🛬 T = shop · V = get out 🚶 · hold Shift + W = take off',
  heliLanded: '🚁 Q = take off · V = get out 🚶 · T = shop (at the airport)',
  parachute: '🪂 W/A/S/D = steer · SPACE = new plane',
  walk: '🚶 WASD walk · Shift run · SPACE shoot · V get in 🚗/🛩️ · G new car · E open a door 🚪 · X new plane',
  car: '🚙 W/S = drive · A/D = steer · Shift = turbo · SPACE = honk · V = get out 🚶',
};

let hudTimer = 0;
function updateHud(dt) {
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.1;
  const speed = player.mode === 'car' ? player.car.speed : player.mode === 'walk' ? player.walkSpeed : player.speed;
  hudText.innerHTML =
    `💨 Speed: ${Math.round(Math.abs(speed) * 3)} km/h<br>` +
    `⬆️ Height: ${Math.max(0, Math.round(player.pos.y))} m`;
  const health = me ? me.health / me.maxHealth : 1;
  healthFill.style.width = `${health * 100}%`;
  healthFill.style.background = health > 0.5 ? '#4caf50' : health > 0.2 ? '#ff9800' : '#f44336';

  // Coins, missile ready? Locked on? Power-ups?
  const lines = [`🪙 ${profile ? profile.coins : 0} coins &nbsp; 💵 $${profile ? (profile.cash || 0).toLocaleString() : 0}`];
  if (player.missileTimer > 0) lines.push(`🚀 Missile in ${Math.ceil(player.missileTimer)}s`);
  else {
    const target = missiles.findTarget(player.pos, forward);
    lines.push(target !== null ? `🚀 <span style="color:#ff5252">LOCKED on ${safe(nameOf(target))}!</span> Press R` : '🚀 Missile ready (R)');
  }
  for (const [kind, seconds] of Object.entries(player.powers)) {
    if (seconds > 0) lines.push(`${POWERUP_TYPES[kind].icon} ${Math.ceil(seconds)}s`);
  }
  if (nextPlane !== myType || nextSticker !== mySticker) lines.push(`✈️ Next: ${PLANE_TYPES[nextPlane].name}`);
  hudExtra.innerHTML = lines.join('<br>');

  weatherText.textContent = WEATHER_NAMES[weather.kind] || '';
  tip.textContent = robbery.tip() || (player.mode === 'landed' ? (type().helicopter ? TIPS.heliLanded : TIPS.landed) : TIPS[player.mode] || '');
  wantedText.hidden = police.wanted === 0;
  wantedText.textContent = '🚓 ' + '★'.repeat(police.wanted) + '☆'.repeat(5 - police.wanted);
}

// =====================================================================
// CRASH! (and the parachute 🪂)
// =====================================================================
function crash() {
  if (!['plane', 'landed', 'car', 'walk'].includes(player.mode)) return;
  police.clear();          // the police go home when you get knocked out
  robbery.kickOut();
  if (player.mode === 'walk') {
    // Knocked out! Lie down for a moment, then get a new plane
    player.alive = false;
    player.mode = 'dead';
    player.respawnTimer = 3;
    myHuman.rotation.x = -Math.PI / 2;
    flashScreen(0.6, '#ff0000');
    showMessage('😵 You got knocked out!', 2.5);
    return;
  }
  const wasFlying = player.mode === 'plane';
  bigBang(player.pos.clone(), 0.6, player.pos.y < 3 ? 0 : null, false);
  player.alive = false;
  flashScreen(0.8, '#ff3300');
  showMessage('💥 BOOM! 💥', 2);
  if (wasFlying && player.pos.y > 25) {
    // Jump out with the parachute!
    player.mode = 'parachute';
    player.speed = 0;
    player.heading = Math.atan2(-forward.x, -forward.z);
    player.pos.y += 2;
    showOnly('chute');
    myChute.userData.canopy.visible = true;
    sounds.setEngine('none');
  } else {
    player.mode = 'dead';
    player.speed = 0;
    player.respawnTimer = 2.5;
    showOnly('nothing');
  }
}

function floatDown(dt, time) {
  const steer = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  const move = ((keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0)) * 8;
  player.heading += steer * 1.5 * dt;
  player.pos.x -= Math.sin(player.heading) * move * dt;
  player.pos.z -= Math.cos(player.heading) * move * dt;
  player.pos.y -= SETTINGS.parachuteSpeed * dt;
  myChute.position.set(player.pos.x, player.pos.y + 6.9, player.pos.z);
  myChute.rotation.set(Math.sin(time * 1.5) * 0.08, player.heading, Math.sin(time) * 0.1);

  // Did I land? (on the ground, on a roof, on the ship, or in the sea)
  const building = world.hitsBuilding(player.pos, 0);
  const deck = scenery.hits(player.pos);
  const floor = deck ?? (building ? building.height : 0.25);
  if (player.pos.y > floor) return;
  player.pos.y = floor;
  player.mode = 'walk';
  player.vy = 0;
  showOnly('human');
  myHuman.position.copy(player.pos);
  if (inSea(player.pos) && deck === null) {
    effects.splash(player.pos);
    sounds.splash();
    showMessage('💦 SPLASH! Swim to the beach!', 2.5);
  } else if (inArea(player.pos, world.airport.area)) {
    network.send({ type: 'coin', amount: 2 });
    sounds.coin();
    showMessage('🪂 Perfect landing at the airport! +2 🪙', 2.5);
  } else {
    showMessage('🪂 Landed! Steal a car 🚗 or walk to the airport 🛩️', 2.5);
  }
}

// =====================================================================
// THE CAR 🚙
// =====================================================================
function enterCar(color, position, yaw) {
  scene.remove(myCar);
  myCar = makeCar(color);
  scene.add(myCar);
  player.car.pos.copy(position).setY(0.2);
  player.car.yaw = yaw;
  player.car.speed = 0;
  player.mode = 'car';
  player.alive = true;
  showOnly('car');
  sounds.setEngine('car');
}

function leaveCar() {
  // The car stays parked here, so I can get back in later
  parkedCars.push({ mesh: myCar, color: myCar.userData.color });
  myCar = makeCar(myColor);
  myCar.visible = false;
  scene.add(myCar);
  getOut(player.car.pos, player.car.yaw, 2.8);
}

// Step out of a car or plane, and walk!
function getOut(position, heading, sideways) {
  const side = new THREE.Vector3(-1, 0, 0).applyAxisAngle(WORLD_UP, heading).multiplyScalar(sideways);
  player.pos.copy(position).add(side);
  player.pos.y = floorUnder(player.pos.x, player.pos.y + 1, player.pos.z);
  player.heading = heading;
  player.mode = 'walk';
  player.alive = true;
  player.vy = 0;
  player.speed = 0;
  showOnly('human');
  sounds.setEngine('none');
}

// Press V when walking: get into a parked plane, my parked car, or steal a car!
function tryGetIn() {
  const p = player.pos;
  const plane = parkedPlanes.find((pp) => pp.gone <= 0 && pp.spot.distanceTo(p) < 10);
  if (plane) return boardPlane(plane);
  const mine = parkedCars.findIndex((c) => c.mesh.position.distanceTo(p) < 4.5);
  if (mine >= 0) {
    const [car] = parkedCars.splice(mine, 1);
    scene.remove(car.mesh);
    return enterCar(car.color, car.mesh.position, car.mesh.rotation.y);
  }
  const stolen = traffic.stealNear(p, 6);
  if (stolen) {
    showMessage('🚗 You stole a car! Vroom!', 1.5);
    return enterCar(stolen.color, stolen.position, stolen.yaw);
  }
  showMessage('Walk right next to a car 🚗 or a parked plane 🛩️, then press V', 2);
}

function boardPlane(parked) {
  parked.gone = 30;               // a new plane is parked there after 30 seconds
  parked.mesh.visible = false;
  if (nextPlane !== myType || nextSticker !== mySticker) {
    setMyPlane(nextPlane, myColor, nextSticker);
    network.send({ type: 'changePlane', plane: myType, sticker: mySticker });
  }
  player.mode = 'landed';
  player.pos.copy(parked.spot).setY(planeMesh.userData.groundHeight + 0.25);
  player.quat.setFromAxisAngle(WORLD_UP, -Math.PI / 2);
  player.heading = -Math.PI / 2;
  player.speed = 0;
  player.bank = 0;
  player.alive = true;
  showOnly('plane');
  sounds.setEngine(type().engine);
  showMessage('🛩️ Drive to the runway, then hold Shift + W to take off!', 3);
}

// How high is the floor under me? (the ground, a roof, or the ship's deck)
const probe = new THREE.Vector3();
function floorUnder(x, y, z) {
  probe.set(x, y - 0.6, z);
  const building = world.hitsBuilding(probe, 0);
  const deck = scenery.hits(probe);
  return Math.max(deck ?? 0, building ? building.height : 0, 0.3);
}

// WALKING: W/S = forward/back, A/D = turn, Shift = run, Space = shoot
let carBumpTimer = 0;
function walk(dt, time) {
  const go = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  const running = keys.ShiftLeft || keys.ShiftRight;
  player.heading += turn * 2.4 * dt;
  const speed = go * (running ? SETTINGS.runSpeed : SETTINGS.walkSpeed) * (go < 0 ? 0.5 : 1) * (isInside() ? 0.6 : 1);
  player.walkSpeed = speed;
  const nx = player.pos.x - Math.sin(player.heading) * speed * dt;
  const nz = player.pos.z - Math.cos(player.heading) * speed * dt;
  if (isInside()) {
    // Inside a building: the walls of the room keep me in
    player.pos.x = nx;
    player.pos.z = nz;
    robbery.inside.keepInside(player.pos);
  } else {
    if (!world.hitsBuilding(probe.set(nx, player.pos.y + 1, nz), 0.4)) {   // walls stop me
      player.pos.x = nx;
      player.pos.z = nz;
    }
    // Fall down when I walk off a roof
    const floor = floorUnder(player.pos.x, player.pos.y, player.pos.z);
    if (player.pos.y > floor + 0.01) {
      player.vy -= 25 * dt;
      player.pos.y = Math.max(floor, player.pos.y + player.vy * dt);
    } else {
      player.pos.y = floor;
      player.vy = 0;
    }
  }
  myHuman.position.copy(player.pos);
  myHuman.rotation.set(0, player.heading, 0);
  animateHuman(myHuman, speed, time);

  // Shoot my blaster
  player.shootTimer -= dt;
  if (keys.Space && player.shootTimer <= 0) {
    player.shootTimer = 0.18;
    const direction = new THREE.Vector3(-Math.sin(player.heading), 0, -Math.cos(player.heading));
    const position = player.pos.clone().add(new THREE.Vector3(0, 1.35, 0)).addScaledVector(direction, 0.9);
    const velocity = direction.multiplyScalar(220);
    addBullet(position, velocity, true);
    network.send({ type: 'shoot', p: position.toArray().map(round), v: velocity.toArray().map(round) });
    sounds.shoot(0.6);
    people.scare(player.pos, 30);
  }

  // Watch out for cars!
  carBumpTimer -= dt;
  if (!isInside() && carBumpTimer <= 0 && player.pos.y < 1 && traffic.carAt(player.pos, 2.2)) {
    carBumpTimer = 1;
    network.send({ type: 'hit', target: network.id, damage: 3, npc: true });
    showMessage('🚗 Ouch! Watch out for cars!', 1.2);
  }
}

function updateCar(dt) {
  const bonk = driveCar(player.car, keys, dt, world);
  if (bonk && Math.abs(player.car.speed) > 3) sounds.hit(0.3);
  player.pos.set(player.car.pos.x, 1, player.car.pos.z);
  myCar.position.copy(player.car.pos);
  myCar.rotation.set(0, player.car.yaw, 0);
}

// =====================================================================
// FLYING: this runs about 60 times every second
// =====================================================================
const forward = new THREE.Vector3(0, 0, -1);
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const turnQuat = new THREE.Quaternion();
const bankQuat = new THREE.Quaternion();
const heliEuler = new THREE.Euler(0, 0, 0, 'YXZ');
let nearBuilding = false;

// Turn the plane around one of its own axes (X = nose up/down, Z = roll)
function rotatePlane(axis, angle) {
  turnQuat.setFromAxisAngle(axis, angle);
  player.quat.multiply(turnQuat);
}

const engineBoost = () => (1 + 0.1 * upgrade('engine')) * (player.powers.speed > 0 ? SETTINGS.superSpeed : 1);

function flyPlane(dt) {
  const T = type();
  // Thrown around by the nuke's shock wave!
  if (player.tumble > 0) {
    player.tumble -= dt;
    rotatePlane(AXIS_Z, 6 * dt);
    rotatePlane(AXIS_X, Math.sin(player.tumble * 7) * 3 * dt);
  }
  // Read the keys: +1, 0 or -1
  const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  const climb = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const roll = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0);

  // Nose up/down (keep holding W for a loop!) and barrel rolls
  rotatePlane(AXIS_X, climb * T.pitchSpeed * dt);
  rotatePlane(AXIS_Z, roll * T.rollSpeed * dt);
  // Turning left and right always turns around the sky's "up", so it stays easy
  turnQuat.setFromAxisAngle(WORLD_UP, turn * T.turnSpeed * dt);
  player.quat.premultiply(turnQuat).normalize();

  // HELPER: when you let go of the keys, the plane slowly turns the right way up and flies flat
  forward.set(0, 0, -1).applyQuaternion(player.quat);
  right.set(1, 0, 0).applyQuaternion(player.quat);
  up.set(0, 1, 0).applyQuaternion(player.quat);
  const wingTilt = Math.atan2(right.y, up.y);         // 0 = wings flat, π = upside down
  const steep = 1 - Math.abs(forward.y);              // 0 = pointing straight up or down
  if (climb === 0 && roll === 0) {
    rotatePlane(AXIS_Z, -wingTilt * Math.min(1, dt * 2.5) * steep);
    if (Math.abs(wingTilt) < 0.5) rotatePlane(AXIS_X, -Math.asin(forward.y) * Math.min(1, dt * 1.2));
  }

  // Tilt the wings when turning (only for looks)
  player.bank += (turn * 0.6 - player.bank) * Math.min(1, dt * 5);

  // Speed up with Shift (and even more with upgrades and ⚡ super speed)
  const boosting = keys.ShiftLeft || keys.ShiftRight;
  if (boosting && !player.boosting) sounds.boost();
  player.boosting = boosting;
  const targetSpeed = (boosting ? T.boostSpeed : T.normalSpeed) * engineBoost();
  player.speed += (targetSpeed - player.speed) * Math.min(1, dt * (boosting ? 1.5 : 0.8));

  // Move forward
  forward.set(0, 0, -1).applyQuaternion(player.quat);
  player.pos.addScaledVector(forward, player.speed * dt);
  if (player.pos.y > SETTINGS.maxHeight) player.pos.y = SETTINGS.maxHeight;

  // Landing on the runway? (low, wings flat, nose not pointing down too much)
  const runway = world.airport;
  const onRunway = Math.abs(player.pos.x - runway.x) < runway.width / 2 + 6 && Math.abs(player.pos.z - runway.z) < runway.length / 2 + 20;
  player.takeOffTimer -= dt;
  if (onRunway && player.takeOffTimer <= 0 && player.pos.y < planeMesh.userData.groundHeight + 4 && forward.y > -0.35 && Math.abs(wingTilt) < 0.5) {
    land();
  }
}

function land() {
  player.mode = 'landed';
  const heading = Math.atan2(-forward.x, -forward.z);
  player.quat.setFromAxisAngle(WORLD_UP, heading);
  player.heading = heading;
  player.bank = 0;
  player.climb = 0;
  player.pos.y = planeMesh.userData.groundHeight + 0.25;
  if (inArea(player.pos, world.airport.area)) {
    network.send({ type: 'repair' });
    player.missileTimer = 0;
    showMessage('🛬 Landed! Plane repaired! 🔧', 2);
    sounds.powerUp();
  } else {
    showMessage('🚁 Landed!', 1.2);
  }
}

// On the ground: roll along the runway (or the helicopter just sits there)
function taxi(dt) {
  const T = type();
  if (T.helicopter) {
    player.speed = 0;
    if (keys.KeyQ) { player.mode = 'plane'; player.climb = 6; player.pos.y += 0.5; }
    return;
  }
  const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  turnQuat.setFromAxisAngle(WORLD_UP, turn * 0.9 * dt);
  player.quat.premultiply(turnQuat);
  const gas = keys.ShiftLeft || keys.ShiftRight;
  if (gas) player.speed = Math.min(T.normalSpeed * engineBoost(), player.speed + 14 * dt);
  else if (keys.KeyS) player.speed = Math.max(0, player.speed - 30 * dt);
  else player.speed = Math.max(0, player.speed - 5 * dt);
  forward.set(0, 0, -1).applyQuaternion(player.quat);
  player.pos.addScaledVector(forward, player.speed * dt);
  player.pos.y = planeMesh.userData.groundHeight + 0.25;
  // Take off: fast enough + W
  if (keys.KeyW && player.speed > T.normalSpeed * 0.6) {
    player.mode = 'plane';
    player.takeOffTimer = 3;
    rotatePlane(AXIS_X, 0.2);
    player.pos.y += 1;
  }
}

// The helicopter: W/S = forward/back, A/D = turn, Q/E = up/down. It can stand still in the air!
function flyHelicopter(dt) {
  const T = type();
  const go = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  const lift = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0);
  player.boosting = keys.ShiftLeft || keys.ShiftRight;
  player.heading += turn * T.turnSpeed * dt;
  const targetSpeed = go > 0 ? (player.boosting ? T.boostSpeed : T.normalSpeed) * engineBoost() : go < 0 ? -12 : 0;
  player.speed += (targetSpeed - player.speed) * Math.min(1, dt * 1.2);
  player.climb += (lift * T.climbSpeed - player.climb) * Math.min(1, dt * 3);
  player.pos.x -= Math.sin(player.heading) * player.speed * dt;
  player.pos.z -= Math.cos(player.heading) * player.speed * dt;
  player.pos.y = Math.min(SETTINGS.maxHeight, player.pos.y + player.climb * dt);
  // Tilt forward when going fast, sideways when turning
  heliEuler.set(-player.speed / 60 * 0.3, player.heading, turn * 0.2);
  player.quat.setFromEuler(heliEuler);
  forward.set(0, 0, -1).applyQuaternion(player.quat);
  player.bank = 0;
  // Touch the ground gently = landing (anywhere!)
  const floor = planeMesh.userData.groundHeight + 0.25;
  if (player.pos.y <= floor) {
    player.pos.y = floor;
    if (Math.abs(player.speed) < 25) land();
  }
}

function updatePlayer(dt, time) {
  for (const kind in player.powers) player.powers[kind] = Math.max(0, player.powers[kind] - dt);
  planeMesh.userData.shield.visible = player.powers.shield > 0;
  player.missileTimer = Math.max(0, player.missileTimer - dt);
  player.nukeTimer = Math.max(0, player.nukeTimer - dt);
  player.superTimer = Math.max(0, player.superTimer - dt);

  if (player.mode === 'dead') {
    myHuman.position.y = player.pos.y + 0.2;
    player.respawnTimer -= dt;
    if (player.respawnTimer <= 0) resetPlayer();
    return;
  }
  if (player.mode === 'parachute') return floatDown(dt, time);
  if (player.mode === 'walk') return walk(dt, time);
  if (player.mode === 'car') return updateCar(dt);

  if (player.mode === 'plane') {
    if (type().helicopter) flyHelicopter(dt);
    else flyPlane(dt);
  } else {
    taxi(dt);
  }

  bankQuat.setFromAxisAngle(AXIS_Z, player.bank);
  planeMesh.quaternion.copy(player.quat).multiply(bankQuat);
  planeMesh.position.copy(player.pos);
  planeMesh.updateMatrixWorld();

  // Shoot with Space (faster with the gun upgrade)
  player.shootTimer -= dt;
  if (keys.Space && player.shootTimer <= 0) {
    shoot(forward);
    player.shootTimer = SETTINGS.shootDelay * (1 - 0.2 * upgrade('guns'));
  }
  if (player.mode === 'plane') {
    // Drop bombs with B
    player.bombTimer -= dt;
    if (keys.KeyB && player.bombTimer <= 0) {
      dropBomb(forward);
      player.bombTimer = type().bombDelay;
    }
    // Fire a missile with R (reloads faster with the missile upgrade)
    if (keys.KeyR && player.missileTimer <= 0) {
      missiles.fire(new THREE.Vector3(0, -1, -3).applyMatrix4(planeMesh.matrixWorld), forward);
      player.missileTimer = MISSILE_DELAY - 0.8 * upgrade('missiles');
    }
  }

  // Too far away from the city?
  const edge = world.citySize / 2 + 1000;
  if (Math.abs(player.pos.x) > edge || Math.abs(player.pos.z) > edge) showMessage('Turn back! 🏙️', 0.2);

  // Did we crash?
  nearBuilding = !!world.hitsBuilding(player.pos, 12);
  const tooLow = player.mode === 'plane' && !type().helicopter && player.pos.y < 1.5;
  if (tooLow || world.hitsBuilding(player.pos, 1.5) || scenery.hits(player.pos) !== null) crash();
}

function updateBalloons(time) {
  for (const b of balloons) {
    b.group.position.y = b.baseY + Math.sin(time + b.wobble) * 2;
  }
}

// =====================================================================
// CAMERA
// =====================================================================
const cameraQuat = new THREE.Quaternion();
const cameraTarget = new THREE.Vector3();
const behindOffset = new THREE.Vector3();
const lookPoint = new THREE.Vector3();
const lookWanted = new THREE.Vector3();
const lastBlast = new THREE.Vector3();
let blastTimer = 0;
let shake = 0;

// Follow something from behind: where it is, which way it points, how far back and how high
function follow(dt, position, heading, back, height) {
  behindOffset.set(0, height, back).applyAxisAngle(WORLD_UP, heading);
  cameraTarget.copy(position).add(behindOffset);
  camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 5));
  camera.up.lerp(WORLD_UP, 1 - Math.exp(-dt * 4)).normalize();
  lookWanted.copy(position);
}

function updateCamera(dt) {
  blastTimer -= dt;
  const flying = player.mode === 'plane' || player.mode === 'landed';
  if (cameraMode === 'cockpit' && flying) {
    camera.position.copy(planeMesh.userData.cockpit).applyMatrix4(planeMesh.matrixWorld);
    camera.quaternion.copy(planeMesh.quaternion);
  } else {
    let watching = null;
    const myBomb = bombs.findLast((b) => b.mine);
    if (myBomb) watching = myBomb.mesh.position;
    else if (blastTimer > 0) watching = lastBlast;

    if (player.mode === 'car') {
      follow(dt, player.car.pos, player.car.yaw, 11, 4);
      lookWanted.y += 2;
    } else if (player.mode === 'parachute') {
      follow(dt, player.pos, player.heading, 18, 8);
      lookWanted.y += 3;
    } else if (player.mode === 'walk' && isInside()) {
      // Inside a room: the camera stays close, and inside the walls
      behindOffset.set(0, 1.9, 3.2).applyAxisAngle(WORLD_UP, player.heading);
      camera.position.copy(player.pos).add(behindOffset);
      robbery.inside.keepCameraInside(camera.position);
      camera.up.copy(WORLD_UP);
      lookWanted.copy(player.pos);
      lookWanted.y += 1.5;
      lookPoint.copy(lookWanted);
    } else if (player.mode === 'walk') {
      follow(dt, player.pos, player.heading, 6.5, 2.6);
      lookWanted.y += 1.7;
      if (camera.position.y < -100) camera.position.copy(player.pos).add(behindOffset);  // just came out of a building
    } else if (player.mode === 'dead') {
      lookWanted.copy(player.pos);
    } else if (watching) {
      // BOMB CAMERA: while my bomb falls (or just exploded), go up high and look down at it
      follow(dt, player.pos, Math.atan2(-forward.x, -forward.z), 40, 30);
      lookWanted.lerp(watching, 0.6);
    } else {
      // Float behind the plane. The camera turns with the plane, so loops look awesome!
      cameraQuat.slerp(player.quat, 1 - Math.exp(-dt * 4));
      const bigger = myType === 'bomber' || myType === 'heli' ? 1.4 : 1;
      behindOffset.set(0, 4.5 * bigger, 17 * bigger).applyQuaternion(cameraQuat);
      cameraTarget.copy(player.pos).add(behindOffset);
      camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 8));
      camera.up.set(0, 1, 0).applyQuaternion(cameraQuat);
      lookWanted.set(0, 0, -12).applyQuaternion(cameraQuat).add(player.pos);
    }
    lookPoint.lerp(lookWanted, 1 - Math.exp(-dt * 8));
    camera.lookAt(lookPoint);
  }
  // Never let the camera go under the ground
  if (!isInside()) camera.position.y = Math.max(camera.position.y, 1.5);
  // Shake the camera after big explosions
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-dt * (shake > 5 ? 0.5 : 4));
  }
}

// The shadow picture moves with me. To stop the shadows from shimmering,
// it only moves in tiny steps that match the pixels of the shadow picture.
const shadowPixel = 700 / 2048;
const snap = (n) => Math.round(n / shadowPixel) * shadowPixel;
const lightRight = new THREE.Vector3();
const lightUp = new THREE.Vector3();

function updateSun() {
  const direction = dayNight.lightDirection;
  lightRight.crossVectors(WORLD_UP, direction).normalize();
  lightUp.crossVectors(direction, lightRight);
  const p = player.mode === 'car' ? player.car.pos : player.pos;
  sun.target.position.set(0, 0, 0)
    .addScaledVector(lightRight, snap(p.dot(lightRight)))
    .addScaledVector(lightUp, snap(p.dot(lightUp)))
    .addScaledVector(direction, p.dot(direction));
  sun.position.copy(sun.target.position).addScaledVector(direction, 500);
}

// Factory chimneys puff out smoke (unless the factory was destroyed!)
let smokeTimer = 0;
function updateChimneys(dt) {
  smokeTimer -= dt;
  if (smokeTimer > 0) return;
  smokeTimer = 0.35;
  for (const chimney of world.chimneys) {
    if (!chimney.structure.destroyed && chimney.position.distanceTo(camera.position) < 1200) {
      effects.chimneySmoke(chimney.position);
    }
  }
}

// =====================================================================
// START SCREEN: type your name, pick a color and a plane, and fly!
// =====================================================================
const nameInput = document.getElementById('name');
const colorButtons = document.getElementById('colors');
const planeButtons = document.getElementById('planes');
const flyButton = document.getElementById('fly');
const myCoins = document.getElementById('mycoins');
const robotsBox = document.getElementById('robots');

// Remember the name, color and plane for next time
try {
  nameInput.value = localStorage.getItem('skys-name') || '';
  myColor = Number(localStorage.getItem('skys-color')) || myColor;
  const savedPlane = localStorage.getItem('skys-plane');
  if (PLANE_TYPES[savedPlane]) myType = savedPlane;
  mySticker = localStorage.getItem('skys-sticker') || 'none';
} catch {}
robotsBox.checked = welcome.robotsOn;

for (const color of PLANE_COLORS) {
  const button = document.createElement('button');
  button.style.background = hex(color);
  button.classList.toggle('picked', color === myColor);
  button.addEventListener('click', () => {
    for (const b of colorButtons.children) b.classList.remove('picked');
    button.classList.add('picked');
    setMyPlane(myType, color, mySticker);
  });
  colorButtons.append(button);
}

const owns = (plane) => !PLANE_TYPES[plane].forSale || (profile && profile.planes.includes(plane));
for (const [kind, info] of Object.entries(PLANE_TYPES)) {
  const button = document.createElement('button');
  button.dataset.plane = kind;
  button.addEventListener('click', () => {
    if (!owns(kind)) return;
    setMyPlane(kind, myColor, mySticker);
    updateStartScreen();
  });
  planeButtons.append(button);
}

// Show which planes I own, and my coins
function updateStartScreen() {
  if (started) return;
  if (!owns(myType)) setMyPlane('fighter', myColor, mySticker);
  if (profile && !profile.stickers.includes(mySticker)) setMyPlane(myType, myColor, 'none');
  for (const button of planeButtons.children) {
    const kind = button.dataset.plane, info = PLANE_TYPES[kind];
    const locked = !owns(kind);
    button.innerHTML = `<b>${info.name}</b><span>${locked ? '🔒 Buy it at the airport shop' : info.about}</span>`;
    button.classList.toggle('picked', kind === myType);
    button.style.opacity = locked ? 0.5 : 1;
  }
  myCoins.textContent = profile ? `🪙 ${profile.coins} coins` : '';
}

// Ask the server what this name owns (coins, planes...) while typing
let lookupTimer = null;
function lookUpName() {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => {
    const name = nameInput.value.trim();
    if (name) network.send({ type: 'lookup', name });
    else { profile = null; updateStartScreen(); }
  }, 300);
}
nameInput.addEventListener('input', lookUpName);
setMyPlane(myType, myColor, mySticker);
updateStartScreen();
lookUpName();

function startGame() {
  if (started) return;
  const name = nameInput.value.trim() || 'Pilot';
  try {
    localStorage.setItem('skys-name', name);
    localStorage.setItem('skys-color', String(myColor));
    localStorage.setItem('skys-plane', myType);
    localStorage.setItem('skys-sticker', mySticker);
  } catch {}
  nameInput.blur();
  document.getElementById('start').hidden = true;
  document.getElementById('hud').hidden = false;
  document.getElementById('top').hidden = false;
  document.getElementById('minimap').hidden = false;
  if (welcome.admin) {
    const crown = document.getElementById('crown');
    crown.hidden = false;
    crown.addEventListener('click', () => { crown.blur(); admin.toggle(); });
    setTimeout(() => showMessage('👑 You are the boss! Click the 👑 button (top right) for your boss panel', 4), 500);
  }
  document.documentElement.requestFullscreen().catch(() => {});
  sounds.init();
  sounds.setEngine(type().engine);
  network.send({ type: 'join', name, color: myColor, plane: myType, sticker: mySticker, robots: robotsBox.checked });
  started = true;
  network.send({ type: 'visible', on: !document.hidden });
  cameraQuat.copy(player.quat);
  updateScoreboard();
}

flyButton.addEventListener('click', startGame);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });
flyButton.disabled = false;
statusText.textContent = '';
nameInput.focus();

// Put the camera in a nice spot before the game starts
camera.position.copy(player.pos).add(new THREE.Vector3(-8, 4, -14));
camera.lookAt(player.pos);
lookPoint.copy(player.pos);

// =====================================================================
// THE MINI-MAP: other players, robots, bombs, missiles, nukes, power-ups and the airport
// =====================================================================
function drawMap(time) {
  const things = [
    { x: world.airport.x, z: 0, color: '#ffffff', size: 4, shape: 'square', edge: true },
    { x: world.bank.x, z: world.bank.z, color: '#ffd54f', size: 5, shape: 'square', edge: true },
  ];
  for (const c of robbery.pickups) {
    if (c.mesh.visible) things.push({ x: c.mesh.position.x, z: c.mesh.position.z, color: '#66bb6a', size: 2.5, shape: 'square' });
  }
  for (const car of police.cars) {
    things.push({ x: car.mesh.position.x, z: car.mesh.position.z, color: Math.floor(time * 6) % 2 ? '#ff1744' : '#2979ff', size: 5, edge: true });
  }
  for (const box of powerUps.boxes) {
    if (box.group.visible) things.push({ x: box.group.position.x, z: box.group.position.z, color: '#ffd54f', size: 3, shape: 'square' });
  }
  for (const b of bombs) things.push({ x: b.mesh.position.x, z: b.mesh.position.z, color: '#111111', size: 3 });
  for (const m of missiles.list) {
    things.push({ x: m.mesh.position.x, z: m.mesh.position.z, color: m.super ? '#ff1744' : '#ff9100', size: m.super ? 5 : 3, edge: m.super });
  }
  for (const other of others.values()) {
    if (!other.hasState || !(other.alive || other.mode === 'parachute')) continue;
    things.push({
      x: other.mesh.position.x, z: other.mesh.position.z, edge: !other.info.robot,
      color: other.info.robot ? '#9e9e9e' : hex(other.info.color), size: other.info.robot ? 4 : 6,
      shape: other.mode === 'walk' ? 'square' : 'dot',
    });
  }
  for (const n of nukes) things.push({ x: n.mesh.position.x, z: n.mesh.position.z, color: '#ffeb3b', size: 7, shape: 'nuke', edge: true, blink: true });
  const heading = player.mode === 'car' ? player.car.yaw
    : ['walk', 'parachute'].includes(player.mode) ? player.heading : Math.atan2(-forward.x, -forward.z);
  minimap.draw(myPosition(), heading, things, time);
}

// =====================================================================
// THE GAME LOOP
// =====================================================================
const clock = new THREE.Clock();
const coinSpot = new THREE.Vector3();

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (started) {
    updatePlayer(dt, time);
    sendMyState(dt);
    updateBullets(dt);
    updateBombs(dt);
    updateNukes(dt, time);
    missiles.update(dt);
    powerUps.update(dt, time);
    robots.update(dt);
    updateCamera(dt);
    updateChimneys(dt);
    updateHud(dt);
    const engineSpeed = player.mode === 'car' ? Math.abs(player.car.speed) : Math.abs(player.speed);
    sounds.update(engineSpeed, ['plane', 'landed', 'car'].includes(player.mode), nearBuilding);

    messageTimer -= dt;
    if (messageTimer <= 0) message.textContent = '';
  } else {
    // On the start screen: the plane slowly turns so you can see it
    // (the camera looks a bit above the plane, so the plane shows below the buttons)
    const far = myType === 'bomber' || myType === 'heli' ? 1.6 : 1;
    planeMesh.rotation.y = time * 0.4;
    camera.position.copy(player.pos).add(new THREE.Vector3(0, 3 * far, 16 * far));
    camera.up.set(0, 1, 0);
    camera.lookAt(player.pos.x, player.pos.y + 7.5 * far, player.pos.z);
  }
  spinPropellers(planeMesh, dt, player.boosting, time);
  dayNight.update(dt);
  weather.update(dt, camera.position);
  updateSun();
  rounds.update();
  updateOthers(dt, time);
  updateCollapses();
  effects.update(dt, camera.position);
  people.update(dt, time);
  for (const pp of parkedPlanes) {
    pp.gone -= dt;
    if (pp.gone <= 0 && !pp.mesh.visible) pp.mesh.visible = true;
  }
  if (started) {
    police.update(dt, time);
    robbery.update(dt, time);
    drawMap(time);
  }
  updateBalloons(time);
  traffic.update(dt);
  boats.update(dt, time);
  const collector = started && ['plane', 'landed', 'car', 'walk'].includes(player.mode)
    ? coinSpot.copy(player.mode === 'car' ? player.car.pos : player.pos) : null;
  scenery.update(dt, time, dayNight.serverSeconds, dayNight.night, collector, () => {
    network.send({ type: 'coin', amount: 1 });
    sounds.coin();
  });
  world.update(dt, camera.position);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

// For testing: lets a test program look inside the game
window.skys = {
  player, keys, camera, balloons, others, network, world, missiles, powerUps, rounds, dayNight, scenery, weather, traffic, shop, people, police, robbery,
  get me() { return me; }, get myType() { return myType; }, get profile() { return profile; }, get playerList() { return playerList; },
  get robotOwner() { return robotOwner; },
};
