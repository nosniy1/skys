// 💥 EFFECTS: explosions, fire, smoke, flying pieces and burn marks
import * as THREE from 'three';

const pieceShape = new THREE.BoxGeometry(1, 1, 1);
const ballShape = new THREE.SphereGeometry(1, 20, 14);
const smokeShape = new THREE.IcosahedronGeometry(1, 1);
const ringShape = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
const scorchShape = new THREE.CircleGeometry(9, 24).rotateX(-Math.PI / 2);

// Starts fast, then slows down: nice for things that grow quickly
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.scorches = [];
    // One orange light that lights up the buildings around an explosion
    this.light = new THREE.PointLight(0xff8a33, 0, 0, 2);
    this.lightPower = 0;
    scene.add(this.light);
  }

  // Adds something that changes over time and then disappears.
  // "change" gets t, which goes from 0 (just started) to 1 (finished).
  add(mesh, seconds, change) {
    this.scene.add(mesh);
    this.items.push({ mesh, seconds, age: 0, change });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.age += dt;
      const t = item.age / item.seconds;
      if (t >= 1) {
        this.scene.remove(item.mesh);
        item.mesh.material.dispose();
        this.items.splice(i, 1);
      } else {
        item.change(t, dt, item.mesh);
      }
    }
    this.lightPower *= Math.exp(-dt * 5);
    this.light.intensity = this.lightPower;
  }

  // Lots of little pieces flying away. "glow" pieces are bright like fire.
  burst(position, color, count, power, size, glow = false) {
    for (let i = 0; i < count; i++) {
      const material = glow ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(pieceShape, material);
      mesh.position.copy(position);
      const pieceSize = size * (0.4 + Math.random());
      mesh.scale.setScalar(pieceSize);
      const velocity = new THREE.Vector3().randomDirection().multiplyScalar(power * (0.3 + Math.random()));
      velocity.y = Math.abs(velocity.y) * 1.2;
      const spin = new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0);
      this.add(mesh, 1 + Math.random() * 1.5, (t, dt, m) => {
        velocity.y -= 35 * dt; // gravity
        m.position.addScaledVector(velocity, dt);
        if (m.position.y < 0.3) {                  // bounce on the ground
          m.position.y = 0.3;
          velocity.set(velocity.x * 0.4, Math.abs(velocity.y) * 0.3, velocity.z * 0.4);
        }
        m.rotation.x += spin.x * dt;
        m.rotation.y += spin.y * dt;
        m.scale.setScalar(pieceSize * (glow ? 1 - t : 1 - t * 0.4));
      });
    }
  }

  // A big explosion! size 1 = bomb. surfaceY = height of the ground or roof (or null if in the air).
  explosion(position, size = 1, surfaceY = null) {
    const s = size;

    // Fireballs
    const fireball = (offset, color, maxSize, seconds) => {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(ballShape, material);
      mesh.position.copy(position).add(offset);
      const start = new THREE.Color(color), end = new THREE.Color(0x5a1a00);
      this.add(mesh, seconds, (t, dt, m) => {
        m.scale.setScalar(s * (1 + maxSize * easeOut(t)));
        m.material.opacity = 1 - t * t;
        m.material.color.lerpColors(start, end, t);
        m.position.y += dt * 6 * s;
      });
    };
    fireball(new THREE.Vector3(), 0xff7a1a, 22, 1.2);
    fireball(new THREE.Vector3(), 0xfff3b0, 12, 0.5);
    for (let i = 0; i < 4; i++) {
      const offset = new THREE.Vector3().randomDirection().multiplyScalar(7 * s);
      offset.y = Math.abs(offset.y);
      fireball(offset, 0xffa000, 10 + Math.random() * 6, 0.8 + Math.random() * 0.5);
    }

    // Shock wave ring on the ground
    if (surfaceY !== null) {
      const ring = new THREE.Mesh(ringShape,
        new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      ring.position.set(position.x, surfaceY + 0.5, position.z);
      this.add(ring, 0.9, (t, dt, m) => {
        m.scale.setScalar(s * (2 + 70 * easeOut(t)));
        m.material.opacity = 0.8 * (1 - t);
      });
    }

    // Flying pieces: dirt, fire and sparks
    this.burst(position, 0x3e2723, Math.round(25 * s), 55 * s, 1.4 * s);
    this.burst(position, 0xff9100, Math.round(30 * s), 50 * s, 1.0 * s, true);
    this.burst(position, 0xffea00, Math.round(20 * s), 40 * s, 0.7 * s, true);

    // Big clouds of smoke going up
    for (let i = 0; i < Math.round(14 * s); i++) {
      const gray = 0x40 + Math.floor(Math.random() * 0x40);
      const material = new THREE.MeshLambertMaterial({
        color: (gray << 16) | (gray << 8) | gray, transparent: true, opacity: 0.8, depthWrite: false,
      });
      const puff = new THREE.Mesh(smokeShape, material);
      puff.position.copy(position).add(new THREE.Vector3(
        (Math.random() - 0.5) * 12 * s, Math.random() * 4 * s, (Math.random() - 0.5) * 12 * s));
      const rise = new THREE.Vector3((Math.random() - 0.5) * 4, 6 + Math.random() * 10, (Math.random() - 0.5) * 4);
      this.add(puff, 3.5 + Math.random() * 2, (t, dt, m) => {
        m.position.addScaledVector(rise, dt);
        m.scale.setScalar(s * (3 + 12 * t));
        m.material.opacity = 0.8 * (1 - t);
      });
    }

    // A black burn mark that stays on the ground
    if (surfaceY !== null) {
      const scorch = new THREE.Mesh(scorchShape,
        new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.75, depthWrite: false }));
      scorch.position.set(position.x, surfaceY + 0.15 + Math.random() * 0.05, position.z);
      scorch.scale.setScalar(s * (1 + Math.random() * 0.4));
      this.scene.add(scorch);
      this.scorches.push(scorch);
      if (this.scorches.length > 40) {
        const old = this.scorches.shift();
        this.scene.remove(old);
        old.material.dispose();
      }
    }

    // Light up everything around for a moment
    this.light.position.copy(position);
    this.light.position.y += 8;
    this.lightPower = 200000 * s;
  }

  // Tiny sparks when a bullet hits a wall
  sparks(position) {
    this.burst(position, 0xffee58, 6, 15, 0.3, true);
  }
}
