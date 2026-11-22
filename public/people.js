// 🧍 PEOPLE walking on the sidewalks. EVERYBODY carries a blaster and has a health bar.
//  - Normal people only shoot if you attack them (some fight back, some run away).
//  - The RED gang and the BLUE gang hang out in "danger zones" and fight each other.
//  - After 3 hits a person is knocked out (and drops some cash 💵), then gets back up later.
// (Each computer has its own people, like the traffic.)
import * as THREE from 'three';

const BLOCK = 60;
const SIDE = 43;            // the sidewalk around a block is a square, 43 meters on each side
const WALK = 1.5, RUN = 6;  // speeds
const HEALTH = 3;           // hits before a person is knocked out
const KNOCKED_OUT = 20;     // seconds before they get back up
const SHIRTS = [0xffffff, 0xffeb3b, 0x8bc34a, 0xff9800, 0x9c27b0, 0x00bcd4, 0xe91e63, 0x795548];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const TEAMS = { red: 0xd32f2f, blue: 0x1565c0 };
const GANG = 48;            // how many gang members
const ZONES = 6;            // the gangs hang out in a few "danger zones"
const RANGE = 55;           // how far away they can shoot
const BARS = 24;            // how many health bars we show at the same time (the closest people)

// The body parts, all drawn with "instancing" (one shape drawn many times)
const shapes = {
  leg: new THREE.BoxGeometry(0.22, 0.9, 0.25).translate(0, -0.45, 0),
  body: new THREE.BoxGeometry(0.55, 0.7, 0.3),
  arm: new THREE.BoxGeometry(0.16, 0.65, 0.18).translate(0, -0.32, 0),
  head: new THREE.SphereGeometry(0.2, 8, 6),
  gun: new THREE.BoxGeometry(0.08, 0.14, 0.5),
};

const m = new THREE.Matrix4(), part = new THREE.Matrix4(), turn = new THREE.Matrix4(), lie = new THREE.Matrix4();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3(), closest = new THREE.Vector3(), line = new THREE.Line3(), cameraRight = new THREE.Vector3();

export class People {
  constructor(scene, world, game, count = 180) {
    this.game = game;
    this.world = world;
    this.people = [];
    this.bolts = [];
    const add = (shape, color, perPerson) => {
      const mesh = new THREE.InstancedMesh(shapes[shape], new THREE.MeshLambertMaterial({ color }), count * perPerson);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    };
    this.legs = add('leg', 0x37474f, 2);
    this.arms = add('arm', 0xffffff, 2);
    this.bodies = add('body', 0xffffff, 1);
    this.heads = add('head', 0xffffff, 1);
    this.guns = add('gun', 0x222222, 1);
    this.boltShape = new THREE.BoxGeometry(0.12, 0.12, 2.5);
    this.boltMaterials = {
      red: new THREE.MeshBasicMaterial({ color: 0xff5252 }),
      blue: new THREE.MeshBasicMaterial({ color: 0x40c4ff }),
      none: new THREE.MeshBasicMaterial({ color: 0xffee58 }),
    };
    this.makeHealthBars(scene);

    const blocks = Math.round(world.citySize / BLOCK);
    const randomBlock = () => {
      let bx, bz;
      do {
        bx = (Math.floor(Math.random() * blocks) - blocks / 2 + 0.5) * BLOCK;
        bz = (Math.floor(Math.random() * blocks) - blocks / 2 + 0.5) * BLOCK;
      } while (Math.abs(bx) < BLOCK && Math.abs(bz) < BLOCK); // not inside Central Park
      return [bx, bz];
    };
    this.zones = Array.from({ length: ZONES }, randomBlock);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const team = i < GANG ? (i % 2 ? 'red' : 'blue') : null;
      let bx, bz;
      if (team) {
        // In a danger zone: the zone's block, or the block right next to it
        const [zx, zz] = this.zones[i % ZONES];
        const side = Math.floor(Math.random() * 5);
        bx = zx + (side === 1 ? BLOCK : side === 2 ? -BLOCK : 0);
        bz = zz + (side === 3 ? BLOCK : side === 4 ? -BLOCK : 0);
      } else {
        [bx, bz] = randomBlock();
      }
      this.people.push({
        bx, bz, s: Math.random() * SIDE * 4, dir: Math.random() < 0.5 ? 1 : -1,
        position: new THREE.Vector3(), yaw: 0, team, step: Math.random() * 10,
        health: HEALTH, angry: 0, state: 'walk', timer: 0, shootTimer: Math.random() * 2, faceTarget: null, gone: false,
      });
      this.bodies.setColorAt(i, color.setHex(team ? TEAMS[team] : SHIRTS[i % SHIRTS.length]));
      this.arms.setColorAt(i * 2, color);
      this.arms.setColorAt(i * 2 + 1, color);
      this.heads.setColorAt(i, color.setHex(SKINS[i % SKINS.length]));
    }
  }

  // Health bars: a dark bar with a colored part that gets shorter
  makeHealthBars(scene) {
    this.bars = [];
    for (let i = 0; i < BARS; i++) {
      const back = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.6, transparent: true, depthWrite: false }));
      back.scale.set(1.3, 0.2, 1);
      const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4caf50, depthWrite: false }));
      fill.center.set(0, 0.5);   // grows from the left
      back.visible = fill.visible = false;
      scene.add(back, fill);
      this.bars.push({ back, fill });
    }
  }

  // Where on the sidewalk square is this person? (s goes all the way around the block)
  walkTo(p) {
    const h = SIDE / 2;
    const s = ((p.s % (SIDE * 4)) + SIDE * 4) % (SIDE * 4);
    const side = Math.floor(s / SIDE), along = s - side * SIDE;
    const corners = [[-h, -h, 1, 0], [h, -h, 0, 1], [h, h, -1, 0], [-h, h, 0, -1]];
    const [x, z, dx, dz] = corners[side];
    p.position.set(p.bx + x + dx * along, 0.3, p.bz + z + dz * along);
    p.yaw = Math.atan2(-dx * p.dir, -dz * p.dir);
  }

  // Shooting or explosions close by: some people get angry and fight back, the others run away!
  scare(position, radius, byPlayer = false) {
    for (const p of this.people) {
      if (p.gone || p.state === 'down' || p.position.distanceTo(position) > radius) continue;
      if (byPlayer && !p.team && Math.random() < 0.35) p.angry = 15;
      else if (p.angry <= 0 && !p.team) { p.state = 'run'; p.timer = 6; }
    }
  }

  // Knocked over by a car: no damage, but they lie down for a moment
  trip(p) {
    if (p.state === 'down' || p.gone) return;
    p.state = 'down';
    p.timer = 4;
  }

  hurt(p, damage, byPlayer) {
    if (p.state === 'down' || p.gone) return;
    p.health -= damage;
    if (byPlayer) p.angry = Math.random() < 0.6 ? 20 : 0;   // "Hey! That hurt!"
    if (p.health <= 0) {
      p.state = 'down';
      p.timer = KNOCKED_OUT;
      p.angry = 0;
      this.game.dropCash(p.position.clone(), 20 + Math.floor(Math.random() * 40));
      this.scare(p.position, 25, byPlayer);
    } else if (!p.angry && !p.team) {
      p.state = 'run';
      p.timer = 6;
    }
  }

  // Did a bullet (moving from "from" to "to") hit somebody?
  bulletHits(from, to, byPlayer) {
    line.set(from, to);
    for (const p of this.people) {
      if (p.gone || p.state === 'down') continue;
      tmp.copy(p.position).setY(1);
      line.closestPointToPoint(tmp, true, closest);
      if (closest.distanceTo(tmp) < 0.9) {
        this.hurt(p, 1, byPlayer);
        return true;
      }
    }
    return false;
  }

  // An explosion knocks out everybody close by
  blast(position, radius) {
    for (const p of this.people) {
      if (!p.gone && p.position.distanceTo(position) < radius) this.hurt(p, HEALTH, false);
    }
    this.scare(position, radius * 3);
  }

  // ☢️ Everybody disappears
  wipe() {
    for (const p of this.people) p.gone = true;
  }

  bringBack() {
    for (const p of this.people) {
      p.gone = false;
      p.state = 'walk';
      p.health = HEALTH;
      p.angry = 0;
    }
  }

  // A blaster shot: a glowing bolt flies from one person to a target
  fire(p, target, targetIsPlayer) {
    const from = p.position.clone().setY(1.4);
    const to = target.clone().setY(target.y + 1.1);
    const mesh = new THREE.Mesh(this.boltShape, this.boltMaterials[p.team || 'none']);
    mesh.position.copy(from);
    mesh.lookAt(to);
    this.game.scene.add(mesh);
    this.bolts.push({ mesh, from, to, t: 0, duration: from.distanceTo(to) / 90, target, targetIsPlayer, hits: Math.random() < 0.45 });
    p.faceTarget = to;
    this.game.sounds.shoot(0.25 * Math.max(0, 1 - this.game.camera.position.distanceTo(from) / 200));
  }

  update(dt, time) {
    const player = this.game.player;
    const playerOnGround = ['walk', 'car'].includes(player.mode) && player.alive && !this.game.isInside;
    this.people.forEach((p, i) => {
      if (p.gone) {
        this.hide(i);
        return;
      }
      p.timer -= dt;
      p.angry = Math.max(0, p.angry - dt);
      if (p.state === 'down') {
        if (p.timer <= 0) { p.state = 'run'; p.timer = 6; p.health = HEALTH; }
      } else {
        if (p.state === 'run' && p.timer <= 0) p.state = 'walk';
        const speed = p.angry > 0 ? 0 : p.state === 'run' ? RUN : WALK;   // angry people stand and fight
        p.s += p.dir * speed * dt;
        p.step += dt * Math.max(speed, 0.01) * 2.2;
        this.walkTo(p);
        if (this.game.traffic.carAt(p.position, 2)) this.trip(p);
        this.think(p, dt, playerOnGround);
      }
      this.draw(p, i);
    });
    for (const mesh of [this.legs, this.arms, this.bodies, this.heads, this.guns]) mesh.instanceMatrix.needsUpdate = true;
    this.updateBolts(dt);
    this.updateBars();
  }

  // Who should I shoot at? Gang members shoot the other gang (and sometimes you).
  // Normal people only shoot at you if you made them angry.
  think(p, dt, playerOnGround) {
    p.shootTimer -= dt;
    if (p.shootTimer > 0) return;
    p.shootTimer = 0.9 + Math.random() * 1.2;
    p.faceTarget = null;
    let target = null, best = RANGE, isPlayer = false;
    if (p.team) {
      for (const other of this.people) {
        if (!other.team || other.team === p.team || other.gone || other.state === 'down') continue;
        const d = other.position.distanceTo(p.position);
        if (d < best) { best = d; target = other.position; }
      }
    }
    if (playerOnGround) {
      const me = this.game.player.mode === 'car' ? this.game.player.car.pos : this.game.player.pos;
      const d = me.distanceTo(p.position);
      if (p.angry > 0 && d < 45) { target = me; isPlayer = true; }
      else if (p.team && d < 25 && d < best && Math.random() < 0.5) { target = me; isPlayer = true; }
    }
    if (target) this.fire(p, target, isPlayer);
  }

  updateBolts(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt / b.duration;
      b.mesh.position.lerpVectors(b.from, b.to, Math.min(1, b.t));
      if (b.t < 1) continue;
      this.game.scene.remove(b.mesh);
      this.bolts.splice(i, 1);
      if (!b.hits) continue;
      if (b.targetIsPlayer) this.game.npcHitsMe(b.to, false);
      else {
        const victim = this.people.find((p) => p.position === b.target);
        if (victim) this.hurt(victim, 1, false);
      }
    }
  }

  // Show health bars over the closest people who are hurt, angry, or in a gang
  updateBars() {
    const camera = this.game.camera;
    cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const near = this.people
      .filter((p) => !p.gone && p.state !== 'down' && p.position.distanceTo(camera.position) < 60)
      .sort((a, b) => a.position.distanceTo(camera.position) - b.position.distanceTo(camera.position))
      .slice(0, BARS);
    this.bars.forEach((bar, i) => {
      const p = near[i];
      bar.back.visible = bar.fill.visible = !!p;
      if (!p) return;
      const part = p.health / HEALTH;
      bar.back.position.copy(p.position).setY(p.position.y + 2.4);
      bar.fill.position.copy(bar.back.position).addScaledVector(cameraRight, -0.6);
      bar.fill.scale.set(1.2 * part, 0.13, 1);
      bar.fill.material.color.setHex(p.angry > 0 ? 0xff1744 : part > 0.5 ? 0x4caf50 : 0xff9800);
    });
  }

  hide(i) {
    for (const [mesh, n] of [[this.legs, 2], [this.arms, 2], [this.bodies, 1], [this.heads, 1], [this.guns, 1]]) {
      for (let k = 0; k < n; k++) mesh.setMatrixAt(i * n + k, hidden);
    }
  }

  // Put all the body parts of person number i in the right place
  draw(p, i) {
    let yaw = p.yaw;
    if (p.faceTarget && p.state !== 'down') yaw = Math.atan2(-(p.faceTarget.x - p.position.x), -(p.faceTarget.z - p.position.z));
    m.makeRotationAxis(Y, yaw).setPosition(p.position);
    if (p.state === 'down') m.multiply(lie.makeRotationAxis(X, -Math.PI / 2)).multiply(part.makeTranslation(0, 0.15, 0));
    const moving = p.state !== 'down';
    const speedy = p.state === 'run' && !p.angry;
    const swing = moving && p.angry <= 0 ? Math.sin(p.step) * (speedy ? 0.8 : 0.4) : 0;
    const aiming = !!p.faceTarget && moving;
    const set = (mesh, index, x, y, z, angle) => {
      part.makeTranslation(x, y, z).multiply(turn.makeRotationAxis(X, angle));
      mesh.setMatrixAt(index, part.premultiply(m));
    };
    set(this.legs, i * 2, -0.13, 0.9, 0, swing);
    set(this.legs, i * 2 + 1, 0.13, 0.9, 0, -swing);
    set(this.arms, i * 2, -0.36, 1.55, 0, -swing);
    const gunArm = aiming ? 1.4 : swing;
    set(this.arms, i * 2 + 1, 0.36, 1.55, 0, gunArm);
    set(this.bodies, i, 0, 1.25, 0, 0);
    set(this.heads, i, 0, 1.82, 0, 0);
    // the blaster is in the right hand
    part.makeTranslation(0.36, 1.55, 0).multiply(turn.makeRotationAxis(X, gunArm)).multiply(lie.makeTranslation(0, -0.62, -0.18));
    this.guns.setMatrixAt(i, part.premultiply(m));
  }
}
