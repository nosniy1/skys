// 🏙️ THE WORLD: sky, grass, streets, buildings, parks, mountains, clouds, street lights
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BLOCK = 60;  // size of one city block, including half of the streets around it
const TILE = 32;   // a window picture covers 32 x 32 meters of wall (8 x 8 windows)

// A "seeded" random number maker. If two computers start with the same seed number,
// they get the same "random" numbers, so they build exactly the same city!
let seed = 1;
export function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createWorld(scene, renderer, settings, citySeed) {
  seed = citySeed;
  const sharpness = renderer.capabilities.getMaxAnisotropy();
  const citySize = settings.cityBlocks * BLOCK;

  scene.fog = new THREE.Fog(0xcfe6f7, 600, 4200); // far things fade into the sky
  scene.background = new THREE.Color(0xcfe6f7);

  const sky = makeSky(scene);
  makeGround(scene, citySize, settings.cityBlocks, sharpness);
  const city = makeCity(scene, settings.cityBlocks, sharpness);
  const { buildings, structures, chimneys, airport, coast, ponds, bank } = city;
  makeMountains(scene);
  const clouds = makeClouds(scene);

  // The city is big, so we sort the buildings into squares (a "grid").
  // Then we only need to check the buildings in the square where you are.
  const grid = new Map();
  const NEAR = 15; // the biggest "extra" distance we ever check
  const cell = (n) => Math.floor(n / BLOCK);
  for (const b of buildings) {
    for (let x = cell(b.minX - NEAR); x <= cell(b.maxX + NEAR); x++) {
      for (let z = cell(b.minZ - NEAR); z <= cell(b.maxZ + NEAR); z++) {
        const key = x * 100000 + z;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(b);
      }
    }
  }

  // Is this point inside (or very close to) a building? Gives back the building, or null.
  function hitsBuilding(pos, extra) {
    for (const b of grid.get(cell(pos.x) * 100000 + cell(pos.z)) || []) {
      if (pos.x > b.minX - extra && pos.x < b.maxX + extra &&
          pos.z > b.minZ - extra && pos.z < b.maxZ + extra &&
          pos.y < b.height + extra) {
        return b;
      }
    }
    return null;
  }

  // Which buildings are close to an explosion? Gives back a list of { id, distance }.
  function structuresNear(pos, radius) {
    const found = new Map();
    for (let x = cell(pos.x - radius); x <= cell(pos.x + radius); x++) {
      for (let z = cell(pos.z - radius); z <= cell(pos.z + radius); z++) {
        for (const b of grid.get(x * 100000 + z) || []) {
          const s = b.structure;
          if (!s || s.destroyed) continue;
          const dx = Math.max(b.minX - pos.x, 0, pos.x - b.maxX);
          const dz = Math.max(b.minZ - pos.z, 0, pos.z - b.maxZ);
          const dy = Math.max(0, pos.y - b.height);
          const distance = Math.hypot(dx, dy, dz);
          if (distance < radius && distance < (found.get(s.id) ?? Infinity)) found.set(s.id, distance);
        }
      }
    }
    return [...found].map(([id, distance]) => ({ id, distance, maxHealth: structures[id].maxHealth }));
  }

  // ---------- Buildings falling down ----------
  const collapsing = [];
  const rubbleMaterial = new THREE.MeshLambertMaterial({ color: 0x8a8178 });
  const rubbleBox = new THREE.BoxGeometry(1, 1, 1);

  function destroy(id, instantly = false, rubble = true) {
    const s = structures[id];
    if (!s || s.destroyed) return null;
    s.destroyed = true;
    s.noRubble = !rubble;
    s.collapse = instantly ? 1 : 0;
    collapsing.push(s);
    if (instantly) updateCollapse(0);
    return s;
  }

  // Slowly push the building's corners down into the ground, while it shakes
  function updateCollapse(dt) {
    const time = performance.now() / 1000;
    for (let i = collapsing.length - 1; i >= 0; i--) {
      const s = collapsing[i];
      s.collapse = Math.min(1, s.collapse + dt / 2.5);
      const sink = s.collapse * s.collapse * s.top;
      const wobble = Math.sin(time * 40) * 0.4 * (1 - s.collapse);
      for (const range of s.ranges) {
        const position = range.mesh.geometry.attributes.position;
        const original = range.mesh.userData.original;
        for (let v = range.start; v < range.start + range.count; v++) {
          position.array[v * 3] = original[v * 3] + wobble;
          position.array[v * 3 + 1] = s.collapse >= 1 ? 0 : Math.max(0, original[v * 3 + 1] - sink);
        }
        position.needsUpdate = true;
      }
      if (s.collapse >= 1) {
        collapsing.splice(i, 1);
        addRubble(s);
      }
    }
  }

  // A pile of broken pieces where the building was
  function addRubble(s) {
    const pileHeight = s.kind === 'tree' ? 0 : Math.min(5, s.top * 0.25);
    for (const b of s.collides) b.height = s.noRubble ? 0 : pileHeight;
    if (pileHeight === 0 || s.noRubble) return;
    const pieces = [];
    const count = Math.min(18, Math.max(5, Math.round(s.width * s.depth / 40)));
    for (let n = 0; n < count; n++) {
      const size = 2 + Math.random() * 4;
      const piece = rubbleBox.clone();
      piece.scale(size, 1 + Math.random() * pileHeight * 0.6, size * (0.6 + Math.random() * 0.8));
      piece.rotateY(Math.random() * Math.PI);
      piece.translate(s.x + (Math.random() - 0.5) * s.width * 0.8, Math.random() * pileHeight * 0.5,
                      s.z + (Math.random() - 0.5) * s.depth * 0.8);
      pieces.push(piece);
    }
    s.rubble = new THREE.Mesh(mergeGeometries(pieces), rubbleMaterial);
    s.rubble.castShadow = s.rubble.receiveShadow = true;
    scene.add(s.rubble);
  }

  // Put every building back up (for a new round)
  function restoreAll() {
    collapsing.length = 0;
    for (const s of structures) {
      if (!s.destroyed) continue;
      s.destroyed = false;
      s.collapse = 0;
      for (const range of s.ranges) {
        const position = range.mesh.geometry.attributes.position;
        const original = range.mesh.userData.original;
        position.array.set(original.subarray(range.start * 3, (range.start + range.count) * 3), range.start * 3);
        position.needsUpdate = true;
      }
      for (const b of s.collides) b.height = b.originalHeight;
      if (s.rubble) {
        scene.remove(s.rubble);
        s.rubble.geometry.dispose();
        s.rubble = null;
      }
    }
  }

  // ---------- Changing the look for day, sunset and night ----------
  const nightColor = new THREE.Color(0x323a55);
  const sunsetColor = new THREE.Color(0xffb6a0);
  const stormColor = new THREE.Color(0x5b6170);
  function setSkyLook({ top, mid, horizon, sunDirection, sunColor, daylight, sunset, night, gloom = 0 }) {
    sky.setColors(top, mid, horizon);
    scene.fog.color.copy(horizon);
    scene.background.copy(horizon);
    sky.sun.position.copy(sunDirection).multiplyScalar(4500);
    sky.sun.material.color.copy(sunColor);
    sky.sun.material.opacity = THREE.MathUtils.clamp((sunDirection.y + 0.08) * 8, 0, 1) * (1 - gloom);
    sky.moon.position.copy(sunDirection).multiplyScalar(-4500);
    sky.moon.position.y = Math.abs(sky.moon.position.y) + 600;
    sky.moon.material.opacity = night * (1 - gloom);
    sky.stars.material.opacity = night * night * (1 - gloom);
    clouds.material.color.setRGB(1, 1, 1).lerp(sunsetColor, sunset * 0.6).lerp(stormColor, gloom * 0.8).lerp(nightColor, night);
    clouds.material.emissive.setScalar(0.4 * daylight);
    city.setNight(night);
  }

  function update(dt, cameraPosition) {
    sky.group.position.copy(cameraPosition); // the sky always stays around you
    for (const cloud of clouds.list) {
      cloud.position.x += dt * 6;            // clouds drift slowly in the wind
      if (cloud.position.x > 1800) cloud.position.x = -1800;
    }
    if (collapsing.length) updateCollapse(dt);
  }

  return { citySize, buildings, structures, chimneys, airport, coast, ponds, bank, hitsBuilding, structuresNear, destroy, restoreAll, setSkyLook, update };
}

// ---------------------------------------------------------------------
// A little helper to draw pictures (textures) with code
// ---------------------------------------------------------------------
function canvasTexture(width, height, draw, sharpness) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = sharpness;
  return texture;
}

function speckles(g, width, height, count, colors) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(random() * colors.length)];
    g.fillRect(random() * width, random() * height, 2, 2);
  }
}

function pick(list) {
  return list[Math.floor(random() * list.length)];
}

// ---------------------------------------------------------------------
// SKY: a giant ball around the world with a color gradient, the sun, the moon and stars
// ---------------------------------------------------------------------
function makeSky(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  function setColors(top, mid, horizon) {
    const gradient = g.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#' + top.getHexString());
    gradient.addColorStop(0.42, '#' + mid.getHexString());
    gradient.addColorStop(0.5, '#' + horizon.getHexString());
    gradient.addColorStop(1, '#' + horizon.getHexString());
    g.fillStyle = gradient;
    g.fillRect(0, 0, 4, 256);
    texture.needsUpdate = true;
  }
  setColors(new THREE.Color('#2a66c9'), new THREE.Color('#86bdf0'), new THREE.Color('#cfe6f7'));

  const group = new THREE.Group();
  group.add(new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 16),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false })
  ));

  const glowPicture = (inner, outer) => canvasTexture(128, 128, (g, s) => {
    const glow = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    glow.addColorStop(0, inner);
    glow.addColorStop(0.15, inner);
    glow.addColorStop(0.35, outer);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, s, s);
  }, 1);

  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowPicture('rgba(255,255,240,1)', 'rgba(255,240,180,0.35)'), fog: false, depthWrite: false, transparent: true,
  }));
  sun.scale.setScalar(900);
  group.add(sun);

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowPicture('rgba(240,244,255,1)', 'rgba(180,200,255,0.15)'), fog: false, depthWrite: false, transparent: true, opacity: 0,
  }));
  moon.scale.setScalar(500);
  group.add(moon);

  // Stars: lots of tiny dots, only visible at night
  const starPositions = [];
  for (let i = 0; i < 1500; i++) {
    const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.05, Math.random() - 0.5).normalize();
    starPositions.push(...direction.multiplyScalar(4700).toArray());
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false,
  }));
  group.add(stars);

  group.renderOrder = -1;
  scene.add(group);
  return { group, sun, moon, stars, setColors };
}

// ---------------------------------------------------------------------
// GROUND: grass everywhere, and streets with lines in the city
// ---------------------------------------------------------------------
function makeGround(scene, citySize, blocks, sharpness) {
  const grassPicture = canvasTexture(128, 128, (g, s) => {
    g.fillStyle = '#4f9a3f';
    g.fillRect(0, 0, s, s);
    speckles(g, s, s, 2500, ['#468d37', '#5aa847', '#3f8231', '#63b04f']);
  }, sharpness);
  grassPicture.repeat.set(250, 250);
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(10000, 10000),
    new THREE.MeshLambertMaterial({ map: grassPicture })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  // One picture = one city block: sidewalk in the middle, half a street on each side
  const streetPicture = canvasTexture(256, 256, (g, s) => {
    const m = s / BLOCK; // pixels per meter
    g.fillStyle = '#3c3d40';                       // asphalt
    g.fillRect(0, 0, s, s);
    speckles(g, s, s, 1500, ['#36373a', '#444548']);
    g.fillStyle = '#b4b1aa';                       // sidewalk
    g.fillRect(7 * m, 7 * m, s - 14 * m, s - 14 * m);
    g.strokeStyle = '#8f8c86';                     // curb
    g.lineWidth = 2;
    g.strokeRect(7 * m, 7 * m, s - 14 * m, s - 14 * m);
    g.fillStyle = '#f2d24b';                       // dashed yellow lines in the middle of streets
    for (let i = 0; i < s; i += 24) {
      if (i > 5 * m && i < s - 5 * m) {
        g.fillRect(i, 0, 12, 1.5);
        g.fillRect(i, s - 1.5, 12, 1.5);
        g.fillRect(0, i, 1.5, 12);
        g.fillRect(s - 1.5, i, 1.5, 12);
      }
    }
    g.fillStyle = '#e8e8e8';                       // zebra crossings next to the sidewalk corners
    for (let k = 0; k < 5; k++) {
      const p = 8 * m + k * 1.2 * m;
      g.fillRect(p, 0, 0.6 * m, 5 * m);
      g.fillRect(p, s - 5 * m, 0.6 * m, 5 * m);
      g.fillRect(0, p, 5 * m, 0.6 * m);
      g.fillRect(s - 5 * m, p, 5 * m, 0.6 * m);
    }
  }, sharpness);
  streetPicture.repeat.set(blocks, blocks);
  const streets = new THREE.Mesh(
    new THREE.PlaneGeometry(citySize, citySize),
    new THREE.MeshLambertMaterial({ map: streetPicture })
  );
  streets.rotation.x = -Math.PI / 2;
  streets.position.y = 0.2; // a little above the grass, so they don't flicker
  streets.receiveShadow = true;
  scene.add(streets);
}

// ---------------------------------------------------------------------
// BUILDINGS: walls with windows drawn on them (and windows that light up at night)
// ---------------------------------------------------------------------
const STYLES = {
  glass:   { wall: '#3e5c7a', windows: ['#8fbfe6', '#a9d2f2', '#7aa9d1', '#b8dcf5'], margin: [1, 2, 2], lit: 0.3 },
  teal:    { wall: '#2f6f6a', windows: ['#9ad6cf', '#b5e3dd', '#86c7bf'], margin: [2, 4, 4], lit: 0.3 },
  office:  { wall: '#cfc8b8', windows: ['#2f3e4c', '#3b4d5e', '#46596b', '#5a6e80'], margin: [6, 8, 6], lit: 0.35 },
  white:   { wall: '#e6e5e0', windows: ['#4a6075', '#56708a', '#3b4f63'], margin: [5, 6, 6], lit: 0.4 },
  brick:   { wall: '#9c4a2f', windows: ['#2a2a2a', '#353535', '#e8d9a8'], margin: [8, 8, 8], lit: 0.45 },
  house:   { wall: '#f4f1ea', windows: ['#4a5f73', '#5b7289', '#e9dca8'], margin: [10, 9, 10], lit: 0.55 },
  factory: { wall: '#8e969e', windows: ['#2d3b47', '#3a4a57'], margin: [3, 4, 20], lit: 0.25 },
};
const HOUSE_COLORS = ['#fff3c4', '#d6ecff', '#ffd9d9', '#e0f5d6', '#ffffff', '#ffe2c2'];
const ROOF_COLORS = ['#a33a2a', '#7a3b2e', '#4a4f57', '#b5562f', '#6b4a3a'];

// Two pictures: the wall in daylight, and which windows glow at night
function windowPictures(style, sharpness) {
  const lit = [];
  const day = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = style.wall;
    g.fillRect(0, 0, w, h);
    speckles(g, w, h, 3000, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.06)']);
    const cell = w / 8;
    const [side, top, bottom] = style.margin;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const x = i * cell + side, y = j * cell + top;
        const ww = cell - 2 * side, wh = cell - top - bottom;
        g.fillStyle = pick(style.windows);
        g.fillRect(x, y, ww, wh);
        g.fillStyle = 'rgba(255,255,255,0.18)'; // a little shine on the glass
        g.fillRect(x, y, ww * 0.35, wh);
        g.fillStyle = 'rgba(0,0,0,0.25)';       // shadow under the window
        g.fillRect(x, y + wh, ww, 1.5);
        if (random() < style.lit) lit.push([x, y, ww, wh, pick(['#ffd27a', '#ffe9b0', '#fff4d6', '#ffc966'])]);
      }
    }
  }, sharpness);
  const night = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, w, h);
    for (const [x, y, ww, wh, color] of lit) {
      g.fillStyle = color;
      g.fillRect(x, y, ww, wh);
    }
  }, sharpness);
  return { day, night };
}

// A park seen from above: grass, a round path, and paths going to the middle
function parkPicture(sharpness) {
  return canvasTexture(512, 512, (g, s) => {
    g.fillStyle = '#5cb84a';
    g.fillRect(0, 0, s, s);
    speckles(g, s, s, 6000, ['#52a842', '#66c454', '#4b9e3c', '#73cc60']);
    g.strokeStyle = g.fillStyle = '#dccca4';
    g.lineWidth = s * 0.05;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.33, 0, Math.PI * 2);
    g.stroke();
    g.fillRect(s / 2 - s * 0.025, 0, s * 0.05, s);
    g.fillRect(0, s / 2 - s * 0.025, s, s * 0.05);
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8577a';                         // flower beds
    for (const [x, y] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
      g.beginPath();
      g.arc(x * s, y * s, s * 0.035, 0, Math.PI * 2);
      g.fill();
    }
  }, sharpness);
}

// The runway: dark asphalt with white lines
function runwayPicture(sharpness) {
  return canvasTexture(128, 1024, (g, w, h) => {
    g.fillStyle = '#34353a';
    g.fillRect(0, 0, w, h);
    speckles(g, w, h, 3000, ['#2e2f33', '#3d3e42']);
    g.fillStyle = '#f0f0f0';
    g.fillRect(6, 0, 3, h);                               // side lines
    g.fillRect(w - 9, 0, 3, h);
    for (let y = 90; y < h - 90; y += 40) g.fillRect(w / 2 - 1.5, y, 3, 22); // dashed middle line
    for (const y of [10, h - 60]) {                       // "piano keys" at both ends
      for (let x = 14; x < w - 14; x += 12) g.fillRect(x, y, 7, 50);
    }
  }, sharpness);
}

// A football field with white lines
function fieldPicture(sharpness) {
  return canvasTexture(512, 326, (g, w, h) => {
    for (let x = 0; x < w; x += 40) {
      g.fillStyle = (x / 40) % 2 ? '#3fa34d' : '#4cb35a';
      g.fillRect(x, 0, 40, h);
    }
    g.strokeStyle = 'white';
    g.lineWidth = 4;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.beginPath(); g.moveTo(w / 2, 14); g.lineTo(w / 2, h - 14); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, 45, 0, Math.PI * 2); g.stroke();
    g.strokeRect(14, h / 2 - 75, 70, 150);
    g.strokeRect(w - 84, h / 2 - 75, 70, 150);
    g.fillStyle = 'white';
    g.fillRect(4, h / 2 - 25, 10, 50);
    g.fillRect(w - 14, h / 2 - 25, 10, 50);
  }, sharpness);
}

// A roof shaped like a tent: a triangle shape stretched along x
function pointyRoof(w, d, h) {
  const a = [-w / 2, 0, d / 2], b = [w / 2, 0, d / 2], c = [w / 2, 0, -d / 2], e = [-w / 2, 0, -d / 2];
  const r1 = [-w / 2, h, 0], r2 = [w / 2, h, 0];
  const triangles = [a, b, r2, a, r2, r1,   c, e, r1, c, r1, r2,   e, a, r1,   b, c, r2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function paint(geometry, color) {
  const n = geometry.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function makeCity(scene, blocks, sharpness) {
  const citySize = blocks * BLOCK;
  const buildings = [];   // boxes for crash checks
  const structures = [];  // things that can be destroyed (a building, a house, a tree...)
  const chimneys = [];    // places where smoke comes out
  const lists = {};       // all the pieces, sorted by what they are made of
  const owners = {};      // which structure each piece belongs to
  const building = [];    // the structure(s) we are building right now
  const ponds = [];       // where the ponds are (for the little boats)

  // Add a piece. It belongs to the structure we are building right now (if any).
  function put(listName, geometry) {
    (lists[listName] ||= []).push(geometry);
    (owners[listName] ||= []).push(building[building.length - 1] || null);
  }

  function begin(kind, x, z, width, depth, maxHealth) {
    const s = { id: structures.length, kind, x, z, width, depth, maxHealth, top: 0,
                ranges: [], collides: [], destroyed: false, collapse: 0, rubble: null };
    structures.push(s);
    building.push(s);
  }
  const end = () => building.pop();

  function collide(x, z, width, depth, height) {
    const b = { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2,
                height, originalHeight: height, structure: building[building.length - 1] || null };
    buildings.push(b);
    if (b.structure) b.structure.collides.push(b);
  }

  // A building with windows. tint = color for the walls, flatRoof = false for houses
  function addBuilding(x, z, width, depth, height, styleName, { tint = '#ffffff', flatRoof = true } = {}) {
    const box = new THREE.BoxGeometry(width, height, depth);
    // Stretch the window picture so the windows stay the same size on every building
    const uv = box.attributes.uv;
    for (let face = 0; face < 6; face++) {
      for (let k = 0; k < 4; k++) {
        const i = face * 4 + k;
        if (face === 2 || face === 3) uv.setXY(i, 0.01, 0.01);      // top and bottom
        else {
          const across = face < 2 ? depth : width;
          uv.setXY(i, uv.getX(i) * across / TILE, uv.getY(i) * height / TILE);
        }
      }
    }
    box.translate(x, height / 2, z);
    // Make each building a tiny bit lighter or darker so they don't all look the same
    paint(box, new THREE.Color(tint).multiplyScalar(0.8 + random() * 0.2));
    put('wall-' + styleName, box);

    if (flatRoof) {
      const roof = new THREE.BoxGeometry(width + 0.8, 1, depth + 0.8);
      roof.translate(x, height, z);
      put('roof', roof);
      // Air conditioners on top of some buildings
      if (random() < 0.6) {
        for (let n = 0; n < 1 + Math.floor(random() * 3); n++) {
          const s = 2 + random() * 3;
          const ac = new THREE.BoxGeometry(s, 1.6, s);
          ac.translate(x + (random() - 0.5) * (width - s - 1), height + 1.3, z + (random() - 0.5) * (depth - s - 1));
          put('roof', ac);
        }
      }
      collide(x, z, width, depth, height + 0.5);
    }
  }

  function addAntenna(x, z, bottom) {
    const tall = 12 + random() * 18;
    const pole = new THREE.CylinderGeometry(0.25, 0.5, tall, 6);
    pole.translate(x, bottom + tall / 2, z);
    put('antenna', pole);
    const light = new THREE.SphereGeometry(0.7, 8, 6);
    light.translate(x, bottom + tall, z);
    put('redLight', light);
  }

  // Trees: pointy pine trees or round leafy trees
  function addTree(x, z, size = 0.8 + random() * 0.6) {
    begin('tree', x, z, 4 * size, 4 * size, 1);
    const trunk = new THREE.CylinderGeometry(0.4 * size, 0.6 * size, 3 * size, 6);
    trunk.translate(x, 1.5 * size, z);
    put('trunk', trunk);
    let leaves;
    if (random() < 0.5) {
      leaves = new THREE.ConeGeometry(3 * size, 7 * size, 7);
      leaves.translate(x, 6.5 * size, z);
    } else {
      leaves = new THREE.SphereGeometry(3 * size, 8, 6);
      leaves.translate(x, 5.5 * size, z);
    }
    paint(leaves, new THREE.Color(pick(['#2e7d32', '#388e3c', '#43a047', '#558b2f'])));
    put('leaves', leaves);
    collide(x, z, 4 * size, 4 * size, 10 * size);
    end();
  }

  function flatGround(listName, x, z, width, depth, y) {
    const plane = new THREE.PlaneGeometry(width, depth);
    plane.rotateX(-Math.PI / 2);
    plane.translate(x, y, z);
    put(listName, plane);
  }

  // A STREET LIGHT on the corner of a sidewalk, with a glowing circle on the ground for the night
  function addStreetLight(x, z) {
    const pole = new THREE.CylinderGeometry(0.15, 0.22, 7, 6);
    pole.translate(x, 3.5, z);
    put('lampPole', pole);
    const head = new THREE.BoxGeometry(1.2, 0.4, 1.2);
    head.translate(x, 7.1, z);
    put('lampHead', head);
    flatGround('lampGlow', x, z, 16, 16, 0.6);
  }

  // A PARK with paths, flowers, trees and maybe a pond
  function addPark(cx, cz, size, pond) {
    flatGround('park', cx, cz, size, size, 0.35);
    if (pond) {
      const water = new THREE.CircleGeometry(size * 0.24, 32);
      water.rotateX(-Math.PI / 2);
      water.translate(cx, 0.5, cz);
      put('pond', water);
      ponds.push({ x: cx, z: cz, radius: size * 0.24 });
    }
    const trees = Math.round(size * size / 200);
    for (let n = 0; n < trees * 3 && n < 400; n++) {
      const dx = (random() - 0.5) * (size - 6), dz = (random() - 0.5) * (size - 6);
      const fromMiddle = Math.hypot(dx, dz);
      const onPath = Math.abs(dx) < 3 || Math.abs(dz) < 3 || Math.abs(fromMiddle - size * 0.33) < 4;
      if (fromMiddle > size * 0.4 && !onPath && random() < 0.4) addTree(cx + dx, cz + dz);
    }
  }

  // A HOUSE with a pointy roof
  function addHouse(x, z) {
    const w = 9 + random() * 4, d = 8 + random() * 3;
    const h = random() < 0.5 ? 4 : 7.5;          // one or two floors
    const turned = random() < 0.5;
    begin('house', x, z, turned ? d : w, turned ? w : d, 2);
    addBuilding(x, z, turned ? d : w, turned ? w : d, h, 'house', { tint: pick(HOUSE_COLORS), flatRoof: false });
    const roofHeight = 2.5 + random() * 1.5;
    const roof = pointyRoof(w + 1, d + 1, roofHeight);
    if (turned) roof.rotateY(Math.PI / 2);
    roof.translate(x, h, z);
    paint(roof, new THREE.Color(pick(ROOF_COLORS)));
    put('pointyRoof', roof);
    collide(x, z, turned ? d : w, turned ? w : d, h + roofHeight * 0.6);
    end();
  }

  // A neighborhood block: green gardens, four houses and some trees
  function addSuburb(cx, cz) {
    flatGround('yard', cx, cz, 46, 46, 0.3);
    for (const dx of [-11, 11]) {
      for (const dz of [-11, 11]) {
        if (random() < 0.9) addHouse(cx + dx + (random() - 0.5) * 3, cz + dz + (random() - 0.5) * 3);
      }
    }
    for (const [dx, dz] of [[-20, -20], [20, -20], [-20, 20], [20, 20], [0, 0]]) {
      if (random() < 0.5) addTree(cx + dx, cz + dz, 0.7 + random() * 0.4);
    }
  }

  // A FACTORY with tall chimneys
  function addFactory(cx, cz) {
    begin('factory', cx, cz, 46, 46, 4);
    const h = 12 + random() * 5;
    addBuilding(cx - 4, cz, 34, 40, h, 'factory');
    addBuilding(cx + 16, cz - 12, 12, 16, 18, 'office');
    for (const dx of [-14, -4]) {
      const tall = 40 + random() * 15;
      const chimney = new THREE.CylinderGeometry(1.8, 2.4, tall, 12);
      chimney.translate(cx + dx, tall / 2, cz + 10);
      put('chimney', chimney);
      const band = new THREE.CylinderGeometry(1.95, 1.95, 2, 12);
      band.translate(cx + dx, tall - 4, cz + 10);
      put('band', band);
      collide(cx + dx, cz + 10, 4.5, 4.5, tall);
      chimneys.push({ position: new THREE.Vector3(cx + dx, tall + 1, cz + 10), structure: building[building.length - 1] });
    }
    end();
  }

  // A SPORTS FIELD with stands for the fans and big lights
  function addSportsField(cx, cz) {
    const turned = random() < 0.5;
    const field = new THREE.PlaneGeometry(44, 28);
    field.rotateX(-Math.PI / 2);
    if (turned) field.rotateY(Math.PI / 2);
    field.translate(cx, 0.35, cz);
    put('field', field);
    begin('stands', cx, cz, 44, 44, 2);
    for (const side of [-1, 1]) {
      for (const [height, depth, offset] of [[2.5, 4, 16.5], [5, 3, 20]]) {
        const w = turned ? depth : 44, d = turned ? 44 : depth;
        const x = cx + (turned ? side * offset : 0), z = cz + (turned ? 0 : side * offset);
        const stand = new THREE.BoxGeometry(w, height, d);
        stand.translate(x, height / 2, z);
        put('stand', stand);
        collide(x, z, w, d, height);
      }
    }
    for (const [dx, dz] of [[-21, -21], [21, -21], [-21, 21], [21, 21]]) {
      const pole = new THREE.CylinderGeometry(0.3, 0.4, 22, 6);
      pole.translate(cx + dx, 11, cz + dz);
      put('antenna', pole);
      const lamp = new THREE.BoxGeometry(3, 1.5, 3);
      lamp.translate(cx + dx, 22, cz + dz);
      put('lampHead', lamp);
    }
    end();
  }

  // A ROUND glass TOWER
  function addRoundTower(cx, cz, height) {
    const r = 13 + random() * 5;
    begin('tower', cx, cz, r * 1.7, r * 1.7, 5);
    building[building.length - 1].round = r;   // a round tower (its door goes on the round wall)
    const style = pick(['glass', 'teal', 'white']);
    const tower = new THREE.CylinderGeometry(r, r, height, 32, 1);
    const uv = tower.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      if (i < 33 * 2) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / TILE, uv.getY(i) * height / TILE);
      else uv.setXY(i, 0.01, 0.01);
    }
    tower.translate(cx, height / 2, cz);
    paint(tower, new THREE.Color(0.8 + random() * 0.2, 0.8 + random() * 0.2, 0.9));
    put('wall-' + style, tower);
    const roof = new THREE.CylinderGeometry(r + 0.5, r + 0.5, 1, 32);
    roof.translate(cx, height, cz);
    put('roof', roof);
    if (random() < 0.7) addAntenna(cx, cz, height + 0.5);
    collide(cx, cz, r * 1.7, r * 1.7, height + 0.5);
    end();
  }

  function addSkyscraper(cx, cz, middle) {
    const h = 90 + random() * 140 * middle;
    begin('tower', cx, cz, 38, 38, h > 150 ? 6 : 5);
    const style = pick(['glass', 'glass', 'teal', 'white', 'office']);
    addBuilding(cx, cz, 38, 38, h, style);
    if (h > 150) {
      const top = h + 15 + random() * 30;   // a thinner tower on top
      addBuilding(cx, cz, 22, 22, top, style);
      addAntenna(cx, cz, top + 0.5);
    } else if (random() < 0.5) {
      addAntenna(cx, cz, h + 0.5);
    }
    end();
  }

  function addSmallBuildings(cx, cz, low) {
    for (const dx of [-10, 10]) {
      for (const dz of [-10, 10]) {
        if (low) {
          begin('shop', cx + dx, cz + dz, 16, 16, 2);
          addBuilding(cx + dx, cz + dz, 16, 16, 7 + random() * 7, 'white', { tint: pick(HOUSE_COLORS) });
        } else {
          const h = 12 + random() * 45;
          begin('building', cx + dx, cz + dz, 16, 16, h < 30 ? 2 : 3);
          addBuilding(cx + dx, cz + dz, 16, 16, h, pick(['brick', 'office', 'white', 'brick']));
        }
        end();
      }
    }
  }

  function addLongBuildings(cx, cz) {
    const long = random() < 0.5;
    for (const d of [-10, 10]) {
      const x = cx + (long ? 0 : d), z = cz + (long ? d : 0), h = 15 + random() * 50;
      begin('building', x, z, long ? 38 : 16, long ? 16 : 38, h < 30 ? 3 : 4);
      addBuilding(x, z, long ? 38 : 16, long ? 16 : 38, h, pick(['office', 'white', 'brick', 'teal']));
      end();
    }
  }

  // ---------- THE AIRPORT (west of the city): runway, hangar and control tower ----------
  const airport = { x: -citySize / 2 - 250, z: 0, length: 700, width: 40 };
  airport.area = { minX: airport.x - 140, maxX: airport.x + 35, minZ: -airport.length / 2 - 40, maxZ: airport.length / 2 + 40 };
  function addAirport() {
    const { x, z, length, width } = airport;
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(width, length), new THREE.MeshLambertMaterial({ map: runwayPicture(sharpness) }));
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(x, 0.25, z);
    runway.receiveShadow = true;
    scene.add(runway);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(110, 380), new THREE.MeshLambertMaterial({ color: 0x9a9a96 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(x - 80, 0.22, z);
    apron.receiveShadow = true;
    scene.add(apron);

    // The hangar: a big building with a round roof
    begin('hangar', x - 80, z - 110, 48, 70, 4);
    addBuilding(x - 80, z - 110, 48, 70, 12, 'factory');
    const arch = new THREE.CylinderGeometry(24, 24, 70, 20, 1, true, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
    arch.translate(x - 80, 12, z - 110);
    put('arch', arch);
    collide(x - 80, z - 110, 48, 70, 34);
    end();

    // The control tower, with a glass room on top
    begin('tower', x - 70, z + 110, 13, 13, 3);
    addBuilding(x - 70, z + 110, 8, 8, 28, 'white');
    const cab = new THREE.BoxGeometry(13, 5, 13);
    cab.translate(x - 70, 30.5, z + 110);
    put('glassCab', cab);
    const cabRoof = new THREE.BoxGeometry(14, 1, 14);
    cabRoof.translate(x - 70, 33.5, z + 110);
    put('roof', cabRoof);
    addAntenna(x - 70, z + 110, 34);
    collide(x - 70, z + 110, 13, 13, 34);
    end();
  }

  // ---------- THE COAST (east of the city): beach, sea and a lighthouse ----------
  const coast = { shore: citySize / 2 + 160, lighthouse: null, waves: null };
  function addCoast() {
    const sandStart = citySize / 2 + 30, sandEnd = coast.shore + 40;
    const sandPicture = canvasTexture(128, 128, (g, s) => {
      g.fillStyle = '#e8d6a0';
      g.fillRect(0, 0, s, s);
      speckles(g, s, s, 2000, ['#dcc78c', '#f2e2b4', '#d4bd80']);
    }, sharpness);
    sandPicture.repeat.set(10, 300);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(sandEnd - sandStart, 10000), new THREE.MeshLambertMaterial({ map: sandPicture }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set((sandStart + sandEnd) / 2, 0.15, 0);
    sand.receiveShadow = true;
    scene.add(sand);

    // The sea: a big blue picture with waves that move
    coast.waves = canvasTexture(256, 256, (g, s) => {
      g.fillStyle = '#2f7fbf';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = pick(['rgba(255,255,255,0.25)', 'rgba(20,70,130,0.35)', 'rgba(120,190,240,0.35)']);
        g.lineWidth = 1 + random() * 2;
        const x = random() * s, y = random() * s, w = 6 + random() * 18;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + w / 2, y - 3, x + w, y);
        g.stroke();
      }
    }, sharpness);
    coast.waves.repeat.set(120, 200);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 10000),
      new THREE.MeshStandardMaterial({ map: coast.waves, roughness: 0.25, metalness: 0.1 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(coast.shore + 3000, 0.35, 0);
    sea.receiveShadow = true;
    scene.add(sea);
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(5, 10000), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(coast.shore + 1, 0.4, 0);
    scene.add(foam);

    // The lighthouse: red and white stripes
    const lx = coast.shore - 20, lz = -350;
    begin('lighthouse', lx, lz, 10, 10, 4);
    const red = new THREE.Color('#d32f2f'), white = new THREE.Color('#f5f5f5');
    const tower = new THREE.CylinderGeometry(3, 4.5, 34, 16, 8);
    const colors = [];
    const pos = tower.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const band = Math.floor(((pos.getY(i) + 17) / 34) * 8 - 0.001);
      const c = band % 2 ? red : white;
      colors.push(c.r, c.g, c.b);
    }
    tower.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    tower.translate(lx, 17, lz);
    put('lighthouse', tower);
    const parts = [[new THREE.CylinderGeometry(4.2, 4.2, 0.8, 16), 34.4, '#37474f'],
                   [new THREE.CylinderGeometry(2.4, 2.4, 4, 16), 36.8, '#fff3c4'],
                   [new THREE.ConeGeometry(3, 3, 16), 40.3, '#d32f2f']];
    for (const [geometry, y, color] of parts) {
      paint(geometry, new THREE.Color(color));
      geometry.translate(lx, y, lz);
      put('lighthouse', geometry);
    }
    collide(lx, lz, 9, 9, 42);
    end();
    coast.lighthouse = { x: lx, z: lz, lampY: 36.8, structure: structures[structures.length - 1] };
  }

  // 🏦 THE BANK: a white building with columns, a pointy roof and a big sign
  const bank = { x: (Math.floor(blocks / 2) + 2 - blocks / 2 + 0.5) * BLOCK, z: (Math.floor(blocks / 2) - 3 - blocks / 2 + 0.5) * BLOCK };
  function addBank(cx, cz) {
    begin('bank', cx, cz, 40, 28, 6);
    addBuilding(cx, cz, 40, 28, 16, 'white', { tint: '#f7f1e0', flatRoof: false });
    const roof = pointyRoof(43, 33, 7);
    roof.translate(cx, 16, cz - 1.5);
    paint(roof, new THREE.Color('#ece6d2'));
    put('pointyRoof', roof);
    for (let i = 0; i < 6; i++) {                         // columns in front
      const column = new THREE.CylinderGeometry(0.9, 1.1, 16, 12);
      column.translate(cx - 15 + i * 6, 8, cz - 16.5);
      put('column', column);
    }
    const steps = new THREE.BoxGeometry(38, 0.8, 5);
    steps.translate(cx, 0.4, cz - 17);
    put('column', steps);
    collide(cx, cz, 40, 28, 20);
    end();
    // The sign
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const g = canvas.getContext('2d');
    g.fillStyle = '#0d2a5c';
    g.fillRect(0, 0, 512, 96);
    g.strokeStyle = '#ffd54f';
    g.lineWidth = 8;
    g.strokeRect(4, 4, 504, 88);
    g.fillStyle = '#ffd54f';
    g.font = 'bold 64px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('$  BANK  $', 256, 50);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(18, 3.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sign.material.map.colorSpace = THREE.SRGBColorSpace;
    sign.position.set(cx, 13.5, cz - 14.6);
    sign.rotation.y = Math.PI;
    scene.add(sign);
    bank.structure = structures[structures.length - 1];
  }

  // CENTRAL PARK: a big park with a pond, right in the middle of the city
  addPark(0, 0, 2 * BLOCK - 14, true);
  addAirport();
  addCoast();

  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < blocks; j++) {
      const cx = (i - blocks / 2 + 0.5) * BLOCK;
      const cz = (j - blocks / 2 + 0.5) * BLOCK;
      if (Math.abs(cx) < BLOCK && Math.abs(cz) < BLOCK) continue; // that's Central Park
      if (cx === bank.x && cz === bank.z) {
        addBank(cx, cz);
        addStreetLight(cx - 24, cz - 24);
        continue;
      }

      // Street lights on two corners of every block
      addStreetLight(cx - 24, cz - 24);
      addStreetLight(cx + 24, cz + 24);

      // 0 = middle of the city, 1 = edge of the city
      const distance = Math.max(Math.abs(cx), Math.abs(cz)) / (citySize / 2);
      const r = random();

      if (distance < 0.4) {                          // DOWNTOWN: tall towers
        if (r < 0.08) addPark(cx, cz, 46, random() < 0.5);
        else if (r < 0.6) addSkyscraper(cx, cz, 1.2 - distance);
        else if (r < 0.72) addRoundTower(cx, cz, 90 + random() * 90);
        else addLongBuildings(cx, cz);
      } else if (distance < 0.72) {                  // THE MIDDLE: offices, apartments, shops
        if (r < 0.12) addPark(cx, cz, 46, random() < 0.5);
        else if (r < 0.17) addSportsField(cx, cz);
        else if (r < 0.22) addRoundTower(cx, cz, 50 + random() * 50);
        else if (r < 0.34) addSmallBuildings(cx, cz, true);
        else if (r < 0.67) addSmallBuildings(cx, cz, false);
        else addLongBuildings(cx, cz);
      } else {                                       // THE SUBURBS: houses and factories
        if (r < 0.12) addPark(cx, cz, 46, random() < 0.5);
        else if (r < 0.2) addFactory(cx, cz);
        else if (r < 0.25) addSportsField(cx, cz);
        else addSuburb(cx, cz);
      }
    }
  }

  // Glue all the pieces together into a few big objects (much faster to draw!)
  // We remember where each structure's pieces are, so we can make it fall down later.
  const materials = [];
  function addMerged(listName, material, shadows = true) {
    const list = lists[listName];
    if (!list) return;
    const geometry = mergeGeometries(list);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.userData.original = geometry.attributes.position.array.slice();
    let start = 0;
    list.forEach((piece, i) => {
      const count = piece.attributes.position.count;
      const owner = owners[listName][i];
      if (owner) owner.ranges.push({ mesh, start, count });
      start += count;
    });
    scene.add(mesh);
    materials.push(material);
  }

  const lambert = (options) => new THREE.MeshLambertMaterial(options);
  const wallMaterials = [];
  for (const name in STYLES) {
    const pictures = windowPictures(STYLES[name], sharpness);
    const material = lambert({ map: pictures.day, emissiveMap: pictures.night, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true });
    wallMaterials.push(material);
    addMerged('wall-' + name, material);
  }
  addMerged('roof', lambert({ color: 0x77736d }));
  addMerged('pointyRoof', lambert({ vertexColors: true }));
  addMerged('antenna', new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 }));
  addMerged('redLight', new THREE.MeshBasicMaterial({ color: 0xff2020 }), false);
  const lampHeadMaterial = new THREE.MeshBasicMaterial({ color: 0x777777 });
  addMerged('lampHead', lampHeadMaterial, false);
  addMerged('lampPole', lambert({ color: 0x4a4f55 }));
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    alphaMap: canvasTexture(64, 64, (g, s) => {
      const glow = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      glow.addColorStop(0, '#ffffff');
      glow.addColorStop(1, '#000000');
      g.fillStyle = glow;
      g.fillRect(0, 0, s, s);
    }, 1),
  });
  addMerged('lampGlow', glowMaterial, false);
  addMerged('park', lambert({ map: parkPicture(sharpness) }), false);
  addMerged('yard', lambert({ color: 0x6dba57 }), false);
  addMerged('pond', new THREE.MeshStandardMaterial({ color: 0x3d8fd6, roughness: 0.1, metalness: 0.3 }), false);
  addMerged('field', lambert({ map: fieldPicture(sharpness) }), false);
  addMerged('stand', lambert({ color: 0x1e5aa8 }));
  addMerged('trunk', lambert({ color: 0x6d4c2f }));
  addMerged('leaves', new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  addMerged('chimney', lambert({ color: 0x8d3b2a }));
  addMerged('band', lambert({ color: 0xf0f0f0 }));
  addMerged('arch', lambert({ color: 0x8f9aa3, side: THREE.DoubleSide }));
  addMerged('glassCab', new THREE.MeshStandardMaterial({ color: 0x6fb7e0, metalness: 0.5, roughness: 0.15 }));
  addMerged('lighthouse', lambert({ vertexColors: true }));
  addMerged('column', lambert({ color: 0xf5f5f0 }));

  // How tall is each structure? (the highest point of all its pieces)
  for (const s of structures) {
    for (const range of s.ranges) {
      const original = range.mesh.userData.original;
      for (let v = range.start; v < range.start + range.count; v++) s.top = Math.max(s.top, original[v * 3 + 1]);
    }
  }

  // Night: windows glow and street lights turn on
  const dim = new THREE.Color(0x777777), bright = new THREE.Color(0xfff1b0);
  function setNight(night) {
    for (const material of wallMaterials) material.emissiveIntensity = night * 1.3;
    glowMaterial.opacity = night * 0.5;
    lampHeadMaterial.color.copy(dim).lerp(bright, night);
  }

  return { buildings, structures, chimneys, setNight, airport, coast, ponds, bank };
}

// ---------------------------------------------------------------------
// MOUNTAINS: bumpy cones far away, with snow on the tall ones
// ---------------------------------------------------------------------
function bump(x, y, z, seedNumber) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seedNumber * 4.13) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

function makeMountains(scene) {
  const parts = [];
  const forest = new THREE.Color('#4a6b3c'), rock = new THREE.Color('#857a6c'), snow = new THREE.Color('#f5f7fa');
  const count = 54;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.08;
    if (Math.cos(angle) > 0.35) continue;   // no mountains on the sea side (east)
    const distance = 2100 + random() * 900;
    const radius = 250 + random() * 350;
    const height = 180 + random() * 500;
    const cone = new THREE.ConeGeometry(radius, height, 10, 6, true);
    const p = cone.attributes.position;
    const colors = [];
    for (let k = 0; k < p.count; k++) {
      let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const t = (y + height / 2) / height; // 0 at the bottom, 1 at the top
      if (t > 0.01 && t < 0.99) {
        const ox = bump(x, y, z, i), oy = bump(z, x, y, i), oz = bump(y, z, x, i);
        x += ox * radius * 0.18;
        z += oz * radius * 0.18;
        y += oy * height * 0.06;
      }
      p.setXYZ(k, x, y, z);
      const c = t > 0.7 && height > 420 ? snow : t > 0.33 ? rock : forest;
      colors.push(c.r, c.g, c.b);
    }
    cone.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    cone.translate(Math.cos(angle) * distance, height / 2 - 3, Math.sin(angle) * distance);
    parts.push(cone);
  }
  const mountains = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })
  );
  scene.add(mountains);
}

// ---------------------------------------------------------------------
// CLOUDS: a few white balls squished together
// ---------------------------------------------------------------------
function makeClouds(scene) {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x666666 });
  const list = [];
  for (let i = 0; i < 30; i++) {
    const puffs = [];
    for (let n = 0; n < 4 + Math.floor(random() * 4); n++) {
      const puff = new THREE.SphereGeometry(14 + random() * 14, 10, 8);
      puff.scale(1, 0.6, 1);
      puff.translate((random() - 0.5) * 80, random() * 10, (random() - 0.5) * 40);
      puffs.push(puff);
    }
    const cloud = new THREE.Mesh(mergeGeometries(puffs), material);
    cloud.position.set((random() - 0.5) * 3600, 280 + random() * 110, (random() - 0.5) * 3600);
    scene.add(cloud);
    list.push(cloud);
  }
  return { material, list };
}
