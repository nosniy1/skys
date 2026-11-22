// 🚓 THE POLICE: rob something and they come after you with sirens, and they shoot!
// The more you rob, the more "wanted stars" ⭐ you get, and the more police cars come.
// Get far away from them (or fly away!) and the stars slowly go away.
// (Each player has their own police: the police chasing you are only on your computer.)
import * as THREE from 'three';
import { makeCar } from './vehicles.js';

const SPEED = 27;          // how fast police cars drive
const SHOOT_RANGE = 55;    // how close they must be to shoot
const SHOOT_DELAY = 0.8;   // seconds between police shots (for each car)
const HIT_CHANCE = 0.5;    // how often a police shot hits you
const CAR_HEALTH = 6;      // shots to destroy a police car
const LOSE_DISTANCE = 230; // get this far from every police car to start losing them
const CALM_DOWN = 10;      // seconds far away to lose one star

function makePoliceCar() {
  const car = makeCar(0xf5f5f5);
  const black = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.4, 2.4), new THREE.MeshLambertMaterial({ color: 0x111111 }));
  black.position.y = 0.85;
  car.add(black);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.4), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.4), new THREE.MeshBasicMaterial({ color: 0x0044ff }));
  red.position.set(-0.4, 2.15, 0.25);
  blue.position.set(0.4, 2.15, 0.25);
  car.add(red, blue);
  car.userData.lights = [red, blue];
  return car;
}

const probe = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Police {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.bolts = [];
    this.wanted = 0;
    this.lostTimer = 0;
    this.spawnTimer = 0;
    this.boltShape = new THREE.BoxGeometry(0.12, 0.12, 2.5);
    this.boltMaterial = new THREE.MeshBasicMaterial({ color: 0x40c4ff });
  }

  // A crime happened! More stars, more police.
  crime(stars) {
    this.wanted = Math.min(5, Math.max(this.wanted + 1, stars));
    this.lostTimer = 0;
    this.spawnTimer = 0;
  }

  // Where am I? (the police can't catch you in the air!)
  get target() {
    const player = this.game.player;
    if (!player.alive) return null;
    if (this.game.isInside) return this.game.robberyOutside;   // they wait for you outside the door!
    if (player.mode === 'walk') return player.pos;
    if (player.mode === 'car') return player.car.pos;
    if (player.mode === 'landed') return player.pos;
    return null;
  }

  spawnCar(near) {
    const world = this.game.world;
    for (let tries = 0; tries < 20; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const spot = new THREE.Vector3(near.x + Math.cos(angle) * 220, 0.2, near.z + Math.sin(angle) * 220);
      // put it on a street
      spot.x = Math.round((spot.x + world.citySize / 2) / 60) * 60 - world.citySize / 2 + 2.5;
      if (Math.abs(spot.x) > world.citySize / 2 + 400 || Math.abs(spot.z) > world.citySize / 2 + 400) continue;
      if (world.hitsBuilding(probe.set(spot.x, 1, spot.z), 2) || spot.x > world.coast.shore - 5) continue;
      const mesh = makePoliceCar();
      mesh.position.copy(spot);
      this.game.scene.add(mesh);
      this.cars.push({ mesh, yaw: Math.atan2(-(near.x - spot.x), -(near.z - spot.z)), speed: 0, health: CAR_HEALTH, shootTimer: 2 });
      return;
    }
  }

  update(dt, time) {
    const target = this.target;
    const anyone = target || this.game.player.pos;

    // Do the police still see me?
    if (this.wanted > 0) {
      const close = target && this.cars.some((c) => c.mesh.position.distanceTo(target) < LOSE_DISTANCE);
      if (close) this.lostTimer = 0;
      else this.lostTimer += dt;
      if (this.lostTimer > CALM_DOWN) {
        this.wanted--;
        this.lostTimer = 0;
        if (this.wanted === 0) this.game.showMessage('😎 You lost the police!', 2.5);
      }
      // More police come if needed
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.cars.length < this.wanted && target) {
        this.spawnTimer = 3;
        this.spawnCar(target);
      }
    }

    let nearest = Infinity;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const p = car.mesh.position;
      // No more stars: the police drive away and disappear
      if (this.wanted === 0 && (!target || p.distanceTo(anyone) > 300)) {
        this.game.scene.remove(car.mesh);
        this.cars.splice(i, 1);
        continue;
      }
      nearest = Math.min(nearest, p.distanceTo(anyone));
      this.drive(car, dt, this.wanted > 0 ? target : null);
      // Flashing lights
      const flash = Math.floor(time * 6) % 2;
      car.mesh.userData.lights[0].material.color.setHex(flash ? 0xff0000 : 0x330000);
      car.mesh.userData.lights[1].material.color.setHex(flash ? 0x001133 : 0x0055ff);
      // Shoot!
      car.shootTimer -= dt;
      if (this.wanted > 0 && target && car.shootTimer <= 0 && p.distanceTo(target) < SHOOT_RANGE) {
        car.shootTimer = SHOOT_DELAY + Math.random() * 0.4;
        this.fire(p, target);
      }
    }
    this.game.sounds.policeSiren(this.cars.length ? Math.max(0.15, 1 - nearest / 500) : 0);
    this.updateBolts(dt);
  }

  // Drive toward the target, and go around buildings
  drive(car, dt, target) {
    const world = this.game.world;
    const p = car.mesh.position;
    let wantYaw = car.yaw, wantSpeed = SPEED * 0.6;
    if (target) {
      wantYaw = Math.atan2(-(target.x - p.x), -(target.z - p.z));
      const d = p.distanceTo(target);
      wantSpeed = d < 14 ? 0 : SPEED;
    }
    const diff = Math.atan2(Math.sin(wantYaw - car.yaw), Math.cos(wantYaw - car.yaw));
    car.yaw += THREE.MathUtils.clamp(diff, -2.2 * dt, 2.2 * dt);
    car.speed += (wantSpeed - car.speed) * Math.min(1, dt * 2);
    for (const tryTurn of [0, 0.7, -0.7, 1.5, -1.5]) {
      const yaw = car.yaw + tryTurn;
      probe.set(p.x - Math.sin(yaw) * car.speed * dt * 8, 1, p.z - Math.cos(yaw) * car.speed * dt * 8);
      if (!world.hitsBuilding(probe, 1.5) && probe.x < world.coast.shore - 3) {
        car.yaw = yaw;
        p.x -= Math.sin(yaw) * car.speed * dt;
        p.z -= Math.cos(yaw) * car.speed * dt;
        break;
      }
    }
    car.mesh.rotation.y = car.yaw;
  }

  fire(from, target) {
    const start = from.clone().add(new THREE.Vector3(0, 1.6, 0));
    const end = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 1.1, (Math.random() - 0.5) * 2));
    const mesh = new THREE.Mesh(this.boltShape, this.boltMaterial);
    mesh.position.copy(start);
    mesh.lookAt(end);
    this.game.scene.add(mesh);
    this.bolts.push({ mesh, from: start, to: end, t: 0, duration: start.distanceTo(end) / 120, hits: Math.random() < HIT_CHANCE });
    this.game.sounds.shoot(0.4 * Math.max(0, 1 - this.game.camera.position.distanceTo(start) / 250));
  }

  updateBolts(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt / b.duration;
      b.mesh.position.lerpVectors(b.from, b.to, Math.min(1, b.t));
      if (b.t < 1) continue;
      this.game.scene.remove(b.mesh);
      this.bolts.splice(i, 1);
      if (b.hits) this.game.npcHitsMe(b.to, true);
    }
  }

  // My bullets can hit police cars
  bulletHits(from, to) {
    const line = new THREE.Line3(from, to);
    const closest = new THREE.Vector3();
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const center = car.mesh.position.clone().add(new THREE.Vector3(0, 1, 0));
      line.closestPointToPoint(center, true, closest);
      if (closest.distanceTo(center) < 2.6) {
        car.health--;
        if (car.health <= 0) this.destroy(i);
        return true;
      }
    }
    return false;
  }

  blast(position, radius) {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      if (this.cars[i].mesh.position.distanceTo(position) < radius) this.destroy(i);
    }
  }

  destroy(i) {
    const car = this.cars[i];
    this.cars.splice(i, 1);
    this.game.scene.remove(car.mesh);
    this.game.bigBang(car.mesh.position.clone().setY(1), 0.7, 0, false);
    this.spawnTimer = 6;  // reinforcements are on their way...
  }

  // Busted, or a new round: the police go home
  clear() {
    this.wanted = 0;
    for (const car of this.cars) this.game.scene.remove(car.mesh);
    for (const b of this.bolts) this.game.scene.remove(b.mesh);
    this.cars.length = 0;
    this.bolts.length = 0;
  }
}
