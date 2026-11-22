// 🏠 INSIDE THE BUILDINGS: rooms with furniture and cash to grab!
// The rooms are built once, hidden far below the city. When you go through a door,
// you are moved into the right room. Go back to the door and press E to get out.
import * as THREE from 'three';

const DEEP = -300;   // the rooms are 300 meters under the ground, where nobody can see them

// What kind of room for each kind of building, and how much money is inside: [least $, most $, piles, wanted stars]
const ROOMS = {
  house:    { room: 'house', loot: [200, 400, 4], stars: 1, name: '🏠 house' },
  shop:     { room: 'shop', loot: [300, 600, 4], stars: 1, name: '🏪 shop' },
  building: { room: 'office', loot: [400, 900, 5], stars: 2, name: '🏢 office' },
  factory:  { room: 'office', loot: [500, 900, 5], stars: 2, name: '🏭 factory office' },
  tower:    { room: 'office', loot: [800, 1500, 6], stars: 2, name: '🏙️ skyscraper office' },
  bank:     { room: 'bank', loot: [3000, 6000, 10], stars: 4, name: '🏦 BANK VAULT' },
};

function exitSign() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const g = canvas.getContext('2d');
  g.fillStyle = '#1b5e20';
  g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#b9f6ca';
  g.font = 'bold 32px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EXIT', 64, 25);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture });
}

export class Interiors {
  constructor(game, cashMaterial, cashShape) {
    this.game = game;
    this.cashMaterial = cashMaterial;
    this.cashShape = cashShape;
    this.loot = [];
    this.current = null;     // the room I'm in right now (or null)
    this.light = new THREE.PointLight(0xfff3d6, 0, 30, 1);
    game.scene.add(this.light);
    this.rooms = {
      house: this.build('house', 0, 16, 11, 3.2, 0xf3e5ab, 0x8d6e63),
      shop: this.build('shop', 60, 18, 12, 3.6, 0xe3f2fd, 0xbdbdbd),
      office: this.build('office', 120, 20, 14, 3.4, 0xeceff1, 0x546e7a),
      bank: this.build('bank', 180, 22, 16, 5, 0x9e9e9e, 0x424242),
    };
  }

  // Build a room: floor, walls, ceiling, a door with an EXIT sign, and furniture
  build(type, x, width, depth, height, wallColor, floorColor) {
    const room = new THREE.Group();
    room.position.set(x, DEEP, 0);
    const material = (color) => new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    const box = (w, h, d, color, bx, by, bz, parent = room) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
      mesh.position.set(bx, by + h / 2, bz);
      parent.add(mesh);
      return mesh;
    };
    box(width, 0.2, depth, floorColor, 0, -0.2, 0);                     // floor
    box(width, 0.2, depth, 0xd7ccc8, 0, height, 0);                     // ceiling
    box(width, height, 0.2, wallColor, 0, 0, -depth / 2);               // walls
    box(width, height, 0.2, wallColor, 0, 0, depth / 2);
    box(0.2, height, depth, wallColor, -width / 2, 0, 0);
    box(0.2, height, depth, wallColor, width / 2, 0, 0);
    // The way out: a door in the wall at the back (+z), with a green EXIT sign
    box(1.4, 2.4, 0.1, 0x6d4c41, 0, 0, depth / 2 - 0.12);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.45), exitSign());
    sign.position.set(0, 2.8, depth / 2 - 0.15);
    sign.rotation.y = Math.PI;
    room.add(sign);

    const f = (w, h, d, color, fx, fz, fy = 0) => box(w, h, d, color, fx, fy, fz);
    if (type === 'house') {
      f(3.5, 0.9, 1.2, 0x5c6bc0, -4, -4.3);            // sofa
      f(3.5, 0.8, 0.3, 0x3949ab, -4, -4.9, 0.9);        // sofa back
      f(2.2, 0.5, 1.2, 0x8d6e63, -4, -2.4);             // coffee table
      f(2.6, 1.6, 0.2, 0x111111, -4, 1.0, 0.9);         // TV
      f(1.5, 0.9, 0.6, 0x5d4037, -4, 1.2);              // TV table
      f(3, 0.6, 4, 0xe57373, 5, -2.5);                  // bed
      f(3, 0.3, 1, 0xffffff, 5, -4.2, 0.6);             // pillow
      f(1.2, 2.2, 1, 0xeceff1, 6.8, 3.8);               // fridge
      f(2.5, 0.9, 1.5, 0xa1887f, 1.5, 2.5);             // dining table
      f(1.5, 0.1, 2, 0x4caf50, -6.5, 3);                // rug
    } else if (type === 'shop') {
      for (let row = -1; row <= 1; row++) {
        f(10, 1.8, 0.8, 0xbcaaa4, -1, row * 3.2);       // shelves
        for (let k = 0; k < 9; k++) {
          const colors = [0xef5350, 0xffee58, 0x66bb6a, 0x42a5f5, 0xab47bc, 0xff7043];
          f(0.7, 0.5, 0.5, colors[(k + row + 3) % colors.length], -5.5 + k * 1.1, row * 3.2, 1.85);
        }
      }
      f(1.5, 1.1, 4, 0x795548, 7.5, 2.5);               // counter
      f(0.7, 0.5, 0.6, 0x424242, 7.5, 1.5, 1.1);        // cash register
    } else if (type === 'office') {
      for (const [dx, dz] of [[-6, -4], [-1, -4], [4, -4], [-6, 1], [-1, 1], [4, 1]]) {
        f(2.4, 0.8, 1.2, 0x8d6e63, dx, dz);              // desk
        f(0.8, 0.6, 0.1, 0x212121, dx, dz - 0.3, 0.8);   // computer screen
        f(0.6, 0.9, 0.6, 0x37474f, dx, dz + 1);          // chair
      }
      for (let k = 0; k < 4; k++) f(0.8, 1.4, 0.6, 0x90a4ae, -9 + k * 0.9, -6.4); // filing cabinets
      f(1.4, 1.4, 1.2, 0x263238, 8.5, -5.5);             // safe
    } else if (type === 'bank') {
      // The big round vault door, standing open
      const vault = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.6, 32), new THREE.MeshStandardMaterial({ color: 0xb0bec5, metalness: 0.8, roughness: 0.3 }));
      vault.rotation.set(Math.PI / 2, 0, 0);
      vault.rotation.z = 0;
      vault.position.set(-8, 2.8, -7.2);
      room.add(vault);
      // Gold bars and safe-deposit boxes
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc107, metalness: 0.6, roughness: 0.3, emissive: 0x6a4a00 });
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          for (let k = 0; k < 3 - j; k++) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.4), gold);
            bar.position.set(3 + i * 2 + k * 0.5, 0.15 + j * 0.3, -5.5 + (j % 2) * 0.2);
            room.add(bar);
          }
        }
      }
      for (let i = 0; i < 10; i++) for (let j = 0; j < 4; j++) f(0.9, 0.7, 0.2, 0x9e9e9e, -10 + i * 1.0 + 1, -7.85, 0.3 + j * 0.85); // deposit boxes
      f(14, 0.9, 1, 0x5d4037, 2, 4);                     // counter
    }
    room.traverse((part) => { part.castShadow = false; part.receiveShadow = false; });
    room.userData = { width, depth, height, exit: new THREE.Vector3(x, DEEP, depth / 2 - 1.2) };
    this.game.scene.add(room);
    return room;
  }

  isInside() {
    return this.current !== null;
  }

  // Walk through a door into the room
  enter(door) {
    const info = ROOMS[door.kind];
    const room = this.rooms[info.room];
    const { width, depth, exit } = room.userData;
    this.current = { door, info, room };
    // Put piles of cash around the room
    const [low, high, piles] = info.loot;
    let total = Math.round((low + Math.random() * (high - low)) / 10) * 10;
    for (let i = 0; i < piles; i++) {
      const amount = i === piles - 1 ? total : Math.round(total / (piles - i) / 10) * 10;
      total -= amount;
      const mesh = new THREE.Mesh(this.cashShape, this.cashMaterial);
      mesh.position.set(exit.x + (Math.random() - 0.5) * (width - 3), DEEP + 0.8, (Math.random() - 0.5) * (depth - 4) - 1);
      this.game.scene.add(mesh);
      this.loot.push({ mesh, amount });
    }
    this.light.position.set(exit.x, DEEP + room.userData.height - 0.5, 0);
    this.light.intensity = 14;
    return exit.clone().setY(DEEP + 0.02).add(new THREE.Vector3(0, 0, -1));
  }

  // Leave the room: gives back the money that is still lying there
  leave() {
    for (const l of this.loot) this.game.scene.remove(l.mesh);
    this.loot.length = 0;
    this.light.intensity = 0;
    const was = this.current;
    this.current = null;
    return was;
  }

  nearExit(position) {
    return this.current && position.distanceTo(this.current.room.userData.exit) < 2.5;
  }

  // Keep me inside the walls
  keepInside(position) {
    const { width, depth } = this.current.room.userData;
    const x0 = this.current.room.position.x;
    position.x = THREE.MathUtils.clamp(position.x, x0 - width / 2 + 0.5, x0 + width / 2 - 0.5);
    position.z = THREE.MathUtils.clamp(position.z, -depth / 2 + 0.5, depth / 2 - 0.5);
    position.y = DEEP + 0.02;
  }

  // Keep the camera inside the walls too
  keepCameraInside(position) {
    const { width, depth, height } = this.current.room.userData;
    const x0 = this.current.room.position.x;
    position.x = THREE.MathUtils.clamp(position.x, x0 - width / 2 + 0.3, x0 + width / 2 - 0.3);
    position.z = THREE.MathUtils.clamp(position.z, -depth / 2 + 0.3, depth / 2 - 0.3);
    position.y = THREE.MathUtils.clamp(position.y, DEEP + 0.5, DEEP + height - 0.3);
  }

  update(dt, time, position) {
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      l.mesh.rotation.y += dt * 2;
      l.mesh.position.y = DEEP + 0.8 + Math.sin(time * 3 + i) * 0.15;
      if (Math.hypot(l.mesh.position.x - position.x, l.mesh.position.z - position.z) < 1.6) {
        this.game.giveCash(l.amount);
        this.game.showMessage(`💵 +$${l.amount}`, 1);
        this.game.scene.remove(l.mesh);
        this.loot.splice(i, 1);
      }
    }
  }
}

export { ROOMS };
