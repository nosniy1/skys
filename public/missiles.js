// 🚀 HOMING MISSILES: they lock onto a plane in front of you and chase it.
// A missile can't turn very fast, so a sharp turn at the right moment makes it miss!
import * as THREE from 'three';
import { makeMissile, PLANE_TYPES } from './plane.js';

const SPEED = 170;          // how fast missiles fly (faster than every plane!)
const TURN = 1.6;           // how fast missiles can turn
const LIFE = 7;             // seconds before a missile explodes by itself
const DAMAGE = 6;           // how many hits of damage a missile does
const LOCK_ANGLE = 0.7;     // how far to the side a plane can be and still get locked on
const LOCK_RANGE = 900;     // how far away a plane can be and still get locked on
export const MISSILE_DELAY = 4; // seconds between missiles

// 🤫 The SUPER missile (secret key K): faster than everything, turns instantly,
// finds a target anywhere, and you CAN'T escape it.
const SUPER = { speed: 280, turn: 50, life: 20, damage: 100 };

const aim = new THREE.Vector3();
const wanted = new THREE.Vector3();

export class Missiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.count = 0;
    this.model = makeMissile();
    this.beepTimer = 0;
  }

  // Which plane is in front of me? Gives back its id, or null.
  // (The super missile takes the closest one, anywhere.)
  findTarget(position, forward, superMissile = false) {
    let best = null;
    let bestAngle = superMissile ? Infinity : LOCK_ANGLE;
    let bestDistance = Infinity;
    for (const [id, other] of this.game.others) {
      if (!other.alive || !other.hasState) continue;
      const toOther = other.mesh.position.clone().sub(position);
      if (superMissile) {
        if (toOther.length() < bestDistance) { best = id; bestDistance = toOther.length(); }
        continue;
      }
      if (toOther.length() > LOCK_RANGE) continue;
      const angle = toOther.angleTo(forward);
      if (angle < bestAngle) {
        best = id;
        bestAngle = angle;
      }
    }
    return best;
  }

  fire(position, forward, superMissile = false) {
    const target = this.findTarget(position, forward, superMissile);
    const id = `${this.game.network.id}-${this.count++}`;
    this.add(id, position, forward, target, true, superMissile);
    this.game.sounds.missileLaunch();
    this.game.network.send({
      type: 'missile', missileId: id, target, super: superMissile,
      p: position.toArray().map(round), d: forward.toArray().map(round),
    });
  }

  // Somebody else fired a missile
  onRemoteMissile(msg) {
    this.add(msg.missileId, new THREE.Vector3().fromArray(msg.p), new THREE.Vector3().fromArray(msg.d), msg.target, false, !!msg.super);
    const distance = this.game.camera.position.distanceTo(new THREE.Vector3().fromArray(msg.p));
    this.game.sounds.missileLaunch(Math.max(0, 1 - distance / 800));
  }

  add(id, position, direction, target, mine, superMissile = false) {
    const mesh = this.model.clone();
    if (superMissile) {
      mesh.scale.setScalar(2.5);   // a big, scary, glowing red missile
      mesh.traverse((part) => {
        if (part.isMesh && !part.material.transparent) part.material = new THREE.MeshBasicMaterial({ color: 0xff1744 });
      });
    }
    mesh.position.copy(position);
    mesh.lookAt(aim.copy(position).add(direction));
    this.game.scene.add(mesh);
    this.list.push({ id, mesh, direction: direction.clone().normalize(), target, mine, super: superMissile,
                     life: superMissile ? SUPER.life : LIFE, smokeTimer: 0 });
  }

  targetPosition(target) {
    if (target === this.game.network.id) return this.game.player.alive ? this.game.player.pos : null;
    const other = this.game.others.get(target);
    return other && other.alive && other.hasState ? other.mesh.position : null;
  }

  hitSizeOf(target) {
    const type = target === this.game.network.id ? this.game.myType : this.game.others.get(target)?.info.plane;
    return PLANE_TYPES[type] ? PLANE_TYPES[type].hitSize + 1.5 : 6;
  }

  update(dt) {
    let chasingMe = false, superChasingMe = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      const p = m.mesh.position;
      const goal = m.target !== null ? this.targetPosition(m.target) : null;

      // Steer toward the target, but only a little bit each frame
      if (goal) {
        wanted.copy(goal).sub(p).normalize();
        const angle = m.direction.angleTo(wanted);
        const turn = m.super ? SUPER.turn : TURN;
        if (angle > 0.0001) m.direction.lerp(wanted, Math.min(1, (turn * dt) / angle)).normalize();
        if (m.target === this.game.network.id) {
          chasingMe = true;
          if (m.super) superChasingMe = true;
        }
      }
      p.addScaledVector(m.direction, (m.super ? SUPER.speed : SPEED) * dt);
      m.mesh.lookAt(aim.copy(p).add(m.direction));
      m.life -= dt;

      // Smoke trail
      m.smokeTimer -= dt;
      if (m.smokeTimer <= 0) {
        m.smokeTimer = m.super ? 0.02 : 0.04;
        this.game.effects.trail(p);
        if (m.super) this.game.effects.burst(p, 0xff1744, 1, 3, 0.6, true);
      }

      // Did it hit something?
      // (the super missile flies right through buildings!)
      let boom = m.life <= 0 || p.y <= 0.5 || (!m.super && this.game.world.hitsBuilding(p, 0));
      let hitPlane = null;
      if (goal && goal.distanceTo(p) < this.hitSizeOf(m.target)) {
        boom = true;
        hitPlane = m.target;
      } else if (m.mine) {
        for (const [id, other] of this.game.others) {
          if (other.alive && other.hasState && other.mesh.position.distanceTo(p) < this.hitSizeOf(id)) {
            boom = true;
            hitPlane = id;
          }
        }
      }
      if (boom) this.explode(i, p.clone(), hitPlane);
    }

    // Warning beeps when a missile is chasing ME
    this.game.showMissileWarning(chasingMe, superChasingMe);
    this.beepTimer -= dt;
    if (chasingMe && this.beepTimer <= 0) {
      this.beepTimer = 0.3;
      this.game.sounds.beep(1400, 0.08);
    }
  }

  explode(index, position, hitPlane) {
    const m = this.list[index];
    this.game.scene.remove(m.mesh);
    this.list.splice(index, 1);
    this.game.bigBang(position, m.super ? 1.5 : 0.5, position.y < 1 ? 0 : null, false);
    if (m.mine) {
      this.game.network.send({ type: 'missileBoom', missileId: m.id, p: position.toArray().map(round) });
      if (hitPlane !== null && hitPlane !== this.game.network.id) {
        this.game.network.send({ type: 'hit', target: hitPlane, damage: m.super ? SUPER.damage : DAMAGE, unstoppable: m.super });
      }
      this.game.damageBuildings(position, [[12, 1]]);
      this.game.popBalloonsNear(position, 15);
    }
  }

  // The owner says their missile exploded here
  onRemoteBoom(msg) {
    const index = this.list.findIndex((m) => m.id === msg.missileId);
    if (index >= 0) this.explode(index, new THREE.Vector3().fromArray(msg.p), null);
  }

  // Remove everything (when a new round starts)
  clear() {
    for (const m of this.list) this.game.scene.remove(m.mesh);
    this.list.length = 0;
  }
}

const round = (n) => Math.round(n * 100) / 100;
