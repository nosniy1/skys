// ✈️ SKYS — the main game file
import * as THREE from 'three';
import { Sounds } from './sounds.js';
import { createWorld } from './world.js';
import { makePlane, makeBomb } from './plane.js';
import { Effects } from './effects.js';

// =====================================================================
// SETTINGS — try changing these numbers to change how the game feels!
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
  bombBlastSize: 35,    // how far away a bomb can pop balloons (and hurt you!)
  maxHeight: 400,       // the highest you can fly
  cityBlocks: 20,       // how many blocks wide the city is
  balloonCount: 40,     // how many balloons to pop
  planeColor: 0xd32f2f, // your plane's color (red)
};

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

const world = createWorld(scene, renderer, SETTINGS);
const effects = new Effects(scene);
const sounds = new Sounds();

// =====================================================================
// THE AIRPLANE
// =====================================================================
const planeMesh = makePlane(SETTINGS.planeColor);
scene.add(planeMesh);

const START = new THREE.Vector3(0, 80, world.citySize / 2 + 150);

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
  player.pos.copy(START);
  player.yaw = 0;
  player.pitch = 0;
  player.roll = 0;
  player.speed = SETTINGS.normalSpeed;
  player.alive = true;
  planeMesh.visible = true;
}
resetPlayer();

// =====================================================================
// BALLOONS to shoot at
// =====================================================================
const balloons = [];
const balloonColors = [0xff4081, 0xffeb3b, 0x00e5ff, 0x76ff03, 0xff9100, 0xd500f9];
const balloonShape = new THREE.SphereGeometry(4, 16, 12);
const stringShape = new THREE.CylinderGeometry(0.05, 0.05, 6);
const stringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

function placeBalloon(balloon) {
  const spread = world.citySize / 2;
  do {
    balloon.baseY = 30 + Math.random() * 150;
    balloon.group.position.set(
      (Math.random() * 2 - 1) * spread,
      balloon.baseY,
      (Math.random() * 2 - 1) * spread
    );
  } while (world.hitsBuilding(balloon.group.position, 8));
  balloon.color = balloonColors[Math.floor(Math.random() * balloonColors.length)];
  balloon.sphere.material.color.setHex(balloon.color);
}

for (let i = 0; i < SETTINGS.balloonCount; i++) {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(balloonShape, new THREE.MeshStandardMaterial({ roughness: 0.3 }));
  sphere.castShadow = true;
  const string = new THREE.Mesh(stringShape, stringMaterial);
  string.position.y = -7;
  group.add(sphere, string);
  scene.add(group);
  const balloon = { group, sphere, baseY: 0, wobble: Math.random() * 10, color: 0 };
  placeBalloon(balloon);
  balloons.push(balloon);
}

let score = 0;

function popBalloon(balloon) {
  effects.burst(balloon.group.position, balloon.color, 15, 25, 0.8, true);
  sounds.pop();
  score++;
  placeBalloon(balloon);
}

// =====================================================================
// BULLETS
// =====================================================================
const bullets = [];
const bulletShape = new THREE.BoxGeometry(0.15, 0.15, 3);
const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffee58 });
let gunSide = 1;

function shoot(forward) {
  const mesh = new THREE.Mesh(bulletShape, bulletMaterial);
  // Guns on the wings: left, right, left, right...
  mesh.position.set(gunSide * 2.2, -0.3, -1.5).applyMatrix4(planeMesh.matrixWorld);
  mesh.quaternion.copy(planeMesh.quaternion);
  gunSide = -gunSide;
  scene.add(mesh);
  const velocity = forward.clone().multiplyScalar(SETTINGS.bulletSpeed + player.speed);
  bullets.push({ mesh, velocity, life: 2 });
  sounds.shoot();
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.mesh.position.addScaledVector(b.velocity, dt);
    b.life -= dt;
    const p = b.mesh.position;

    let gone = b.life <= 0;
    if (p.y < 0 || world.hitsBuilding(p, 0)) {
      effects.sparks(p);
      gone = true;
    }
    for (const balloon of balloons) {
      if (!gone && p.distanceTo(balloon.group.position) < 5) {
        popBalloon(balloon);
        gone = true;
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

function dropBomb(forward) {
  const mesh = bombModel.clone();
  mesh.position.set(0, -1.2, -0.5).applyMatrix4(planeMesh.matrixWorld);
  scene.add(mesh);
  // The bomb starts with the plane's speed, then gravity pulls it down
  const velocity = forward.clone().multiplyScalar(player.speed * 0.9);
  velocity.y -= 4;
  bombs.push({ mesh, velocity, whistle: sounds.bombDrop() });
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
    const balloon = balloons.find((b) => b.group.position.distanceTo(p) < 6);
    if (p.y <= 0 || building || balloon) {
      let surface = null;
      if (balloon) {
        surface = null;                                // hit a balloon in the air!
      } else if (!building) {
        p.y = 0;
        surface = 0;                                   // hit the ground
      } else if (p.y > building.height - 4) {
        p.y = building.height;
        surface = building.height;                     // hit a roof
      }
      bomb.whistle.stop();
      bigBang(p.clone(), 1, surface);
      scene.remove(bomb.mesh);
      bombs.splice(i, 1);
    }
  }
}

// A big explosion: fire, smoke, sound, shaking, and it pops balloons nearby
function bigBang(position, size, surface) {
  effects.explosion(position, size, surface);
  if (size >= 1) {           // the bomb camera keeps watching the explosion for a moment
    lastBlast.copy(position);
    blastTimer = 2;
  }
  const distance = camera.position.distanceTo(position);
  sounds.bigBoom(THREE.MathUtils.clamp(1 - distance / 1500, 0.2, 1) * size);
  shake = Math.max(shake, Math.max(0, 1 - distance / 400) * 4 * size);
  if (distance < 250) flashScreen(0.6 * (1 - distance / 250), '#ffcc66');

  for (const balloon of balloons) {
    if (balloon.group.position.distanceTo(position) < SETTINGS.bombBlastSize) popBalloon(balloon);
  }
  // Careful! If your own bomb explodes too close, you crash too.
  if (player.alive && size >= 1 && player.pos.distanceTo(position) < 15) crash();
}

// =====================================================================
// KEYBOARD
// =====================================================================
const keys = {};
let cameraMode = 'behind';
let started = false;

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (!started || e.repeat) return;
  if (e.code === 'KeyC') {
    cameraMode = cameraMode === 'behind' ? 'cockpit' : 'behind';
    for (const part of planeMesh.userData.hideInCockpit) part.visible = cameraMode !== 'cockpit';
    document.getElementById('crosshair').hidden = cameraMode !== 'cockpit';
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
// SCREEN MESSAGES
// =====================================================================
const hud = document.getElementById('hud');
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

// =====================================================================
// CRASH!
// =====================================================================
function crash() {
  player.alive = false;
  player.respawnTimer = 2.5;
  planeMesh.visible = false;
  bigBang(player.pos.clone(), 0.6, player.pos.y < 3 ? 0 : null);
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
    // BOMB CAMERA: while a bomb falls (or just exploded), go up high and look down at it
    blastTimer -= dt;
    let watching = null;
    if (bombs.length > 0) watching = bombs[bombs.length - 1].mesh.position;
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

function updateHud() {
  hud.innerHTML =
    `🎈 Score: ${score}<br>` +
    `💨 Speed: ${Math.round(player.speed * 3)} km/h<br>` +
    `⬆️ Height: ${Math.round(player.pos.y)} m`;
}

// =====================================================================
// START when you click
// =====================================================================
document.getElementById('start').addEventListener('click', () => {
  document.getElementById('start').hidden = true;
  document.documentElement.requestFullscreen().catch(() => {});
  sounds.init();
  started = true;
});

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
  effects.update(dt);
  updateBalloons(time);
  world.update(dt, camera.position);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

// For testing: lets a test program look inside the game
window.skys = { player, keys, camera, balloons, get score() { return score; } };
