// 👾 ROBOTS: computer-controlled enemy planes that chase and shoot the players.
// Only ONE computer moves the robots (the server picks it: the "robot owner").
// It tells everybody else where the robots are, just like a real player does.
import * as THREE from 'three';

const SPEED = 45;          // how fast robots fly
const TURN = 0.9;          // how fast robots can turn
const SHOOT_RANGE = 450;   // how close you must be before a robot shoots at you
const SHOOT_DELAY = 0.25;  // seconds between robot bullets
const COME_BACK = 15;      // seconds before a shot-down robot comes back

const UP = new THREE.Vector3(0, 1, 0);
const wanted = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const probe = new THREE.Vector3();
const look = new THREE.Matrix4();
const quat = new THREE.Quaternion();

export class Robots {
  constructor(game) {
    this.game = game;
    this.sims = new Map();
    this.sendTimer = 0;
  }

  get amOwner() {
    return this.game.robotOwner === this.game.network.id;
  }

  // Robots come into the game from far away, high in the sky
  spawnPosition() {
    const angle = Math.random() * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * 900, 220 + Math.random() * 80, Math.sin(angle) * 900);
  }

  // The closest player that can be attacked
  findTarget(position) {
    let best = null, bestDistance = Infinity;
    const consider = (p) => {
      const d = p.distanceTo(position);
      if (d < bestDistance) { best = p; bestDistance = d; }
    };
    if (this.game.iCanBeHit()) consider(this.game.player.pos);
    for (const other of this.game.others.values()) {
      if (!other.info.robot && other.alive && other.hasState) consider(other.mesh.position);
    }
    return best;
  }

  onKilled(id) {
    const sim = this.sims.get(id);
    if (sim) {
      sim.alive = false;
      sim.comeBack = COME_BACK;
    }
  }

  update(dt) {
    if (!this.amOwner) {
      this.sims.clear();
      return;
    }
    this.sendTimer -= dt;
    const sendNow = this.sendTimer <= 0;
    if (sendNow) this.sendTimer = 0.08;

    for (const info of this.game.playerList) {
      if (!info.robot) continue;
      let sim = this.sims.get(info.id);
      if (!sim) {
        // I just became the robot owner: start from where the robot is now
        const other = this.game.others.get(info.id);
        const showing = other && other.hasState && other.alive;
        sim = {
          pos: showing ? other.mesh.position.clone() : this.spawnPosition(),
          dir: new THREE.Vector3(0, 0, -1),
          alive: !!showing, comeBack: showing ? 0 : 2, shootTimer: 0, wander: Math.random() * 6,
        };
        this.sims.set(info.id, sim);
      }

      if (!sim.alive) {
        sim.comeBack -= dt;
        if (sim.comeBack <= 0) {
          sim.alive = true;
          sim.pos = this.spawnPosition();
          sim.dir.set(-sim.pos.x, 0, -sim.pos.z).normalize();
        }
      } else {
        this.fly(info.id, sim, dt);
      }

      // Show the robot on my screen, and tell everybody else
      look.lookAt(sim.pos, probe.copy(sim.pos).add(sim.dir), UP);
      quat.setFromRotationMatrix(look);
      const state = {
        type: 'state', robot: info.id, p: sim.pos.toArray().map((n) => Math.round(n * 100) / 100),
        q: quat.toArray().map((n) => Math.round(n * 1000) / 1000), speed: SPEED, alive: sim.alive, mode: 'plane',
      };
      this.game.onOtherState({ ...state, id: info.id });
      if (sendNow) this.game.network.send(state);
    }
  }

  fly(id, sim, dt) {
    const world = this.game.world;
    const target = this.findTarget(sim.pos);
    if (target) {
      wanted.copy(target).sub(sim.pos).normalize();
    } else {
      sim.wander += dt * 0.2;          // nobody to chase: fly around in circles
      wanted.set(Math.cos(sim.wander), 0, Math.sin(sim.wander));
    }
    // Don't fly into the ground or into buildings!
    if (sim.pos.y < 70) wanted.y = Math.max(wanted.y, 0.5);
    probe.copy(sim.pos).addScaledVector(sim.dir, 45);
    if (world.hitsBuilding(probe, 8) || probe.y < 15) wanted.set(sim.dir.x, 1.2, sim.dir.z).normalize();

    const angle = sim.dir.angleTo(wanted);
    if (angle > 0.0001) sim.dir.lerp(wanted, Math.min(1, (TURN * dt) / angle)).normalize();
    sim.pos.addScaledVector(sim.dir, SPEED * dt);
    if (sim.pos.y > 380) sim.pos.y = 380;

    // Crash?
    if (sim.pos.y < 2 || world.hitsBuilding(sim.pos, 1)) {
      sim.alive = false;
      sim.comeBack = COME_BACK;
      return;
    }

    // Shoot when a player is right in front
    sim.shootTimer -= dt;
    if (target && sim.shootTimer <= 0) {
      toTarget.copy(target).sub(sim.pos);
      if (toTarget.length() < SHOOT_RANGE && sim.dir.angleTo(toTarget) < 0.12) {
        sim.shootTimer = SHOOT_DELAY;
        this.game.robotShoot(id, sim.pos.clone().addScaledVector(sim.dir, 4), sim.dir);
      }
    }
  }
}
