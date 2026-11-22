// 💰 ROBBING: walk up to a door 🚪 and press E. The door opens and you sneak inside!
// Grab the cash, then go back to the door and press E to get out... and RUN from the police 🚓!
// There's also cash lying around the city 💵.
import * as THREE from 'three';
import { Doors } from './doors.js';
import { Interiors, ROOMS } from './interiors.js';

const PICKUPS = 70;                 // bundles of cash lying around
const PICKUP_RETURN_SECONDS = 60;

function cashPicture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#2e7d32';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#a5d6a7';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 116, 52);
  g.fillStyle = '#e8f5e9';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('$', 64, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Robbery {
  constructor(game) {
    this.game = game;
    this.robbed = new Set();   // buildings I already robbed this round
    this.pickups = [];
    this.shape = new THREE.BoxGeometry(1.4, 0.45, 0.8);
    this.material = new THREE.MeshStandardMaterial({ map: cashPicture(), emissive: 0x1b5e20, roughness: 0.6 });
    this.doors = new Doors(game.scene, game.world);
    this.inside = new Interiors(game, this.material, this.shape);
    this.outsideSpot = new THREE.Vector3();
    const world = game.world;
    const blocks = Math.round(world.citySize / 60);
    for (let i = 0; i < PICKUPS; i++) {
      const bx = (Math.floor(Math.random() * blocks) - blocks / 2 + 0.5) * 60;
      const bz = (Math.floor(Math.random() * blocks) - blocks / 2 + 0.5) * 60;
      const along = (Math.random() - 0.5) * 40, side = Math.random() < 0.5 ? -21.5 : 21.5;
      const spot = Math.random() < 0.5 ? new THREE.Vector3(bx + along, 0.9, bz + side) : new THREE.Vector3(bx + side, 0.9, bz + along);
      this.addPickup(spot, 50 + Math.floor(Math.random() * 100), true);
    }
  }

  addPickup(position, amount, comesBack) {
    const mesh = new THREE.Mesh(this.shape, this.material);
    mesh.position.copy(position);
    mesh.position.y = Math.max(mesh.position.y, 0.9);
    mesh.castShadow = true;
    this.game.scene.add(mesh);
    this.pickups.push({ mesh, amount, comesBack, respawn: 0 });
  }

  // Somebody was knocked out and dropped their cash
  drop(position, amount) {
    this.addPickup(position.clone().add(new THREE.Vector3(0.8, 0, 0)), amount, false);
  }

  // Am I inside a building right now?
  get isInside() {
    return this.inside.isInside();
  }

  // Where am I "really"? (when I'm inside, it's in front of the door)
  get outside() {
    return this.isInside ? this.outsideSpot : null;
  }

  // The words at the bottom of the screen
  tip() {
    const player = this.game.player;
    if (this.isInside) {
      return this.inside.nearExit(player.pos)
        ? '🚪 Press E to get out... then RUN from the police! 🚓'
        : '💰 Grab the cash! Then go back to the door with the green EXIT sign 🚪';
    }
    if (player.mode !== 'walk') return null;
    const door = this.doors.nearest(player.pos);
    if (!door) return null;
    if (this.robbed.has(door.structure.id)) return '🚪 You already robbed this one. Try another building!';
    return `🚪 Press E to open the door and sneak into this ${ROOMS[door.kind].name}!`;
  }

  // Press E: go in through a door, or go out again
  start() {
    const game = this.game;
    const player = game.player;
    if (this.isInside) {
      if (!this.inside.nearExit(player.pos)) {
        game.showMessage('🚪 Go to the door with the green EXIT sign', 1.5);
        return;
      }
      this.goOut();
      return;
    }
    const door = this.doors.nearest(player.pos);
    if (!door) {
      game.showMessage('Walk right up to a door 🚪 and press E', 1.5);
      return;
    }
    if (this.robbed.has(door.structure.id)) {
      game.showMessage('This one is empty, you already robbed it!', 1.5);
      return;
    }
    // Open the door and sneak in!
    this.doors.setOpen(door, true);
    game.sounds.creak();
    this.outsideSpot.copy(door.center).addScaledVector(door.normal, 2.5);
    this.outsideSpot.y = 0.3;
    const spot = this.inside.enter(door);
    player.pos.copy(spot);
    player.heading = 0;
    player.vy = 0;
    game.flashScreen(1, '#000000', 0.6);
    game.weather.indoors = true;
    if (door.kind === 'bank') {
      // The bank has an alarm: the police come right away!
      game.sounds.alarm();
      game.police.crime(ROOMS.bank.stars);
      game.showMessage('🔔 THE ALARM IS RINGING! Grab the money, FAST!', 3);
    } else {
      game.showMessage(`🤫 You sneaked into the ${ROOMS[door.kind].name}...`, 2);
    }
  }

  goOut() {
    const game = this.game;
    const { door, info } = this.inside.leave();
    this.robbed.add(door.structure.id);
    this.doors.setOpen(door, false);
    game.sounds.creak();
    game.player.pos.copy(this.outsideSpot);
    game.player.heading = Math.atan2(-door.normal.x, -door.normal.z) + Math.PI;
    game.flashScreen(1, '#000000', 0.6);
    game.weather.indoors = false;
    game.police.crime(info.stars);
    game.showMessage('🚓 Here comes the police! RUN!', 2.5);
  }

  // Knocked out or a new round while inside: get out of there
  kickOut() {
    if (!this.isInside) return;
    const { door } = this.inside.leave();
    this.doors.setOpen(door, false);
    this.game.weather.indoors = false;
  }

  update(dt, time) {
    const game = this.game;
    const player = game.player;

    this.doors.update(dt);
    if (this.isInside) this.inside.update(dt, time, player.pos);

    // Cash on the ground: spin, and pick it up when I walk (or drive) over it
    const me = player.mode === 'car' ? player.car.pos : player.pos;
    const onGround = (player.mode === 'walk' || player.mode === 'car') && player.alive;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const c = this.pickups[i];
      if (!c.mesh.visible) {
        c.respawn -= dt;
        if (c.respawn <= 0) c.mesh.visible = true;
        continue;
      }
      c.mesh.rotation.y += dt * 2;
      c.mesh.position.y = 0.9 + Math.sin(time * 3 + i) * 0.2;
      if (onGround && Math.hypot(c.mesh.position.x - me.x, c.mesh.position.z - me.z) < (player.mode === 'car' ? 4 : 2) && me.y < 4) {
        game.giveCash(c.amount);
        game.showMessage(`💵 +$${c.amount}`, 1);
        game.effects.burst(c.mesh.position, 0x66bb6a, 8, 6, 0.3, true);
        if (c.comesBack) {
          c.mesh.visible = false;
          c.respawn = PICKUP_RETURN_SECONDS;
        } else {
          game.scene.remove(c.mesh);
          this.pickups.splice(i, 1);
        }
      }
    }
  }

  // A new round: everything can be robbed again
  reset() {
    this.robbed.clear();
    this.kickOut();
  }
}
