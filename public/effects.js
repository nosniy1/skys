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
    this.fires = [];
    this.ash = 0;
    this.makeAsh();
  }

  // Adds something that changes over time and then disappears.
  // "change" gets t, which goes from 0 (just started) to 1 (finished).
  add(mesh, seconds, change) {
    this.scene.add(mesh);
    this.items.push({ mesh, seconds, age: 0, change });
  }

  update(dt, cameraPosition) {
    if (cameraPosition) {
      this.updateFires(dt, cameraPosition);
      this.updateAsh(dt, cameraPosition);
    }
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
    this.lightPower *= Math.exp(-dt * (this.lightPower > 1e7 ? 1.5 : 5));
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
      scorch.position.set(position.x, surfaceY + 0.55 + Math.random() * 0.05, position.z);
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

  // A puff of smoke from a factory chimney
  chimneySmoke(position) {
    const material = new THREE.MeshLambertMaterial({ color: 0xbdbdbd, transparent: true, opacity: 0.6, depthWrite: false });
    const puff = new THREE.Mesh(smokeShape, material);
    puff.position.copy(position);
    const drift = new THREE.Vector3(3 + Math.random() * 2, 4 + Math.random() * 2, Math.random() - 0.5);
    this.add(puff, 6, (t, dt, m) => {
      m.position.addScaledVector(drift, dt);
      m.scale.setScalar(2 + 8 * t);
      m.material.opacity = 0.6 * (1 - t);
    });
  }

  // ☢️ THE NUKE: a GIGANTIC fireball, a mushroom cloud 1 km high that everybody can see,
  // shock waves with walls of dust, fires all over the city, and ash falling from the sky.
  nuke(position) {
    const ground = new THREE.Vector3(position.x, 0, position.z);
    const white = new THREE.Color(0xffffff), yellow = new THREE.Color(0xfff176), orange = new THREE.Color(0xff6d00), dark = new THREE.Color(0x3a0a00);
    const noFog = (material) => { material.fog = false; return material; };

    // The fireball: white hot, then yellow, orange and dark red. 450 meters wide!
    for (const [size, seconds, rise] of [[230, 14, 250], [150, 9, 150], [320, 6, 60]]) {
      const fire = new THREE.Mesh(ballShape, noFog(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false })));
      fire.position.copy(ground);
      this.add(fire, seconds, (t, dt, m) => {
        m.scale.setScalar(10 + size * easeOut(Math.min(1, t * 2.5)));
        m.position.y = rise * t;
        const c = m.material.color;
        if (t < 0.08) c.copy(white).lerp(yellow, t / 0.08);
        else if (t < 0.3) c.copy(yellow).lerp(orange, (t - 0.08) / 0.22);
        else c.copy(orange).lerp(dark, (t - 0.3) / 0.7);
        m.material.opacity = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
      });
    }

    // The stem of the mushroom cloud: a column of smoke going up and up
    for (let i = 0; i < 60; i++) {
      const height = 20 + i * 15;
      const wobble = new THREE.Vector3((Math.random() - 0.5) * 50, 0, (Math.random() - 0.5) * 50);
      const glow = i < 25 ? 0x7a2a00 : 0x2a1a10;
      const puff = new THREE.Mesh(smokeShape, noFog(new THREE.MeshLambertMaterial({ color: 0x8a6a50, emissive: glow, transparent: true, opacity: 0.95, depthWrite: false })));
      puff.position.copy(ground).add(wobble);
      this.add(puff, 50 + Math.random() * 10, (t, dt, m) => {
        m.position.y = height * easeOut(Math.min(1, t * 3));
        m.scale.setScalar(35 + 50 * Math.min(1, t * 2));
        m.material.opacity = t < 0.7 ? 0.95 : 0.95 * (1 - (t - 0.7) / 0.3);
      });
    }

    // The cap of the mushroom: a huge round cloud 1 km up that keeps spreading out
    for (let i = 0; i < 110; i++) {
      const angle = Math.random() * Math.PI * 2;
      const from = 20 + Math.random() * 80, to = 200 + Math.random() * 330;
      const height = 850 + Math.random() * 250 + Math.cos(angle * 3) * 40;
      const lit = new THREE.Color(0xff8a3c), smoke = new THREE.Color(0x5d4a40);
      const puff = new THREE.Mesh(smokeShape, noFog(new THREE.MeshLambertMaterial({ color: 0xff8a3c, emissive: 0x6a2000, transparent: true, opacity: 0.95, depthWrite: false })));
      this.add(puff, 55 + Math.random() * 10, (t, dt, m) => {
        const up = easeOut(Math.min(1, t * 3));
        const r = from + (to - from) * easeOut(Math.min(1, t * 1.5));
        m.position.set(ground.x + Math.cos(angle) * r, height * up, ground.z + Math.sin(angle) * r);
        m.scale.setScalar(70 + 110 * Math.min(1, t * 2));
        m.material.color.copy(lit).lerp(smoke, Math.min(1, t * 3));
        m.material.emissive.setRGB(0.42, 0.12, 0).multiplyScalar(Math.max(0, 1 - t * 4));
        m.material.opacity = t < 0.75 ? 0.95 : 0.95 * (1 - (t - 0.75) / 0.25);
      });
    }

    // Three shock waves racing over the whole land, with tall walls of dust
    const wall = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true).translate(0, 0.5, 0);
    [[0xffffff, 5, 0], [0xffe0b2, 7, 0.6], [0xc8a27a, 10, 1.4]].forEach(([color, seconds, delay]) => {
      const ring = new THREE.Mesh(ringShape, noFog(new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
      ring.position.set(ground.x, 3, ground.z);
      ring.visible = false;
      this.add(ring, seconds + delay, (t, dt, m) => {
        const k = Math.max(0, (t * (seconds + delay) - delay) / seconds);
        m.visible = k > 0;
        m.scale.setScalar(20 + 4000 * k);
        m.material.opacity = 0.9 * (1 - k);
      });
      const dust = new THREE.Mesh(wall, noFog(new THREE.MeshBasicMaterial({ color: 0xa1887f, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
      dust.position.copy(ground);
      dust.visible = false;
      this.add(dust, seconds + delay, (t, dt, m) => {
        const k = Math.max(0, (t * (seconds + delay) - delay) / seconds);
        m.visible = k > 0;
        m.scale.set(20 + 4000 * k, 120 * (1 - k) + 10, 20 + 4000 * k);
        m.material.opacity = 0.6 * (1 - k);
      });
    });

    this.burst(new THREE.Vector3(ground.x, 10, ground.z), 0x3e2723, 150, 400, 6);
    this.burst(new THREE.Vector3(ground.x, 10, ground.z), 0xff9100, 150, 350, 5, true);

    // A gigantic burn mark over the whole city
    const scorch = new THREE.Mesh(scorchShape, new THREE.MeshBasicMaterial({ color: 0x1a1210, transparent: true, opacity: 0.85, depthWrite: false }));
    scorch.position.set(ground.x, 0.7, ground.z);
    scorch.scale.setScalar(90);
    this.scene.add(scorch);
    this.scorches.push(scorch);

    this.light.position.set(ground.x, 300, ground.z);
    this.lightPower = 5e8;
    this.ash = 1;
  }

  // 🔥 A fire that burns for a while, with flames and black smoke
  startFire(position, seconds) {
    this.fires.push({ position: position.clone(), left: seconds, flameTimer: 0, smokeTimer: Math.random() });
  }

  updateFires(dt, cameraPosition) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.left -= dt;
      if (f.left <= 0) { this.fires.splice(i, 1); continue; }
      if (f.position.distanceTo(cameraPosition) > 1500) continue;
      f.flameTimer -= dt;
      f.smokeTimer -= dt;
      if (f.flameTimer <= 0) {
        f.flameTimer = 0.25;
        const flame = new THREE.Mesh(ballShape, new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xff6d00 : 0xffab00, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        flame.position.copy(f.position).add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
        this.add(flame, 0.9, (t, dt, m) => {
          m.position.y += dt * 12;
          m.scale.setScalar(4 * (1 - t) + 0.5);
          m.material.opacity = 1 - t;
        });
      }
      if (f.smokeTimer <= 0) {
        f.smokeTimer = 0.6;
        const smoke = new THREE.Mesh(smokeShape, new THREE.MeshLambertMaterial({ color: 0x222222, transparent: true, opacity: 0.7, depthWrite: false }));
        smoke.position.copy(f.position).setY(f.position.y + 5);
        const drift = new THREE.Vector3(2 + Math.random() * 2, 8 + Math.random() * 4, Math.random() - 0.5);
        this.add(smoke, 6, (t, dt, m) => {
          m.position.addScaledVector(drift, dt);
          m.scale.setScalar(4 + 14 * t);
          m.material.opacity = 0.7 * (1 - t);
        });
      }
    }
  }

  // Ash falling from the sky after the nuke (gray snow)
  makeAsh() {
    const positions = new Float32Array(3000 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.ashPoints = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x9e9e9e, size: 0.6, transparent: true, opacity: 0, depthWrite: false }));
    this.ashPoints.frustumCulled = false;
    this.scene.add(this.ashPoints);
  }

  updateAsh(dt, cameraPosition) {
    this.ash = Math.max(0, this.ash - dt / 70);
    this.ashPoints.visible = this.ash > 0.01;
    if (!this.ashPoints.visible) return;
    this.ashPoints.material.opacity = Math.min(1, this.ash * 2);
    const p = this.ashPoints.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] -= dt * (3 + (i % 7));
      p[i] += Math.sin(i + p[i + 1] * 0.1) * dt;
      if (p[i + 1] < cameraPosition.y - 50 || Math.abs(p[i] - cameraPosition.x) > 120 || Math.abs(p[i + 2] - cameraPosition.z) > 120) {
        p[i] = cameraPosition.x + (Math.random() - 0.5) * 240;
        p[i + 1] = cameraPosition.y + Math.random() * 100 - 20;
        p[i + 2] = cameraPosition.z + (Math.random() - 0.5) * 240;
      }
    }
    this.ashPoints.geometry.attributes.position.needsUpdate = true;
  }

  // A big SPLASH when something falls into the sea
  splash(position) {
    const water = new THREE.Vector3(position.x, 0.5, position.z);
    this.burst(water, 0xe3f2fd, 30, 25, 0.8);
    this.burst(water, 0x64b5f6, 20, 20, 0.6);
    const ring = new THREE.Mesh(ringShape, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.copy(water);
    this.add(ring, 1.5, (t, dt, m) => {
      m.scale.setScalar(2 + 20 * t);
      m.material.opacity = 0.8 * (1 - t);
    });
  }

  // Remove all the burn marks, fires and ash (for a new round)
  clearScorches() {
    this.fires.length = 0;
    this.ash = 0;
    for (const scorch of this.scorches) {
      this.scene.remove(scorch);
      scorch.material.dispose();
    }
    this.scorches.length = 0;
  }

  // Tiny sparks when a bullet hits a wall
  sparks(position) {
    this.burst(position, 0xffee58, 6, 15, 0.3, true);
  }

  // A little puff of smoke behind a flying missile
  trail(position) {
    const material = new THREE.MeshLambertMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7, depthWrite: false });
    const puff = new THREE.Mesh(smokeShape, material);
    puff.position.copy(position);
    this.add(puff, 1.3, (t, dt, m) => {
      m.scale.setScalar(0.6 + 2.5 * t);
      m.material.opacity = 0.7 * (1 - t);
    });
  }

  // A big cloud of dust when a building falls down
  dust(x, z, width, height) {
    const size = Math.max(width, 10);
    for (let i = 0; i < 22; i++) {
      const material = new THREE.MeshLambertMaterial({ color: 0xa89f91, transparent: true, opacity: 0.85, depthWrite: false });
      const puff = new THREE.Mesh(smokeShape, material);
      const y = Math.random() * Math.min(height, 40);
      puff.position.set(x + (Math.random() - 0.5) * size, y, z + (Math.random() - 0.5) * size);
      const drift = new THREE.Vector3((Math.random() - 0.5) * 12, 2 + Math.random() * 5, (Math.random() - 0.5) * 12);
      const grow = size * (0.25 + Math.random() * 0.3);
      this.add(puff, 3 + Math.random() * 2.5, (t, dt, m) => {
        m.position.addScaledVector(drift, dt);
        m.scale.setScalar(3 + grow * Math.sqrt(t));
        m.material.opacity = 0.85 * (1 - t);
      });
    }
    this.burst(new THREE.Vector3(x, 2, z), 0x6d6258, 20, 25, 1.5);
  }
}
