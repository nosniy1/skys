// 🌊 SCENERY: the big ship, the lighthouse light, hot-air balloons, birds, and the airport coins
// The ship and the hot-air balloons move with the server's clock, so everybody sees them in the same place.
import * as THREE from 'three';

const COIN_RETURN_SECONDS = 30;

function makeShip() {
  const ship = new THREE.Group();
  const box = (w, h, d, color, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    ship.add(mesh);
    return mesh;
  };
  box(24, 4, 130, 0xb71c1c, 0, 1, 0);          // red bottom
  box(24, 6, 130, 0x1a237e, 0, 6, 0);          // dark blue hull
  box(22, 4, 90, 0xf5f5f5, 0, 11, 8);          // decks
  box(18, 4, 70, 0xffffff, 0, 15, 10);
  box(14, 3, 40, 0xeeeeee, 0, 18.5, 12);
  for (const z of [0, 22]) {                   // funnels
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, 10, 16), new THREE.MeshLambertMaterial({ color: 0xd32f2f }));
    funnel.position.set(0, 24, z);
    funnel.castShadow = true;
    ship.add(funnel);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.55, 2, 16), new THREE.MeshLambertMaterial({ color: 0x212121 }));
    top.position.set(0, 29, z);
    ship.add(top);
  }
  // little windows that glow at night
  const windowLights = new THREE.MeshBasicMaterial({ color: 0x555555 });
  for (const side of [-1, 1]) {
    for (let z = -35; z <= 50; z += 5) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2), windowLights);
      w.position.set(side * 11.05, 13, z);
      w.rotation.y = side * Math.PI / 2;
      ship.add(w);
    }
  }
  ship.userData.windowLights = windowLights;
  return ship;
}

function makeHotAirBalloon(colorA, colorB) {
  const group = new THREE.Group();
  const profile = [[0, -8], [3, -7], [6, -4], [8, 0], [8.5, 4], [7.5, 8], [5, 11], [2, 12.5], [0, 13]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const segments = 16;
  const envelope = new THREE.LatheGeometry(profile, segments);
  const a = new THREE.Color(colorA), b = new THREE.Color(colorB), colors = [];
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j < profile.length; j++) {
      const c = i % 2 ? a : b;
      colors.push(c.r, c.g, c.b);
    }
  }
  envelope.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(envelope, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  group.add(mesh);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
  basket.position.y = -12;
  basket.castShadow = true;
  group.add(basket);
  const ropes = [];
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) ropes.push(x, -11, z, x * 2, -7.5, z * 2);
  const ropeShape = new THREE.BufferGeometry();
  ropeShape.setAttribute('position', new THREE.Float32BufferAttribute(ropes, 3));
  group.add(new THREE.LineSegments(ropeShape, new THREE.LineBasicMaterial({ color: 0x4e342e })));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.5, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.position.y = -9;
  group.add(flame);
  group.userData.flame = flame;
  return group;
}

function makeBird() {
  const bird = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ color: 0x37474f, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.3, side * 1.4, 0, 0.2, 0, 0, 0.5], 3));
    shape.computeVertexNormals();
    const wing = new THREE.Mesh(shape, material);
    bird.add(wing);
  }
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4).scale(1, 1, 2.2), material);
  bird.add(body);
  return bird;
}

export class Scenery {
  constructor(scene, world, effects) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    const coast = world.coast, airport = world.airport;

    // THE SHIP
    this.ship = makeShip();
    scene.add(this.ship);
    this.shipX = coast.shore + 230;
    this.shipSunk = 0;

    // THE LIGHTHOUSE LIGHT (two light beams that go round and round)
    const lh = coast.lighthouse;
    this.beam = new THREE.Group();
    this.beam.position.set(lh.x, lh.lampY, lh.z);
    this.beamMaterial = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(14, 160, 20, 1, true).translate(0, -80, 0).rotateZ(side * Math.PI / 2), this.beamMaterial);
      this.beam.add(cone);
    }
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
    this.beam.add(this.lamp);
    scene.add(this.beam);

    // HOT-AIR BALLOONS
    const colors = [[0xe53935, 0xffeb3b], [0x1e88e5, 0xffffff], [0x43a047, 0xffeb3b], [0x8e24aa, 0xff9800], [0xff4081, 0x00bcd4], [0xff9800, 0x3f51b5]];
    this.hotAir = colors.map(([a, b], i) => {
      const mesh = makeHotAirBalloon(a, b);
      scene.add(mesh);
      return { mesh, center: new THREE.Vector2(Math.cos(i * 1.1) * 400, Math.sin(i * 1.7) * 400), radius: 250 + i * 60, speed: 0.012 + i * 0.002, phase: i * 2, height: 170 + i * 25 };
    });

    // BIRDS (flying in V-shapes)
    this.flocks = [];
    for (let f = 0; f < 5; f++) {
      const birds = [];
      for (let i = 0; i < 9; i++) {
        const bird = makeBird();
        scene.add(bird);
        const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        birds.push({ mesh: bird, offset: new THREE.Vector3(side * row * 3, 0, row * 3), flap: Math.random() * 6, alive: true });
      }
      this.flocks.push({ birds, center: new THREE.Vector3((Math.random() - 0.5) * 1200, 60 + Math.random() * 120, (Math.random() - 0.5) * 1200), radius: 150 + Math.random() * 250, angle: Math.random() * 6, speed: 0.08 + Math.random() * 0.05 });
    }

    // COINS at the airport: a line of gold coins over the runway
    const coinShape = new THREE.CylinderGeometry(1.6, 1.6, 0.35, 24).rotateX(Math.PI / 2);
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc107, metalness: 0.4, roughness: 0.3, emissive: 0x7a5200 });
    this.coins = [];
    for (let z = -300; z <= 300; z += 30) {
      const coin = new THREE.Mesh(coinShape, gold);
      coin.position.set(airport.x, 3.5, z);
      coin.castShadow = true;
      scene.add(coin);
      this.coins.push({ mesh: coin, respawn: 0 });
    }
  }

  // Did something hit the ship or a hot-air balloon? Gives back the height of what it hit, or null.
  hits(pos) {
    const s = this.ship.position;
    if (this.shipSunk < 0.5 && Math.abs(pos.x - s.x) < 12 && Math.abs(pos.z - s.z) < 65 && pos.y < 22) return 10 + s.y;
    for (const balloon of this.hotAir) {
      if (!balloon.mesh.visible) continue;
      const c = balloon.mesh.position;
      if (Math.abs(pos.x - c.x) < 10 && Math.abs(pos.z - c.z) < 10 && pos.y > c.y - 13 && pos.y < c.y + 13) return c.y + 13;
    }
    return null;
  }

  sinkShip() {
    this.shipSunk = Math.max(this.shipSunk, 0.01);
  }

  // ☢️ The nuke: hot-air balloons catch fire and fall, birds are gone, parked planes too
  doom() {
    this.doomed = true;
    this.doomTime = 0;
    for (const flock of this.flocks) for (const bird of flock.birds) bird.mesh.visible = false;
  }

  // A new round: everything comes back
  unDoom() {
    this.doomed = false;
    this.shipSunk = 0;
    for (const b of this.hotAir) b.mesh.visible = true;
    for (const flock of this.flocks) for (const bird of flock.birds) { bird.alive = true; bird.mesh.visible = true; }
  }

  update(dt, time, serverSeconds, night, player, onCoin) {
    // The sea moves
    this.world.coast.waves.offset.x += dt * 0.004;
    this.world.coast.waves.offset.y += dt * 0.002;

    // The ship sails up and down the coast
    const z = Math.sin(serverSeconds * 0.01) * 700;
    const goingNorth = Math.cos(serverSeconds * 0.01) < 0;
    if (this.shipSunk > 0) this.shipSunk = Math.min(1, this.shipSunk + dt * 0.08);
    this.ship.position.set(this.shipX, Math.sin(time * 0.7) * 0.3 - this.shipSunk * 30, z);
    this.ship.rotation.set(this.shipSunk * 0.4, goingNorth ? 0 : Math.PI, Math.sin(time * 0.5) * 0.015);
    this.ship.userData.windowLights.color.setScalar(0.33 + night * 0.67).multiply(new THREE.Color(1, 0.9, 0.6));

    // The lighthouse beam turns (you see it at night)
    this.beam.rotation.y += dt * 1.2;
    this.beamMaterial.opacity = night * 0.22;
    this.beam.visible = !this.world.coast.lighthouse.structure.destroyed;

    // Hot-air balloons drift slowly in big circles (or fall down burning after the nuke)
    if (this.doomed) this.doomTime += dt;
    for (const b of this.hotAir) {
      if (this.doomed) {
        if (!b.mesh.visible) continue;
        b.mesh.position.y -= dt * (10 + this.doomTime * 6);
        b.mesh.rotation.z += dt * 0.3;
        if (Math.random() < dt * 8) this.effects.burst(b.mesh.position, 0xff6d00, 2, 8, 1.5, true);
        if (b.mesh.position.y < 0) b.mesh.visible = false;
        continue;
      }
      b.mesh.rotation.z = 0;
      const angle = serverSeconds * b.speed + b.phase;
      b.mesh.position.set(b.center.x + Math.cos(angle) * b.radius, b.height + Math.sin(serverSeconds * 0.05 + b.phase) * 12, b.center.y + Math.sin(angle) * b.radius);
      b.mesh.userData.flame.visible = Math.sin(time * 1.3 + b.phase) > 0.6; // the burner goes "FWOOSH" sometimes
    }

    // Birds fly in circles and flap their wings. If a plane flies into them... feathers everywhere!
    for (const flock of this.flocks) {
      flock.angle += dt * flock.speed;
      const heading = flock.angle + Math.PI / 2;
      for (const bird of flock.birds) {
        if (!bird.alive || this.doomed) continue;
        const p = bird.offset.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, -heading);
        bird.mesh.position.set(flock.center.x + Math.cos(flock.angle) * flock.radius + p.x, flock.center.y + p.y, flock.center.z + Math.sin(flock.angle) * flock.radius + p.z);
        bird.mesh.rotation.y = -heading;
        bird.flap += dt * 9;
        bird.mesh.children[0].rotation.z = Math.sin(bird.flap) * 0.6;
        bird.mesh.children[1].rotation.z = -Math.sin(bird.flap) * 0.6;
        if (player && bird.mesh.position.distanceTo(player) < 5) {
          bird.alive = false;
          bird.mesh.visible = false;
          this.effects.burst(bird.mesh.position, 0xffffff, 12, 10, 0.4);
          setTimeout(() => { bird.alive = true; bird.mesh.visible = true; }, 20000);
        }
      }
    }

    // Spinning coins: fly (or roll) through them to collect them!
    for (const coin of this.coins) {
      if (!coin.mesh.visible) {
        coin.respawn -= dt;
        if (coin.respawn <= 0) coin.mesh.visible = true;
        continue;
      }
      coin.mesh.rotation.y += dt * 3;
      if (player && coin.mesh.position.distanceTo(player) < 6) {
        coin.mesh.visible = false;
        coin.respawn = COIN_RETURN_SECONDS;
        this.effects.burst(coin.mesh.position, 0xffd54f, 10, 12, 0.4, true);
        onCoin();
      }
    }
  }
}
