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
  const buildings = makeCity(scene, settings.cityBlocks, sharpness);
  makeMountains(scene);
  const clouds = makeClouds(scene);

  // Is this point inside (or very close to) a building? Gives back the building, or null.
  function hitsBuilding(pos, extra) {
    for (const b of buildings) {
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

  return { citySize, buildings, hitsBuilding, update };
}

// ---------------------------------------------------------------------
// A little helper to draw pictures (textures) with code
// ---------------------------------------------------------------------
function canvasTexture(size, draw, sharpness) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = sharpness;
  return texture;
}

function speckles(g, size, count, colors) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
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
  const sunPicture = canvasTexture(128, (g, s) => {
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
  const grassPicture = canvasTexture(128, (g, s) => {
    g.fillStyle = '#4f9a3f';
    g.fillRect(0, 0, s, s);
    speckles(g, s, 2500, ['#468d37', '#5aa847', '#3f8231', '#63b04f']);
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
  const streetPicture = canvasTexture(256, (g, s) => {
    const m = s / BLOCK; // pixels per meter
    g.fillStyle = '#3c3d40';                       // asphalt
    g.fillRect(0, 0, s, s);
    speckles(g, s, 1500, ['#36373a', '#444548']);
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
  streets.position.y = 0.05;
  streets.receiveShadow = true;
  scene.add(streets);
}

// ---------------------------------------------------------------------
// BUILDINGS: walls with windows drawn on them
// ---------------------------------------------------------------------
const STYLES = {
  glass:  { wall: '#3e5c7a', windows: ['#8fbfe6', '#a9d2f2', '#7aa9d1', '#b8dcf5'], margin: [1, 2, 2] },
  teal:   { wall: '#2f6f6a', windows: ['#9ad6cf', '#b5e3dd', '#86c7bf'], margin: [2, 4, 4] },
  office: { wall: '#cfc8b8', windows: ['#2f3e4c', '#3b4d5e', '#46596b', '#5a6e80'], margin: [6, 8, 6] },
  white:  { wall: '#e6e5e0', windows: ['#4a6075', '#56708a', '#3b4f63'], margin: [5, 6, 6] },
  brick:  { wall: '#9c4a2f', windows: ['#2a2a2a', '#353535', '#e8d9a8'], margin: [8, 8, 8] },
};

function windowPicture(style, sharpness) {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = style.wall;
    g.fillRect(0, 0, s, s);
    speckles(g, s, 3000, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.06)']);
    const cell = s / 8;
    const [side, top, bottom] = style.margin;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const x = i * cell + side, y = j * cell + top;
        const w = cell - 2 * side, h = cell - top - bottom;
        g.fillStyle = style.windows[Math.floor(Math.random() * style.windows.length)];
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,255,255,0.18)'; // a little shine on the glass
        g.fillRect(x, y, w * 0.35, h);
        g.fillStyle = 'rgba(0,0,0,0.25)';       // shadow under the window
        g.fillRect(x, y + h, w, 1.5);
      }
    }
  }, sharpness);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function makeCity(scene, blocks, sharpness) {
  const buildings = [];
  const wallParts = {};
  for (const name in STYLES) wallParts[name] = [];
  const roofParts = [], antennaParts = [], redLightParts = [];
  const parkParts = [], trunkParts = [], leafParts = [];

  function addBuilding(x, z, width, depth, height, styleName) {
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
    const shade = 0.8 + Math.random() * 0.2;
    box.setAttribute('color', new THREE.Float32BufferAttribute(new Array(box.attributes.position.count * 3).fill(shade), 3));
    wallParts[styleName].push(box);

    // A flat roof with a little ledge
    const roof = new THREE.BoxGeometry(width + 0.8, 1, depth + 0.8);
    roof.translate(x, height, z);
    roofParts.push(roof);

    // Air conditioners on top of some buildings
    if (Math.random() < 0.6) {
      for (let n = 0; n < 1 + Math.floor(Math.random() * 3); n++) {
        const s = 2 + Math.random() * 3;
        const ac = new THREE.BoxGeometry(s, 1.6, s);
        ac.translate(x + (Math.random() - 0.5) * (width - s - 1), height + 1.3, z + (Math.random() - 0.5) * (depth - s - 1));
        roofParts.push(ac);
      }
    }

    buildings.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, height: height + 0.5 });
  }

  function addAntenna(x, z, bottom) {
    const tall = 12 + Math.random() * 18;
    const pole = new THREE.CylinderGeometry(0.25, 0.5, tall, 6);
    pole.translate(x, bottom + tall / 2, z);
    antennaParts.push(pole);
    const light = new THREE.SphereGeometry(0.7, 8, 6);
    light.translate(x, bottom + tall, z);
    redLightParts.push(light);
  }

  function addPark(cx, cz) {
    const lawn = new THREE.PlaneGeometry(45, 45);
    lawn.rotateX(-Math.PI / 2);
    lawn.translate(cx, 0.12, cz);
    parkParts.push(lawn);
    for (let n = 0; n < 9; n++) {
      const x = cx + (Math.random() - 0.5) * 38, z = cz + (Math.random() - 0.5) * 38;
      const size = 0.8 + Math.random() * 0.6;
      const trunk = new THREE.CylinderGeometry(0.4 * size, 0.6 * size, 3 * size, 6);
      trunk.translate(x, 1.5 * size, z);
      trunkParts.push(trunk);
      const leaves = new THREE.ConeGeometry(3 * size, 7 * size, 7);
      leaves.translate(x, 3 * size + 3.5 * size, z);
      leafParts.push(leaves);
      buildings.push({ minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2, height: 10 * size });
    }
  }

  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < blocks; j++) {
      const cx = (i - blocks / 2 + 0.5) * BLOCK;
      const cz = (j - blocks / 2 + 0.5) * BLOCK;
      // Buildings in the middle of the city are taller
      const middle = 1 - Math.hypot(cx, cz) / (blocks * BLOCK * 0.7);
      const r = Math.random();
      if (r < 0.1) {
        addPark(cx, cz);
      } else if (r < 0.1 + 0.35 * middle) {
        // One big skyscraper
        const h = 90 + Math.random() * 130 * (0.5 + middle);
        const style = pick(['glass', 'glass', 'teal', 'white']);
        addBuilding(cx, cz, 38, 38, h, style);
        if (h > 150) {
          const top = h + 15 + Math.random() * 30;   // a thinner tower on top
          addBuilding(cx, cz, 22, 22, top, style);
          addAntenna(cx, cz, top + 0.5);
        } else if (Math.random() < 0.5) {
          addAntenna(cx, cz, h + 0.5);
        }
      } else if (Math.random() < 0.5) {
        // Four smaller buildings
        for (const dx of [-10, 10]) {
          for (const dz of [-10, 10]) {
            addBuilding(cx + dx, cz + dz, 16, 16, 12 + Math.random() * 55, pick(['brick', 'office', 'white', 'brick']));
          }
        }
      } else {
        // Two long buildings
        const long = Math.random() < 0.5;
        for (const d of [-10, 10]) {
          addBuilding(cx + (long ? 0 : d), cz + (long ? d : 0), long ? 38 : 16, long ? 16 : 38,
                      15 + Math.random() * 60, pick(['office', 'white', 'brick', 'teal']));
        }
      }
    }
  }

  // Glue all the pieces together into a few big objects (much faster to draw!)
  function addMerged(parts, material, shadows = true) {
    if (parts.length === 0) return;
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const name in STYLES) {
    addMerged(wallParts[name], new THREE.MeshLambertMaterial({ map: windowPicture(STYLES[name], sharpness), vertexColors: true }));
  }
  addMerged(roofParts, new THREE.MeshLambertMaterial({ color: 0x77736d }));
  addMerged(antennaParts, new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 }));
  addMerged(redLightParts, new THREE.MeshBasicMaterial({ color: 0xff2020 }), false);
  addMerged(parkParts, new THREE.MeshLambertMaterial({ color: 0x3f8f3a }), false);
  addMerged(trunkParts, new THREE.MeshLambertMaterial({ color: 0x6d4c2f }));
  addMerged(leafParts, new THREE.MeshStandardMaterial({ color: 0x2e7d32, flatShading: true, roughness: 1 }));

  return buildings;
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
