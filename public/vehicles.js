// 🚗 VEHICLES: city traffic, little boats on the ponds, and the car YOU can drive
import * as THREE from 'three';

const BLOCK = 60;
const CAR_COLORS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xffffff, 0x212121, 0xfb8c00, 0x8e24aa, 0x90a4ae];

// Shared shapes, so 50 cars don't need 50 copies
const shapes = {
  body: new THREE.BoxGeometry(2.2, 0.9, 4.4),
  cabin: new THREE.BoxGeometry(1.9, 0.75, 2.2),
  wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12).rotateZ(Math.PI / 2),
  light: new THREE.BoxGeometry(0.45, 0.25, 0.1),
};
const materials = {
  glass: new THREE.MeshStandardMaterial({ color: 0x1c2833, roughness: 0.1, metalness: 0.5 }),
  tire: new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
  front: new THREE.MeshBasicMaterial({ color: 0xfff6c8 }),
  back: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
};
const paints = new Map();

// A CAR. Its front points toward -Z, like the planes.
export function makeCar(color) {
  if (!paints.has(color)) paints.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.35 }));
  const car = new THREE.Group();
  car.userData.color = color;
  const add = (shape, material, x, y, z) => {
    const mesh = new THREE.Mesh(shape, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    car.add(mesh);
  };
  add(shapes.body, paints.get(color), 0, 0.85, 0);
  add(shapes.cabin, materials.glass, 0, 1.65, 0.25);
  for (const x of [-1.05, 1.05]) {
    for (const z of [-1.4, 1.4]) add(shapes.wheel, materials.tire, x, 0.42, z);
    add(shapes.light, materials.front, x * 0.65, 0.95, -2.21);
    add(shapes.light, materials.back, x * 0.65, 0.95, 2.21);
  }
  return car;
}

// =====================================================================
// TRAFFIC: lots of cars driving on the streets, turning at the crossings.
// (Each computer has its own traffic, so it doesn't need the network.)
// To draw 150 cars quickly, all car bodies are ONE object, all wheels are ONE object, etc.
// ("instanced" drawing: the same shape drawn many times in different places)
// =====================================================================
const PARTS = [
  // shape, material, where on the car, how many per car
  ['body', null, [[0, 0.85, 0]]],
  ['cabin', materials.glass, [[0, 1.65, 0.25]]],
  ['wheel', materials.tire, [[-1.05, 0.42, -1.4], [1.05, 0.42, -1.4], [-1.05, 0.42, 1.4], [1.05, 0.42, 1.4]]],
  ['light', materials.front, [[-0.68, 0.95, -2.21], [0.68, 0.95, -2.21]]],
  ['light', materials.back, [[-0.68, 0.95, 2.21], [0.68, 0.95, 2.21]]],
];
const carMatrix = new THREE.Matrix4();
const partMatrix = new THREE.Matrix4();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);

export class Traffic {
  constructor(scene, world, count = 150) {
    this.half = world.citySize / 2;
    this.blocks = Math.round(world.citySize / BLOCK);
    this.cars = [];
    this.meshes = PARTS.map(([shape, material, spots]) => {
      const mesh = new THREE.InstancedMesh(shapes[shape], material || new THREE.MeshStandardMaterial({ metalness: 0.4, roughness: 0.35 }), count * spots.length);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.userData.spots = spots.map(([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z));
      scene.add(mesh);
      return mesh;
    });
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const car = { alive: true, respawn: 0, color: CAR_COLORS[i % CAR_COLORS.length], position: new THREE.Vector3(), yaw: 0 };
      this.meshes[0].setColorAt(i, color.setHex(car.color));
      this.place(car);
      this.cars.push(car);
    }
  }

  // Street number k (0, 1, 2...) is at this x or z position
  street(k) {
    return k * BLOCK - this.half;
  }

  place(car) {
    car.axis = Math.random() < 0.5 ? 'x' : 'z';                 // which way it drives
    car.line = this.street(1 + Math.floor(Math.random() * (this.blocks - 1))); // which street it is on
    car.pos = this.street(Math.floor(Math.random() * this.blocks)) + BLOCK / 2;
    car.dir = Math.random() < 0.5 ? 1 : -1;
    car.speed = 10 + Math.random() * 8;
    car.alive = true;
  }

  update(dt) {
    this.cars.forEach((car, i) => {
      if (!car.alive) {
        car.respawn -= dt;
        if (car.respawn <= 0) this.place(car);
      } else {
        this.drive(car, dt);
      }
      // Put every part of this car in the right place
      carMatrix.makeRotationAxis(yAxis, car.yaw).setPosition(car.position);
      for (const mesh of this.meshes) {
        const spots = mesh.userData.spots;
        spots.forEach((spot, k) => {
          mesh.setMatrixAt(i * spots.length + k, car.alive ? partMatrix.multiplyMatrices(carMatrix, spot) : hidden);
        });
      }
    });
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  drive(car, dt) {
    const before = car.pos;
    car.pos += car.dir * car.speed * dt;
    // Did we just drive over a crossing?
    const k0 = Math.floor((before + this.half) / BLOCK), k1 = Math.floor((car.pos + this.half) / BLOCK);
    if (k0 !== k1) {
      const k = car.dir > 0 ? k1 : k0;
      const crossing = this.street(k);
      const atEdge = k <= 0 || k >= this.blocks;
      if (atEdge || Math.random() < 0.35) {
        // Turn onto the other street
        const oldLine = car.line;
        car.axis = car.axis === 'x' ? 'z' : 'x';
        car.line = crossing;
        car.pos = oldLine;
        const lineK = Math.round((oldLine + this.half) / BLOCK);
        if (lineK <= 0) car.dir = 1;
        else if (lineK >= this.blocks) car.dir = -1;
        else car.dir = Math.random() < 0.5 ? 1 : -1;
      }
    }
    // Drive on the right side of the street
    if (car.axis === 'x') {
      car.position.set(car.pos, 0.2, car.line + car.dir * 2.5);
      car.yaw = car.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      car.position.set(car.line - car.dir * 2.5, 0.2, car.pos);
      car.yaw = car.dir > 0 ? Math.PI : 0;
    }
  }

  // Cars close to an explosion get destroyed. Gives back where they were.
  blast(position, radius) {
    const hit = [];
    for (const car of this.cars) {
      if (car.alive && car.position.distanceTo(position) < radius) {
        car.alive = false;
        car.respawn = 20 + Math.random() * 20;
        hit.push(car.position.clone());
      }
    }
    return hit;
  }

  // Steal the closest car! Gives back its color and where it was, or null.
  stealNear(position, distance) {
    let best = null;
    for (const car of this.cars) {
      const d = car.position.distanceTo(position);
      if (car.alive && d < distance) { best = car; distance = d; }
    }
    if (!best) return null;
    best.alive = false;
    best.respawn = 30;
    return { color: best.color, position: best.position.clone(), yaw: best.yaw };
  }

  // Is a car driving over this spot? (cars can knock people over)
  carAt(position, distance) {
    return this.cars.find((car) => car.alive && car.position.distanceTo(position) < distance) || null;
  }
}

// =====================================================================
// BOATS: little sailing boats going around in circles on the ponds
// =====================================================================
export class Boats {
  constructor(scene, ponds) {
    this.boats = [];
    const hull = new THREE.BoxGeometry(1.4, 0.6, 3.2);
    const mast = new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6);
    const sailShape = new THREE.BufferGeometry();
    sailShape.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.4, 1.0, 0, 3.4, 0, 0, 0.4, -1.2], 3));
    sailShape.computeVertexNormals();
    const wood = new THREE.MeshLambertMaterial({ color: 0x8d5524 });
    const cloth = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    ponds.forEach((pond, i) => {
      if (i % 2) return; // a boat on every other pond
      const boat = new THREE.Group();
      boat.add(new THREE.Mesh(hull, wood));
      const m = new THREE.Mesh(mast, wood);
      m.position.y = 1.7;
      boat.add(m, new THREE.Mesh(sailShape, cloth));
      scene.add(boat);
      this.boats.push({ mesh: boat, pond, angle: Math.random() * Math.PI * 2, alive: true, respawn: 0 });
    });
  }

  update(dt, time) {
    for (const b of this.boats) {
      if (!b.alive) {
        b.respawn -= dt;
        if (b.respawn <= 0) { b.alive = true; b.mesh.visible = true; }
        continue;
      }
      b.angle += dt * 0.25;
      const r = b.pond.radius * 0.6;
      b.mesh.position.set(b.pond.x + Math.cos(b.angle) * r, 0.75 + Math.sin(time * 2 + b.angle) * 0.08, b.pond.z + Math.sin(b.angle) * r);
      b.mesh.rotation.y = -b.angle;
    }
  }

  blast(position, radius) {
    const hit = [];
    for (const b of this.boats) {
      if (b.alive && b.mesh.position.distanceTo(position) < radius) {
        b.alive = false;
        b.mesh.visible = false;
        b.respawn = 30;
        hit.push(b.mesh.position.clone());
      }
    }
    return hit;
  }
}

// =====================================================================
// DRIVING MY CAR 🚙: W = gas, S = brake / reverse, A/D = steer, Shift = turbo
// =====================================================================
const next = new THREE.Vector3();
export function driveCar(car, keys, dt, world) {
  const gas = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const topSpeed = keys.ShiftLeft || keys.ShiftRight ? 45 : 28;
  if (gas > 0) car.speed = Math.min(topSpeed, car.speed + 16 * dt);
  else if (gas < 0) car.speed = Math.max(-10, car.speed - 25 * dt);
  else car.speed *= Math.exp(-dt * 0.8);
  if (car.speed > topSpeed) car.speed -= 20 * dt;

  // You can only steer when the car is moving
  const steer = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  car.yaw += steer * dt * 1.8 * Math.min(1, Math.abs(car.speed) / 8) * Math.sign(car.speed || 1);

  next.set(car.pos.x - Math.sin(car.yaw) * car.speed * dt, 1, car.pos.z - Math.cos(car.yaw) * car.speed * dt);
  const edge = world.citySize / 2 + 1200;
  const blocked = world.hitsBuilding(next, 1.6) || next.x > world.coast.shore - 3 || Math.abs(next.x) > edge || Math.abs(next.z) > edge;
  if (blocked) {
    car.speed = -car.speed * 0.3; // BONK! bounce back
    return true;
  }
  car.pos.set(next.x, 0.2, next.z);
  return false;
}
