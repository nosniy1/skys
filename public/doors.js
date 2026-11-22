// 🚪 DOORS: every house, shop, building and the bank has a door facing the street.
// Walk up to a door and press E: it swings open and you sneak inside!
// (All the doors are drawn with "instancing", so thousands of doors stay fast.)
import * as THREE from 'three';

const BLOCK = 60;
export const DOOR_KINDS = ['house', 'shop', 'building', 'tower', 'factory', 'bank'];
const DOOR_COLORS = [0x6d4c41, 0x8d6e63, 0xc62828, 0x1565c0, 0x2e7d32, 0x37474f, 0xf9a825];

const panel = new THREE.BoxGeometry(1.3, 2.3, 0.12).translate(0.65, 1.15, 0); // the hinge is on the left edge
const frame = new THREE.BoxGeometry(1.7, 2.6, 0.08).translate(0, 1.3, 0);
const UP = new THREE.Vector3(0, 1, 0);
const m = new THREE.Matrix4(), r = new THREE.Matrix4(), s = new THREE.Matrix4();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class Doors {
  constructor(scene, world) {
    this.world = world;
    this.list = [];
    const half = world.citySize / 2;
    for (const st of world.structures) {
      if (!DOOR_KINDS.includes(st.kind) || !st.collides.length) continue;
      const box = st.collides[0];   // the main part of the building
      const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
      // Which side faces the street? The side away from the middle of the block.
      let nx = 0, nz = 0;
      if (st.kind === 'bank') nz = -1;     // the bank's door is at the front, between the columns
      else {
        const bx = Math.floor((cx + half) / BLOCK) * BLOCK - half + BLOCK / 2;
        const bz = Math.floor((cz + half) / BLOCK) * BLOCK - half + BLOCK / 2;
        if (Math.abs(cx - bx) > Math.abs(cz - bz)) nx = Math.sign(cx - bx) || 1;
        else nz = Math.sign(cz - bz) || 1;
      }
      const reach = st.round ? st.round : nx ? (box.maxX - box.minX) / 2 : (box.maxZ - box.minZ) / 2;
      const center = new THREE.Vector3(cx + nx * (reach + 0.06), 0.25, cz + nz * (reach + 0.06));
      const yaw = Math.atan2(nx, nz);           // turns the door to face the street
      const size = st.kind === 'bank' ? 2 : st.kind === 'tower' || st.kind === 'factory' ? 1.4 : 1;
      this.list.push({
        structure: st, kind: st.kind, center, normal: new THREE.Vector3(nx, 0, nz), yaw, size,
        open: 0, wantOpen: 0, color: st.kind === 'bank' ? 0xffc107 : DOOR_COLORS[this.list.length % DOOR_COLORS.length],
      });
    }

    this.panels = new THREE.InstancedMesh(panel, new THREE.MeshLambertMaterial(), this.list.length);
    this.frames = new THREE.InstancedMesh(frame, new THREE.MeshLambertMaterial({ color: 0xeeeeee }), this.list.length);
    const color = new THREE.Color();
    this.list.forEach((door, i) => {
      this.panels.setColorAt(i, color.setHex(door.color));
      this.place(i);
    });
    this.panels.castShadow = true;
    scene.add(this.panels, this.frames);
    this.timer = 0;
  }

  // Put door number i in the right place (opened a little or a lot)
  place(i) {
    const door = this.list[i];
    if (door.structure.destroyed) {
      this.panels.setMatrixAt(i, hidden);
      this.frames.setMatrixAt(i, hidden);
      return;
    }
    s.makeScale(door.size, door.size, 1);
    m.makeRotationAxis(UP, door.yaw).setPosition(door.center).multiply(s);
    this.frames.setMatrixAt(i, m);
    // the panel turns around its hinge (on the left edge)
    const hinge = new THREE.Vector3(-0.65 * door.size, 0, 0.04).applyAxisAngle(UP, door.yaw).add(door.center);
    m.makeRotationAxis(UP, door.yaw + door.open * 1.7).setPosition(hinge).multiply(s);
    this.panels.setMatrixAt(i, m);
  }

  // The closest door within reach, or null
  nearest(position, reach = 3) {
    let best = null, bestDistance = reach;
    for (const door of this.list) {
      if (door.structure.destroyed) continue;
      const d = Math.hypot(door.center.x - position.x, door.center.z - position.z);
      if (d < bestDistance && Math.abs(position.y - door.center.y) < 3) { best = door; bestDistance = d; }
    }
    return best;
  }

  setOpen(door, open) {
    door.wantOpen = open ? 1 : 0;
  }

  update(dt) {
    let changed = false;
    this.list.forEach((door, i) => {
      if (door.open !== door.wantOpen) {
        door.open = THREE.MathUtils.clamp(door.open + (door.wantOpen ? 2 : -2) * dt, 0, 1);
        this.place(i);
        changed = true;
      }
    });
    // Now and then, hide the doors of buildings that fell down (or show them again)
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1;
      this.list.forEach((door, i) => this.place(i));
      changed = true;
    }
    if (changed) {
      this.panels.instanceMatrix.needsUpdate = true;
      this.frames.instanceMatrix.needsUpdate = true;
    }
  }
}
