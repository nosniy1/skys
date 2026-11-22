// 🎁 POWER-UPS: spinning boxes in the sky. Fly through one to grab it!
// They are shared: whoever grabs a box first gets it. It comes back 20 seconds later somewhere else.
import * as THREE from 'three';

export const POWERUP_TYPES = {
  repair: { icon: '🔧', color: '#43a047', message: '🔧 REPAIRED!', seconds: 0 },
  speed:  { icon: '⚡', color: '#fbc02d', message: '⚡ SUPER SPEED!', seconds: 10 },
  triple: { icon: '🔱', color: '#fb8c00', message: '🔱 TRIPLE GUNS!', seconds: 15 },
  shield: { icon: '🛡️', color: '#1e88e5', message: '🛡️ SHIELD!', seconds: 10 },
};
const TYPE_NAMES = Object.keys(POWERUP_TYPES);
const COUNT = 10;
const GRAB_DISTANCE = 9;

// The picture on each side of a box
function boxMaterial(type) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = type.color;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'white';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 118, 118);
  g.font = '72px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(type.icon, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.4 });
}

export class PowerUps {
  constructor(game, randomNumber, savedState) {
    this.game = game;
    this.materials = {};
    for (const name of TYPE_NAMES) this.materials[name] = boxMaterial(POWERUP_TYPES[name]);
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const boxShape = new THREE.BoxGeometry(5, 5, 5);
    const ringShape = new THREE.TorusGeometry(5.5, 0.25, 8, 32);

    this.boxes = [];
    for (let i = 0; i < COUNT; i++) {
      const group = new THREE.Group();
      const box = new THREE.Mesh(boxShape, this.materials.repair);
      box.castShadow = true;
      const ring = new THREE.Mesh(ringShape, this.ringMaterial);
      group.add(box, ring);
      game.scene.add(group);
      const item = { id: i, v: 0, group, box, ring, type: 'repair', baseY: 0, wobble: Math.random() * 10 };
      this.place(item, this.spot(randomNumber)); // seeded: same boxes for everybody
      this.boxes.push(item);
    }
    // Boxes that changed before I joined
    for (const [id, state] of Object.entries(savedState)) {
      const item = this.boxes[id];
      item.v = state.v;
      if (state.visible) this.place(item, state);
      else item.group.visible = false;
    }
  }

  // A free spot in the sky, and a random kind of power-up
  spot(randomNumber) {
    const spread = this.game.world.citySize / 2;
    const p = new THREE.Vector3();
    do {
      p.set((randomNumber() * 2 - 1) * spread, 40 + randomNumber() * 140, (randomNumber() * 2 - 1) * spread);
    } while (this.game.world.hitsBuilding(p, 10));
    const type = TYPE_NAMES[Math.floor(randomNumber() * TYPE_NAMES.length)];
    return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), type };
  }

  place(item, spot) {
    item.type = spot.type;
    item.box.material = this.materials[spot.type];
    item.baseY = spot.y;
    item.group.position.set(spot.x, spot.y, spot.z);
    item.group.visible = true;
  }

  update(dt, time) {
    const player = this.game.player;
    for (const item of this.boxes) {
      if (!item.group.visible) continue;
      item.box.rotation.y += dt * 1.5;
      item.box.rotation.x += dt * 0.7;
      item.ring.rotation.x = Math.PI / 2 + Math.sin(time * 2 + item.wobble) * 0.3;
      item.group.position.y = item.baseY + Math.sin(time * 1.5 + item.wobble) * 1.5;
      if (player.alive && item.group.position.distanceTo(player.pos) < GRAB_DISTANCE) this.grab(item);
    }
  }

  grab(item) {
    item.group.visible = false;   // hide it now; the server decides if I was first
    this.game.network.send({ type: 'take', id: item.id, v: item.v, taken: item.type, next: this.spot(Math.random) });
  }

  // The server says a box was taken, or came back
  onMessage(msg) {
    const item = this.boxes[msg.id];
    item.v = msg.v;
    if (msg.visible) {
      this.place(item, msg);
    } else {
      item.group.visible = false;
      if (msg.takenBy === this.game.network.id) this.game.applyPowerUp(msg.taken);
    }
  }
}
