// 🏙️ THE WORLD: sky, grass, streets, skyscrapers, parks, mountains and clouds
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BLOCK = 60;  // size of one city block, including half of the streets around it
const TILE = 32;   // a window picture covers 32 x 32 meters of wall (8 x 8 windows)

export function createWorld(scene, renderer, settings) {
  const sharpness = renderer.capabilities.getMaxAnisotropy();
  const citySize = settings.cityBlocks * BLOCK;

  scene.fog = new THREE.Fog(0xcfe6f7, 600, 4200); // far things fade into the sky
  scene.background = new THREE.Color(0xcfe6f7);

  const sky = makeSky(scene);
  makeGround(scene, citySize, settings.cityBlocks, sharpness);
  const { buildings, chimneys } = makeCity(scene, settings.cityBlocks, sharpness);
  makeMountains(scene);
  const clouds = makeClouds(scene);

  // The city is big, so we sort the buildings into squares (a "grid").
  // Then we only need to check the buildings in the square where you are.
  const grid = new Map();
  const NEAR = 15; // the biggest "extra" distance we ever check
  const square = (x, z) => Math.floor(x / BLOCK) * 100000 + Math.floor(z / BLOCK);
  for (const b of buildings) {
    for (let x = Math.floor((b.minX - NEAR) / BLOCK); x <= Math.floor((b.maxX + NEAR) / BLOCK); x++) {
      for (let z = Math.floor((b.minZ - NEAR) / BLOCK); z <= Math.floor((b.maxZ + NEAR) / BLOCK); z++) {
        const key = x * 100000 + z;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(b);
      }
    }
  }

  // Is this point inside (or very close to) a building? Gives back the building, or null.
  function hitsBuilding(pos, extra) {
    for (const b of grid.get(square(pos.x, pos.z)) || []) {
      if (pos.x > b.minX - extra && pos.x < b.maxX + extra &&
          pos.z > b.minZ - extra && pos.z < b.maxZ + extra &&
          pos.y < b.height + extra) {
        return b;
      }
    }
    return null;
  }

  function update(dt, cameraPosition) {
    sky.position.copy(cameraPosition); // the sky always stays around you
    for (const cloud of clouds) {
      cloud.position.x += dt * 6;      // clouds drift slowly in the wind
      if (cloud.position.x > 1800) cloud.position.x = -1800;
    }
  }

  return { citySize, buildings, chimneys, hitsBuilding, update };
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
    g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    g.fillRect(Math.random() * width, Math.random() * height, 2, 2);
  }
}

// ---------------------------------------------------------------------
// SKY: a giant ball around the world, blue at the top and light at the bottom
// ---------------------------------------------------------------------
function makeSky(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const gradient = g.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#2a66c9');
  gradient.addColorStop(0.42, '#86bdf0');
  gradient.addColorStop(0.5, '#cfe6f7');
  gradient.addColorStop(1, '#cfe6f7');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sky = new THREE.Group();
  sky.add(new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 16),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false })
  ));

  // The sun: a glowing circle in the sky
  const sunPicture = canvasTexture(128, 128, (g, s) => {
    const glow = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    glow.addColorStop(0, 'rgba(255,255,240,1)');
    glow.addColorStop(0.15, 'rgba(255,250,220,1)');
    glow.addColorStop(0.35, 'rgba(255,240,180,0.35)');
    glow.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, s, s);
  }, 1);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunPicture, fog: false, depthWrite: false }));
  sun.position.set(250, 450, 150).normalize().multiplyScalar(4500);
  sun.scale.setScalar(900);
  sky.add(sun);

  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

// ---------------------------------------------------------------------
// GROUND: grass everywhere, and streets with white lines in the city
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
      const p = 8 * m + k * 1.2 * m;               // stripes along the sidewalk edge
      g.fillRect(p, 0, 0.6 * m, 5 * m);            // top street
      g.fillRect(p, s - 5 * m, 0.6 * m, 5 * m);    // bottom street
      g.fillRect(0, p, 5 * m, 0.6 * m);            // left street
      g.fillRect(s - 5 * m, p, 5 * m, 0.6 * m);    // right street
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
// BUILDINGS: walls with windows drawn on them
// ---------------------------------------------------------------------
const STYLES = {
  glass:   { wall: '#3e5c7a', windows: ['#8fbfe6', '#a9d2f2', '#7aa9d1', '#b8dcf5'], margin: [1, 2, 2] },
  teal:    { wall: '#2f6f6a', windows: ['#9ad6cf', '#b5e3dd', '#86c7bf'], margin: [2, 4, 4] },
  office:  { wall: '#cfc8b8', windows: ['#2f3e4c', '#3b4d5e', '#46596b', '#5a6e80'], margin: [6, 8, 6] },
  white:   { wall: '#e6e5e0', windows: ['#4a6075', '#56708a', '#3b4f63'], margin: [5, 6, 6] },
  brick:   { wall: '#9c4a2f', windows: ['#2a2a2a', '#353535', '#e8d9a8'], margin: [8, 8, 8] },
  house:   { wall: '#f4f1ea', windows: ['#4a5f73', '#5b7289', '#e9dca8'], margin: [10, 9, 10] },
  factory: { wall: '#8e969e', windows: ['#2d3b47', '#3a4a57'], margin: [3, 4, 20] },
};
const HOUSE_COLORS = ['#fff3c4', '#d6ecff', '#ffd9d9', '#e0f5d6', '#ffffff', '#ffe2c2'];
const ROOF_COLORS = ['#a33a2a', '#7a3b2e', '#4a4f57', '#b5562f', '#6b4a3a'];

function windowPicture(style, sharpness) {
  return canvasTexture(256, 256, (g, w, h) => {
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
      }
    }
  }, sharpness);
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

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function makeCity(scene, blocks, sharpness) {
  const citySize = blocks * BLOCK;
  const buildings = [];   // boxes for crash checks
  const chimneys = [];    // places where smoke comes out
  const wallParts = {};
  for (const name in STYLES) wallParts[name] = [];
  const parts = {
    roof: [], pointyRoof: [], antenna: [], redLight: [], lamp: [], park: [], yard: [], pond: [],
    field: [], stand: [], trunk: [], leaves: [], chimney: [], band: [],
  };

  function collide(x, z, width, depth, height) {
    buildings.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, height });
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
    paint(box, new THREE.Color(tint).multiplyScalar(0.8 + Math.random() * 0.2));
    wallParts[styleName].push(box);

    if (flatRoof) {
      const roof = new THREE.BoxGeometry(width + 0.8, 1, depth + 0.8);
      roof.translate(x, height, z);
      parts.roof.push(roof);
      // Air conditioners on top of some buildings
      if (Math.random() < 0.6) {
        for (let n = 0; n < 1 + Math.floor(Math.random() * 3); n++) {
          const s = 2 + Math.random() * 3;
          const ac = new THREE.BoxGeometry(s, 1.6, s);
          ac.translate(x + (Math.random() - 0.5) * (width - s - 1), height + 1.3, z + (Math.random() - 0.5) * (depth - s - 1));
          parts.roof.push(ac);
        }
      }
      collide(x, z, width, depth, height + 0.5);
    }
  }

  function addAntenna(x, z, bottom) {
    const tall = 12 + Math.random() * 18;
    const pole = new THREE.CylinderGeometry(0.25, 0.5, tall, 6);
    pole.translate(x, bottom + tall / 2, z);
    parts.antenna.push(pole);
    const light = new THREE.SphereGeometry(0.7, 8, 6);
    light.translate(x, bottom + tall, z);
    parts.redLight.push(light);
  }

  // Trees: pointy pine trees or round leafy trees
  function addTree(x, z, size = 0.8 + Math.random() * 0.6) {
    const trunk = new THREE.CylinderGeometry(0.4 * size, 0.6 * size, 3 * size, 6);
    trunk.translate(x, 1.5 * size, z);
    parts.trunk.push(trunk);
    let leaves;
    if (Math.random() < 0.5) {
      leaves = new THREE.ConeGeometry(3 * size, 7 * size, 7);
      leaves.translate(x, 6.5 * size, z);
    } else {
      leaves = new THREE.SphereGeometry(3 * size, 8, 6);
      leaves.translate(x, 5.5 * size, z);
    }
    paint(leaves, new THREE.Color(pick(['#2e7d32', '#388e3c', '#43a047', '#558b2f'])));
    parts.leaves.push(leaves);
    collide(x, z, 4 * size, 4 * size, 10 * size);
  }

  function flatGround(list, x, z, width, depth, y) {
    const plane = new THREE.PlaneGeometry(width, depth);
    plane.rotateX(-Math.PI / 2);
    plane.translate(x, y, z);
    list.push(plane);
  }

  // A PARK with paths, flowers, trees and maybe a pond
  function addPark(cx, cz, size, pond) {
    flatGround(parts.park, cx, cz, size, size, 0.35);
    if (pond) {
      const water = new THREE.CircleGeometry(size * 0.24, 32);
      water.rotateX(-Math.PI / 2);
      water.translate(cx, 0.5, cz);
      parts.pond.push(water);
    }
    const trees = Math.round(size * size / 200);
    for (let n = 0; n < trees * 3 && n < 400; n++) {
      const dx = (Math.random() - 0.5) * (size - 6), dz = (Math.random() - 0.5) * (size - 6);
      const fromMiddle = Math.hypot(dx, dz);
      const onPath = Math.abs(dx) < 3 || Math.abs(dz) < 3 || Math.abs(fromMiddle - size * 0.33) < 4;
      if (fromMiddle > size * 0.4 && !onPath && Math.random() < 0.4) addTree(cx + dx, cz + dz);
    }
  }

  // A HOUSE with a pointy roof
  function addHouse(x, z) {
    const w = 9 + Math.random() * 4, d = 8 + Math.random() * 3;
    const h = Math.random() < 0.5 ? 4 : 7.5;          // one or two floors
    const turned = Math.random() < 0.5;
    addBuilding(x, z, turned ? d : w, turned ? w : d, h, 'house', { tint: pick(HOUSE_COLORS), flatRoof: false });
    const roofHeight = 2.5 + Math.random() * 1.5;
    const roof = pointyRoof(w + 1, d + 1, roofHeight);
    if (turned) roof.rotateY(Math.PI / 2);
    roof.translate(x, h, z);
    paint(roof, new THREE.Color(pick(ROOF_COLORS)));
    parts.pointyRoof.push(roof);
    collide(x, z, turned ? d : w, turned ? w : d, h + roofHeight * 0.6);
  }

  // A neighborhood block: green gardens, four houses and some trees
  function addSuburb(cx, cz) {
    flatGround(parts.yard, cx, cz, 46, 46, 0.3);
    for (const dx of [-11, 11]) {
      for (const dz of [-11, 11]) {
        if (Math.random() < 0.9) addHouse(cx + dx + (Math.random() - 0.5) * 3, cz + dz + (Math.random() - 0.5) * 3);
      }
    }
    for (const [dx, dz] of [[-20, -20], [20, -20], [-20, 20], [20, 20], [0, 0]]) {
      if (Math.random() < 0.5) addTree(cx + dx, cz + dz, 0.7 + Math.random() * 0.4);
    }
  }

  // A FACTORY with tall chimneys
  function addFactory(cx, cz) {
    const h = 12 + Math.random() * 5;
    addBuilding(cx - 4, cz, 34, 40, h, 'factory');
    addBuilding(cx + 16, cz - 12, 12, 16, 18, 'office');
    for (const dx of [-14, -4]) {
      const tall = 40 + Math.random() * 15;
      const chimney = new THREE.CylinderGeometry(1.8, 2.4, tall, 12);
      chimney.translate(cx + dx, tall / 2, cz + 10);
      parts.chimney.push(chimney);
      const band = new THREE.CylinderGeometry(1.95, 1.95, 2, 12);
      band.translate(cx + dx, tall - 4, cz + 10);
      parts.band.push(band);
      collide(cx + dx, cz + 10, 4.5, 4.5, tall);
      chimneys.push(new THREE.Vector3(cx + dx, tall + 1, cz + 10));
    }
  }

  // A SPORTS FIELD with stands for the fans and big lights
  function addSportsField(cx, cz) {
    const turned = Math.random() < 0.5;
    const field = new THREE.PlaneGeometry(44, 28);
    field.rotateX(-Math.PI / 2);
    if (turned) field.rotateY(Math.PI / 2);
    field.translate(cx, 0.35, cz);
    parts.field.push(field);
    for (const side of [-1, 1]) {
      for (const [height, depth, offset] of [[2.5, 4, 16.5], [5, 3, 20]]) {
        const w = turned ? depth : 44, d = turned ? 44 : depth;
        const x = cx + (turned ? side * offset : 0), z = cz + (turned ? 0 : side * offset);
        const stand = new THREE.BoxGeometry(w, height, d);
        stand.translate(x, height / 2, z);
        parts.stand.push(stand);
        collide(x, z, w, d, height);
      }
    }
    for (const [dx, dz] of [[-21, -21], [21, -21], [-21, 21], [21, 21]]) {
      const pole = new THREE.CylinderGeometry(0.3, 0.4, 22, 6);
      pole.translate(cx + dx, 11, cz + dz);
      parts.antenna.push(pole);
      const lamp = new THREE.BoxGeometry(3, 1.5, 3);
      lamp.translate(cx + dx, 22, cz + dz);
      parts.lamp.push(lamp);
    }
  }

  // A ROUND glass TOWER
  function addRoundTower(cx, cz, height) {
    const r = 13 + Math.random() * 5;
    const style = pick(['glass', 'teal', 'white']);
    const tower = new THREE.CylinderGeometry(r, r, height, 32, 1);
    const uv = tower.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      if (i < 33 * 2) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / TILE, uv.getY(i) * height / TILE);
      else uv.setXY(i, 0.01, 0.01);
    }
    tower.translate(cx, height / 2, cz);
    paint(tower, new THREE.Color(0.8 + Math.random() * 0.2, 0.8 + Math.random() * 0.2, 0.9));
    wallParts[style].push(tower);
    const roof = new THREE.CylinderGeometry(r + 0.5, r + 0.5, 1, 32);
    roof.translate(cx, height, cz);
    parts.roof.push(roof);
    if (Math.random() < 0.7) addAntenna(cx, cz, height + 0.5);
    collide(cx, cz, r * 1.7, r * 1.7, height + 0.5);
  }

  function addSkyscraper(cx, cz, middle) {
    const h = 90 + Math.random() * 140 * middle;
    const style = pick(['glass', 'glass', 'teal', 'white', 'office']);
    addBuilding(cx, cz, 38, 38, h, style);
    if (h > 150) {
      const top = h + 15 + Math.random() * 30;   // a thinner tower on top
      addBuilding(cx, cz, 22, 22, top, style);
      addAntenna(cx, cz, top + 0.5);
    } else if (Math.random() < 0.5) {
      addAntenna(cx, cz, h + 0.5);
    }
  }

  function addSmallBuildings(cx, cz, low) {
    for (const dx of [-10, 10]) {
      for (const dz of [-10, 10]) {
        if (low) addBuilding(cx + dx, cz + dz, 16, 16, 7 + Math.random() * 7, 'white', { tint: pick(HOUSE_COLORS) });
        else addBuilding(cx + dx, cz + dz, 16, 16, 12 + Math.random() * 45, pick(['brick', 'office', 'white', 'brick']));
      }
    }
  }

  function addLongBuildings(cx, cz) {
    const long = Math.random() < 0.5;
    for (const d of [-10, 10]) {
      addBuilding(cx + (long ? 0 : d), cz + (long ? d : 0), long ? 38 : 16, long ? 16 : 38,
                  15 + Math.random() * 50, pick(['office', 'white', 'brick', 'teal']));
    }
  }

  // CENTRAL PARK: a big park with a pond, right in the middle of the city
  addPark(0, 0, 2 * BLOCK - 14, true);

  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < blocks; j++) {
      const cx = (i - blocks / 2 + 0.5) * BLOCK;
      const cz = (j - blocks / 2 + 0.5) * BLOCK;
      if (Math.abs(cx) < BLOCK && Math.abs(cz) < BLOCK) continue; // that's Central Park

      // 0 = middle of the city, 1 = edge of the city
      const distance = Math.max(Math.abs(cx), Math.abs(cz)) / (citySize / 2);
      const r = Math.random();

      if (distance < 0.4) {                          // DOWNTOWN: tall towers
        if (r < 0.08) addPark(cx, cz, 46, Math.random() < 0.5);
        else if (r < 0.6) addSkyscraper(cx, cz, 1.2 - distance);
        else if (r < 0.72) addRoundTower(cx, cz, 90 + Math.random() * 90);
        else addLongBuildings(cx, cz);
      } else if (distance < 0.72) {                  // THE MIDDLE: offices, apartments, shops
        if (r < 0.12) addPark(cx, cz, 46, Math.random() < 0.5);
        else if (r < 0.17) addSportsField(cx, cz);
        else if (r < 0.22) addRoundTower(cx, cz, 50 + Math.random() * 50);
        else if (r < 0.34) addSmallBuildings(cx, cz, true);
        else if (r < 0.67) addSmallBuildings(cx, cz, false);
        else addLongBuildings(cx, cz);
      } else {                                       // THE SUBURBS: houses and factories
        if (r < 0.12) addPark(cx, cz, 46, Math.random() < 0.5);
        else if (r < 0.2) addFactory(cx, cz);
        else if (r < 0.25) addSportsField(cx, cz);
        else addSuburb(cx, cz);
      }
    }
  }

  // Glue all the pieces together into a few big objects (much faster to draw!)
  function addMerged(list, material, shadows = true) {
    if (list.length === 0) return;
    const mesh = new THREE.Mesh(mergeGeometries(list), material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const lambert = (options) => new THREE.MeshLambertMaterial(options);
  for (const name in STYLES) {
    addMerged(wallParts[name], lambert({ map: windowPicture(STYLES[name], sharpness), vertexColors: true }));
  }
  addMerged(parts.roof, lambert({ color: 0x77736d }));
  addMerged(parts.pointyRoof, lambert({ vertexColors: true }));
  addMerged(parts.antenna, new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 }));
  addMerged(parts.redLight, new THREE.MeshBasicMaterial({ color: 0xff2020 }), false);
  addMerged(parts.lamp, new THREE.MeshBasicMaterial({ color: 0xfffbe0 }), false);
  addMerged(parts.park, lambert({ map: parkPicture(sharpness) }), false);
  addMerged(parts.yard, lambert({ color: 0x6dba57 }), false);
  addMerged(parts.pond, new THREE.MeshStandardMaterial({ color: 0x3d8fd6, roughness: 0.1, metalness: 0.3 }), false);
  addMerged(parts.field, lambert({ map: fieldPicture(sharpness) }), false);
  addMerged(parts.stand, lambert({ color: 0x1e5aa8 }));
  addMerged(parts.trunk, lambert({ color: 0x6d4c2f }));
  addMerged(parts.leaves, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  addMerged(parts.chimney, lambert({ color: 0x8d3b2a }));
  addMerged(parts.band, lambert({ color: 0xf0f0f0 }));

  return { buildings, chimneys };
}

// ---------------------------------------------------------------------
// MOUNTAINS: bumpy cones far away, with snow on the tall ones
// ---------------------------------------------------------------------
function bump(x, y, z, seed) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.13) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

function makeMountains(scene) {
  const parts = [];
  const forest = new THREE.Color('#4a6b3c'), rock = new THREE.Color('#857a6c'), snow = new THREE.Color('#f5f7fa');
  const count = 54;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.08;
    const distance = 2100 + Math.random() * 900;
    const radius = 250 + Math.random() * 350;
    const height = 180 + Math.random() * 500;
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
  const clouds = [];
  for (let i = 0; i < 30; i++) {
    const puffs = [];
    for (let n = 0; n < 4 + Math.floor(Math.random() * 4); n++) {
      const puff = new THREE.SphereGeometry(14 + Math.random() * 14, 10, 8);
      puff.scale(1, 0.6, 1);
      puff.translate((Math.random() - 0.5) * 80, Math.random() * 10, (Math.random() - 0.5) * 40);
      puffs.push(puff);
    }
    const cloud = new THREE.Mesh(mergeGeometries(puffs), material);
    cloud.position.set((Math.random() - 0.5) * 3600, 280 + Math.random() * 110, (Math.random() - 0.5) * 3600);
    scene.add(cloud);
    clouds.push(cloud);
  }
  return clouds;
}
