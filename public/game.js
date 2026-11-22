// ✈️ SKYS — the main game file
import * as THREE from 'three';
import { Sounds } from './sounds.js';

// =====================================================================
// SETTINGS — try changing these numbers to change how the game feels!
// =====================================================================
const SETTINGS = {
  normalSpeed: 40,     // how fast the plane flies normally
  boostSpeed: 100,     // how fast the plane flies when you hold Shift
  turnSpeed: 1.3,      // how fast you turn left and right
  climbSpeed: 1.0,     // how fast the nose goes up and down
  maxClimbAngle: 1.1,  // how steep you can climb or dive
  shootDelay: 0.12,    // seconds between each bullet
  bulletSpeed: 250,    // how fast bullets fly
  maxHeight: 400,      // the highest you can fly
  cityBlocks: 12,      // how many blocks wide the city is
  balloonCount: 25,    // how many balloons to pop
  planeColor: 0xe53935 // your plane's color (red)
};

// =====================================================================
// THE 3D WORLD: scene, camera, lights
// =====================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);         // sky blue
scene.fog = new THREE.Fog(0x87ceeb, 250, 1300);         // things far away fade into the sky

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 3000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(300, 500, 200);
scene.add(sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// =====================================================================
// THE CITY: grass, streets and skyscrapers
// =====================================================================
const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(6000, 6000),
  new THREE.MeshLambertMaterial({ color: 0x4caf50 })
);
grass.rotation.x = -Math.PI / 2;
scene.add(grass);

const BLOCK = 60;                                   // size of one city block (with streets)
const CITY_SIZE = SETTINGS.cityBlocks * BLOCK;

const streets = new THREE.Mesh(
  new THREE.PlaneGeometry(CITY_SIZE + 20, CITY_SIZE + 20),
  new THREE.MeshLambertMaterial({ color: 0x555555 })
);
streets.rotation.x = -Math.PI / 2;
streets.position.y = 0.05;
scene.add(streets);

// We remember every building so we can check if the plane crashes into one
const buildings = [];
const buildingColors = [0xeceff1, 0xb0bec5, 0x90a4ae, 0xffe0b2, 0xbcaaa4, 0x80cbc4, 0x9fa8da, 0xfff59d];

function addBuilding(x, z, width, depth, height) {
  buildings.push({
    minX: x - width / 2, maxX: x + width / 2,
    minZ: z - depth / 2, maxZ: z + depth / 2,
    height, x, z, width, depth,
  });
}

for (let i = 0; i < SETTINGS.cityBlocks; i++) {
  for (let j = 0; j < SETTINGS.cityBlocks; j++) {
    const cx = (i - SETTINGS.cityBlocks / 2 + 0.5) * BLOCK;
    const cz = (j - SETTINGS.cityBlocks / 2 + 0.5) * BLOCK;
    const r = Math.random();
    if (r < 0.1) continue;                       // an empty block (a little park)
    if (r < 0.3) {
      addBuilding(cx, cz, 38, 38, 90 + Math.random() * 130);   // one big skyscraper
    } else {
      for (const dx of [-10, 10]) {                            // four smaller buildings
        for (const dz of [-10, 10]) {
          addBuilding(cx + dx, cz + dz, 16, 16, 12 + Math.random() * 55);
        }
      }
    }
  }
}

// Draw all the buildings at once (this is much faster than one by one)
{
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0); // so the bottom of the box sits on the ground
  const mesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), buildings.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  buildings.forEach((b, n) => {
    matrix.makeScale(b.width, b.height, b.depth).setPosition(b.x, 0, b.z);
    mesh.setMatrixAt(n, matrix);
    mesh.setColorAt(n, color.setHex(buildingColors[n % buildingColors.length]));
  });
  scene.add(mesh);
}

// Is this point inside (or very close to) a building?
function hitsBuilding(pos, extra) {
  for (const b of buildings) {
    if (pos.x > b.minX - extra && pos.x < b.maxX + extra &&
        pos.z > b.minZ - extra && pos.z < b.maxZ + extra &&
        pos.y < b.height + extra) {
      return true;
    }
  }
  return false;
}

// =====================================================================
// THE AIRPLANE: built out of boxes!
// =====================================================================
function makePlane(color) {
  const plane = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1a237e });
  const dark = new THREE.MeshLambertMaterial({ color: 0x333333 });

  function part(w, h, d, material, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    plane.add(mesh);
    return mesh;
  }

  part(1.2, 1.2, 6, paint, 0, 0, 0);          // body
  part(8, 0.2, 1.6, white, 0, 0, -0.5);       // wings
  part(3, 0.2, 1, white, 0, 0.2, 2.6);        // tail wing
  part(0.2, 1.4, 1, paint, 0, 0.9, 2.6);      // tail fin
  part(0.9, 0.6, 1.2, glass, 0, 0.8, -0.8);   // cockpit window
  plane.userData.propeller = part(3, 0.3, 0.1, dark, 0, 0, -3.1);

  plane.rotation.order = 'YXZ'; // turn first, then nose up/down, then tilt
  return plane;
}

const planeMesh = makePlane(SETTINGS.planeColor);
scene.add(planeMesh);

const START = new THREE.Vector3(0, 80, CITY_SIZE / 2 + 150);

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
  const spread = CITY_SIZE / 2;
  do {
    balloon.baseY = 30 + Math.random() * 150;
    balloon.group.position.set(
      (Math.random() * 2 - 1) * spread,
      balloon.baseY,
      (Math.random() * 2 - 1) * spread
    );
  } while (hitsBuilding(balloon.group.position, 8));
  const color = balloonColors[Math.floor(Math.random() * balloonColors.length)];
  balloon.color = color;
  balloon.sphere.material.color.setHex(color);
}

for (let i = 0; i < SETTINGS.balloonCount; i++) {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(balloonShape, new THREE.MeshLambertMaterial());
  const string = new THREE.Mesh(stringShape, stringMaterial);
  string.position.y = -7;
  group.add(sphere, string);
  scene.add(group);
  const balloon = { group, sphere, baseY: 0, wobble: Math.random() * 10, color: 0 };
  placeBalloon(balloon);
  balloons.push(balloon);
}

// =====================================================================
// BULLETS and EXPLOSION PIECES
// =====================================================================
const bullets = [];
const bulletShape = new THREE.SphereGeometry(0.4, 6, 6);
const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });

function shoot(forward) {
  const mesh = new THREE.Mesh(bulletShape, bulletMaterial);
  mesh.position.copy(player.pos).addScaledVector(forward, 4);
  scene.add(mesh);
  const velocity = forward.clone().multiplyScalar(SETTINGS.bulletSpeed + player.speed);
  bullets.push({ mesh, velocity, life: 2 });
  sounds.shoot();
}

const pieces = [];
const pieceShape = new THREE.BoxGeometry(1, 1, 1);

function burst(position, color, count, power, size) {
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(pieceShape, new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(position);
    mesh.scale.setScalar(size * (0.5 + Math.random()));
    scene.add(mesh);
    const velocity = new THREE.Vector3().randomDirection().multiplyScalar(power * (0.3 + Math.random()));
    pieces.push({ mesh, velocity, life: 1 + Math.random() * 0.8 });
  }
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
let score = 0;
let messageTimer = 0;

function showMessage(text, seconds) {
  message.textContent = text;
  messageTimer = seconds;
}

function flashScreen() {
  flash.style.transition = 'none';
  flash.style.opacity = 0.8;
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
  player.respawnTimer = 2;
  planeMesh.visible = false;
  burst(player.pos, 0xff6d00, 30, 40, 1.6);
  burst(player.pos, 0xffd600, 20, 30, 1.2);
  burst(player.pos, 0x424242, 15, 20, 2);
  sounds.boom();
  flashScreen();
  showMessage('💥 BOOM! 💥', 2);
}

// =====================================================================
// UPDATE: this runs about 60 times every second
// =====================================================================
const sounds = new Sounds();
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
  planeMesh.userData.propeller.rotation.z += dt * 30;

  // Shoot with Space
  player.shootTimer -= dt;
  if (keys.Space && player.shootTimer <= 0) {
    shoot(forward);
    player.shootTimer = SETTINGS.shootDelay;
  }

  // Too far away from the city?
  if (Math.abs(player.pos.x) > 1100 || Math.abs(player.pos.z) > 1100) {
    showMessage('Turn back! 🏙️', 0.2);
  }

  // Did we crash?
  nearBuilding = hitsBuilding(player.pos, 12);
  if (player.pos.y < 1.5 || hitsBuilding(player.pos, 1.5)) crash();
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.mesh.position.addScaledVector(b.velocity, dt);
    b.life -= dt;

    let gone = b.life <= 0 || b.mesh.position.y < 0 || hitsBuilding(b.mesh.position, 0);

    for (const balloon of balloons) {
      if (!gone && b.mesh.position.distanceTo(balloon.group.position) < 5) {
        burst(balloon.group.position, balloon.color, 15, 25, 0.8);
        sounds.pop();
        score++;
        placeBalloon(balloon);
        gone = true;
      }
    }

    if (gone) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
    }
  }
}

function updatePieces(dt) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    p.velocity.y -= 30 * dt; // gravity pulls the pieces down
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.mesh.rotation.x += dt * 5;
    p.mesh.rotation.y += dt * 3;
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      pieces.splice(i, 1);
    }
  }
}

function updateBalloons(time) {
  for (const b of balloons) {
    b.group.position.y = b.baseY + Math.sin(time + b.wobble) * 2;
  }
}

const cameraTarget = new THREE.Vector3();
const behindOffset = new THREE.Vector3();
const cockpitSpot = new THREE.Vector3();

function updateCamera(dt) {
  if (cameraMode === 'cockpit' && player.alive) {
    planeMesh.updateMatrixWorld();
    cockpitSpot.set(0, 1.4, -1.5).applyMatrix4(planeMesh.matrixWorld);
    camera.position.copy(cockpitSpot);
    camera.quaternion.copy(planeMesh.quaternion);
  } else {
    // Float behind and a bit above the plane
    behindOffset.set(0, 5, 16).applyAxisAngle(THREE.Object3D.DEFAULT_UP, player.yaw);
    cameraTarget.copy(player.pos).add(behindOffset);
    camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 5));
    camera.lookAt(player.pos);
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
camera.position.copy(player.pos).add(new THREE.Vector3(0, 5, 16));
camera.lookAt(player.pos);

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
    updatePieces(dt);
    updateCamera(dt);
    updateHud();
    sounds.update(player.speed, player.alive, nearBuilding);

    messageTimer -= dt;
    if (messageTimer <= 0) message.textContent = '';
  }
  updateBalloons(time);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
