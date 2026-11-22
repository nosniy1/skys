// ✈️ THE AIRPLANES (and bombs and missiles)
// Every plane points toward -Z (forward). Units are meters.
import * as THREE from 'three';

// =====================================================================
// THE FOUR PLANES — try changing their numbers!
// (How many hits each plane can take is in server.js, because the server is the referee.)
// =====================================================================
export const PLANE_TYPES = {
  fighter: {
    name: 'Fighter', about: 'Good at everything',
    normalSpeed: 40, boostSpeed: 100, turnSpeed: 1.3, pitchSpeed: 1.4, rollSpeed: 3.2,
    bombDelay: 0.4, bombsPerDrop: 1, hitSize: 4.5, engine: 'propeller',
  },
  jet: {
    name: 'Jet', about: 'Super fast, turns slowly',
    normalSpeed: 60, boostSpeed: 150, turnSpeed: 1.0, pitchSpeed: 1.2, rollSpeed: 3.5,
    bombDelay: 0.5, bombsPerDrop: 1, hitSize: 4.5, engine: 'jet',
  },
  bomber: {
    name: 'Bomber', about: 'Slow and tough, 2 bombs at once',
    normalSpeed: 32, boostSpeed: 75, turnSpeed: 0.9, pitchSpeed: 0.9, rollSpeed: 1.8,
    bombDelay: 0.25, bombsPerDrop: 2, hitSize: 7, engine: 'propeller',
  },
  stunt: {
    name: 'Stunt plane', about: 'Turns super fast, a bit fragile',
    normalSpeed: 40, boostSpeed: 95, turnSpeed: 2.1, pitchSpeed: 2.3, rollSpeed: 5,
    bombDelay: 0.5, bombsPerDrop: 1, hitSize: 4, engine: 'propeller',
  },
  golden: {
    name: '🌟 Golden Jet', about: 'The fastest plane of all!', forSale: true,
    normalSpeed: 70, boostSpeed: 170, turnSpeed: 1.25, pitchSpeed: 1.4, rollSpeed: 4,
    bombDelay: 0.4, bombsPerDrop: 1, hitSize: 4.5, engine: 'jet',
  },
  heli: {
    name: '🚁 Helicopter', about: 'Hovers and lands anywhere', forSale: true, helicopter: true,
    normalSpeed: 35, boostSpeed: 60, turnSpeed: 1.6, climbSpeed: 18, pitchSpeed: 0, rollSpeed: 0,
    bombDelay: 0.35, bombsPerDrop: 1, hitSize: 5.5, engine: 'heli',
  },
};

// How high above the ground the plane's middle is when it stands on its wheels
const GROUND_HEIGHT = { fighter: 1.38, jet: 1.55, golden: 1.55, bomber: 1.6, stunt: 1.28, heli: 1.65 };

// A flat piece (like a wing) cut out from a shape seen from above
function flatPiece(points, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1,
  });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

// A wing lying flat (x = left/right, y = front/back in the drawing)
function wing(points, thickness) {
  return flatPiece(points, thickness).rotateX(-Math.PI / 2);
}

// A tail fin standing up (x = front/back, y = up in the drawing)
function fin(points, thickness) {
  return flatPiece(points, thickness).rotateY(Math.PI / 2);
}

// A round body: thick in the middle, thin at the ends. Points are [radius, front/back].
function body(points) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 20).rotateX(-Math.PI / 2);
}

// A tube pointing forward
function tube(radiusFront, radiusBack, length, sides = 16) {
  return new THREE.CylinderGeometry(radiusFront, radiusBack, length, sides, 1, true).rotateX(-Math.PI / 2);
}

export function makePlane(color, type = 'fighter', sticker = 'none') {
  const plane = new THREE.Group();
  const m = {
    paint: new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.45 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, metalness: 0.2, roughness: 0.5 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x1a3a8a, roughness: 0.5 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb0b8bf, metalness: 0.9, roughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.45 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.8 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 }),
  };
  if (type === 'golden') {          // the golden jet is made of shiny gold, with your color on the wings
    m.blue = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    m.paint = new THREE.MeshStandardMaterial({ color: 0xffc107, metalness: 0.5, roughness: 0.3, emissive: 0x5a3c00 });
  }
  plane.userData = {
    paint: m.paint, type, propellers: [], rotors: [], hideInCockpit: [],
    cockpit: new THREE.Vector3(0, 1.15, 0.1), groundHeight: GROUND_HEIGHT[type] || 1.4,
  };

  function add(geometry, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    plane.add(mesh);
    return mesh;
  }

  // A propeller with two blades, plus a see-through circle so it looks like it spins fast
  function propeller(x, y, z, size, hideInCockpit) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    for (const side of [0, Math.PI]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22 * size, 1.6 * size, 0.05), m.dark);
      blade.geometry.translate(0, 0.95 * size, 0);
      blade.rotation.y = 0.35;                 // blades are a bit twisted, like real ones
      const holder = new THREE.Group();
      holder.rotation.z = side;                // one blade up, one blade down
      holder.add(blade);
      group.add(holder);
      if (hideInCockpit) plane.userData.hideInCockpit.push(blade);
    }
    group.add(new THREE.Mesh(
      new THREE.CircleGeometry(1.75 * size, 32),
      new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
    ));
    plane.add(group);
    plane.userData.propellers.push(group);
  }

  // Round symbols on top of the wings
  function roundels(x, y, z, size = 1) {
    for (const side of [-x, x]) {
      add(new THREE.CircleGeometry(0.6 * size, 24).rotateX(-Math.PI / 2), m.white, side, y, z);
      add(new THREE.CircleGeometry(0.38 * size, 24).rotateX(-Math.PI / 2), m.blue, side, y + 0.005, z);
    }
  }

  function wheel(x, y, z, size = 1) {
    add(new THREE.BoxGeometry(0.08 * size, 0.7 * size, 0.08 * size), m.metal, x, y + 0.35 * size, z);
    add(new THREE.CylinderGeometry(0.28 * size, 0.28 * size, 0.18 * size, 16).rotateZ(Math.PI / 2), m.dark, x, y, z);
  }

  // Pilot sitting in the cockpit
  function pilot(x, y, z) {
    plane.userData.hideInCockpit.push(
      add(new THREE.SphereGeometry(0.2, 12, 10), m.skin, x, y, z),
      add(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.helmet, x, y + 0.02, z + 0.02));
  }

  function canopy(y, z, width, length) {
    const glass = new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    glass.scale(width, 0.9, length);
    plane.userData.hideInCockpit.push(add(glass, m.glass, 0, y, z));
  }

  // Lights on the wing tips (red on the left, green on the right, like real planes)
  function navLights(x, y, z) {
    add(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }), -x, y, z);
    add(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0x20ff40 }), x, y, z);
  }

  if (type === 'heli') {
    // ---------------- HELICOPTER ----------------
    const cabin = new THREE.SphereGeometry(1.6, 20, 14);
    cabin.scale(1, 0.9, 1.4);
    add(cabin, m.paint, 0, 0.2, 0);
    const bubble = new THREE.SphereGeometry(1.25, 20, 12);
    bubble.scale(1, 0.85, 1);
    plane.userData.hideInCockpit.push(add(bubble, m.glass, 0, 0.45, -1.05));
    add(tube(0.38, 0.16, 5.6), m.paint, 0, 0.45, 3.9);                            // tail boom
    add(fin([[0.4, 0], [-0.6, 0], [-0.7, 1.6], [-0.2, 1.6]], 0.1), m.paint, 0, 0.5, 6.4);
    add(wing([[0, 0.3], [1.2, 0.2], [1.2, -0.3], [0, -0.3], [-1.2, -0.3], [-1.2, 0.2]], 0.08), m.paint, 0, 0.5, 6.1);
    // main rotor on top
    const mainRotor = new THREE.Group();
    mainRotor.position.set(0, 1.85, 0);
    for (const angle of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.06, 0.4), m.dark);
      blade.rotation.y = angle;
      mainRotor.add(blade);
    }
    mainRotor.add(new THREE.Mesh(new THREE.CircleGeometry(5.8, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })));
    plane.add(mainRotor);
    add(new THREE.CylinderGeometry(0.15, 0.15, 0.6, 8), m.metal, 0, 1.55, 0);
    // tail rotor on the side of the tail
    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.25, 1.2, 6.5);
    for (const angle of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.2, 0.2), m.dark);
      blade.rotation.x = angle;
      tailRotor.add(blade);
    }
    plane.add(tailRotor);
    plane.userData.rotors.push({ part: mainRotor, axis: 'y' }, { part: tailRotor, axis: 'x' });
    // skids to stand on
    for (const x of [-1.1, 1.1]) {
      add(new THREE.CylinderGeometry(0.09, 0.09, 4.2, 8).rotateX(Math.PI / 2), m.metal, x, -1.55, 0);
      for (const z of [-0.9, 0.9]) add(new THREE.BoxGeometry(0.08, 0.9, 0.08), m.metal, x * 0.85, -1.1, z);
    }
    pilot(0, 0.55, -0.7);
    navLights(1.55, 0.2, 0);
    plane.userData.cockpit.set(0, 0.95, -0.9);
  } else if (type === 'jet' || type === 'golden') {
    // ---------------- JET ----------------
    add(body([[0, -4.4], [0.55, -4.2], [0.8, -3], [0.88, -1], [0.8, 1.5], [0.6, 3], [0.3, 4.3], [0, 4.9]]), m.paint);
    add(wing([[0, 1.5], [0.9, 1.2], [4.2, -1.8], [4.2, -2.6], [0, -2.6], [-4.2, -2.6], [-4.2, -1.8], [-0.9, 1.2]], 0.12), m.paint, 0, -0.2, 0.8);
    roundels(2.6, -0.08, 2.4, 0.8);
    add(wing([[0, 0.5], [1.8, -0.3], [1.8, -0.8], [0, -0.8], [-1.8, -0.8], [-1.8, -0.3]], 0.08), m.paint, 0, 0.1, 3.8);
    for (const side of [-1, 1]) {
      const tail = add(fin([[1.0, 0], [-1.2, 0], [-1.35, 1.9], [-0.75, 1.9]], 0.1), m.paint, side * 0.6, 0.4, 3.2);
      tail.rotation.z = -side * 0.35;
      add(new THREE.BoxGeometry(0.45, 0.7, 1.8), m.dark, side * 0.95, -0.1, -0.4);  // air intakes
    }
    add(tube(0.6, 0.62, 0.9), m.metal, 0, 0, 4.4);                                    // engine nozzle
    canopy(0.6, -1.8, 1.0, 1.7);
    pilot(0, 0.75, -1.7);
    navLights(4.2, -0.2, 3.0);
    wheel(0, -1.3, -2.6, 0.8);
    wheel(-1.2, -1.3, 1.2, 0.8);
    wheel(1.2, -1.3, 1.2, 0.8);
    // Afterburner flame: it gets bigger when you boost
    const flame = new THREE.Group();
    flame.position.z = 4.9;
    const fire = (radius, length, color) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 12).rotateX(Math.PI / 2).translate(0, 0, length / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.add(cone);
    };
    fire(0.55, 2.6, 0xff7a20);
    fire(0.3, 1.6, 0xfff0c0);
    plane.add(flame);
    plane.userData.flame = flame;
    plane.userData.cockpit.set(0, 1.15, -1.6);
  } else if (type === 'bomber') {
    // ---------------- BOMBER ----------------
    add(body([[0, -5.6], [0.45, -5.3], [0.85, -3.5], [1.15, -1], [1.2, 2], [1.1, 3.8], [0.85, 4.6], [0.5, 4.9], [0, 4.9]]), m.paint);
    const nose = new THREE.SphereGeometry(0.85, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2);
    add(nose, m.glass, 0, 0, -4.6);
    add(wing([[0, 1.4], [8.5, 0.8], [9, 0.5], [9, -0.2], [8.5, -0.5], [0, -1.2], [-8.5, -0.5],
              [-9, -0.2], [-9, 0.5], [-8.5, 0.8]], 0.2), m.paint, 0, 0.4, -0.5);
    roundels(6.5, 0.54, -0.4, 1.3);
    for (const x of [-3.8, 3.8]) {
      add(tube(0.55, 0.45, 2.8), m.metal, x, 0.25, -1.4);                      // engines
      add(new THREE.ConeGeometry(0.3, 0.6, 12).rotateX(-Math.PI / 2), m.white, x, 0.25, -3.1);
      propeller(x, 0.25, -2.9, 0.85, false);
      wheel(x, -0.85, -1.2, 1.3);
    }
    add(wing([[0, 0.6], [3.2, 0.4], [3.5, 0], [3.2, -0.5], [0, -0.7], [-3.2, -0.5], [-3.5, 0], [-3.2, 0.4]], 0.12), m.paint, 0, 0.5, 4.4);
    for (const x of [-3.4, 3.4]) add(fin([[0.6, 0], [-0.9, 0], [-0.95, 1.8], [-0.4, 1.9]], 0.1), m.paint, x, 0.5, 4.4);
    add(new THREE.BoxGeometry(1.2, 0.2, 3), m.dark, 0, -1.1, 0);                 // bomb doors
    canopy(1.0, -2.5, 1.2, 1.4);
    pilot(0, 1.15, -2.4);
    navLights(9, 0.4, -0.35);
    wheel(0, -0.65, 4.2, 0.6);
    plane.userData.cockpit.set(0, 1.65, -2.4);
  } else if (type === 'stunt') {
    // ---------------- STUNT BIPLANE ----------------
    add(body([[0, -3], [0.3, -2.8], [0.5, -1.6], [0.65, 0], [0.68, 1.6], [0.6, 2.3], [0, 2.4]]), m.paint);
    add(tube(0.62, 0.66, 0.5), m.metal, 0, 0, -2.2);
    add(new THREE.ConeGeometry(0.32, 0.7, 16).rotateX(-Math.PI / 2), m.white, 0, 0, -2.85);
    propeller(0, 0, -2.6, 0.8, true);
    const shape = (span) => [[0, 0.7], [span - 0.3, 0.7], [span, 0.4], [span, -0.4], [span - 0.3, -0.7], [0, -0.7],
                             [-span + 0.3, -0.7], [-span, -0.4], [-span, 0.4], [-span + 0.3, 0.7]];
    add(wing(shape(4.0), 0.12), m.white, 0, -0.45, -0.6);                         // lower wing
    add(wing(shape(4.3), 0.12), m.white, 0, 1.3, -0.9);                           // upper wing
    roundels(3.2, 1.4, -0.9, 0.9);
    for (const x of [-2.9, 2.9]) {                                               // struts between the wings
      for (const z of [-1.1, -0.2]) {
        const strut = add(new THREE.BoxGeometry(0.07, 1.75, 0.07), m.dark, x, 0.43, z - 0.15);
        strut.rotation.x = 0.15;
      }
    }
    for (const x of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.06, 1.0, 0.06), m.dark, x, 0.85, -0.9);
    add(wing([[0, 0.4], [1.4, 0.2], [1.5, 0], [1.4, -0.3], [0, -0.4], [-1.4, -0.3], [-1.5, 0], [-1.4, 0.2]], 0.08), m.paint, 0, 0.15, 2.1);
    add(fin([[0.5, 0], [-0.7, 0], [-0.75, 1.2], [-0.4, 1.3]], 0.08), m.white, 0, 0.2, 2.1);
    add(tube(0.42, 0.42, 0.5), m.dark, 0, 0.55, 0.4);                             // open cockpit ring
    pilot(0, 0.8, 0.4);
    plane.userData.hideInCockpit.push(add(new THREE.BoxGeometry(0.36, 0.08, 0.06), m.dark, 0, 0.84, 0.22)); // goggles
    navLights(4.3, 1.3, -0.9);
    wheel(-1.0, -1.0, -0.9);
    wheel(1.0, -1.0, -0.9);
    plane.userData.cockpit.set(0, 1.2, 0.7);
  } else {
    // ---------------- FIGHTER ----------------
    add(body([[0, -3.6], [0.2, -3.5], [0.35, -2.8], [0.55, -1.6], [0.72, -0.3], [0.8, 1.0], [0.78, 2.3], [0.68, 2.9], [0.6, 3.05], [0, 3.05]]), m.paint);
    add(tube(0.535, 0.535, 0.3, 20), m.white, 0, 0, 1.8);                          // white stripe
    add(tube(0.7, 0.72, 0.6, 20), m.metal, 0, 0, -2.8);                             // engine
    add(new THREE.ConeGeometry(0.38, 0.9, 16).rotateX(-Math.PI / 2), m.white, 0, 0, -3.55);
    propeller(0, 0, -3.35, 1, true);
    add(wing([[0, 1.0], [4.6, 0.55], [5.1, 0.35], [5.25, 0.05], [5.1, -0.25], [4.6, -0.4],
              [0, -0.9], [-4.6, -0.4], [-5.1, -0.25], [-5.25, 0.05], [-5.1, 0.35], [-4.6, 0.55]], 0.14), m.paint, 0, -0.35, -0.6);
    roundels(3.6, -0.24, -0.65);
    add(wing([[0, 0.45], [1.6, 0.25], [1.8, 0], [1.6, -0.35], [0, -0.5], [-1.6, -0.35], [-1.8, 0], [-1.6, 0.25]], 0.1), m.paint, 0, 0.1, 3.0);
    add(fin([[0.7, 0], [-0.9, 0], [-0.95, 1.5], [-0.55, 1.6], [0.1, 0.45]], 0.1), m.paint, 0, 0.2, 3.0);
    canopy(0.55, -0.3, 1, 2);
    pilot(0, 0.72, -0.15);
    navLights(5.25, -0.3, -0.55);
    wheel(-1.4, -1.1, -0.7);
    wheel(1.4, -1.1, -0.7);
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12).rotateZ(Math.PI / 2), m.dark, 0, -0.45, 3.2);
  }

  addSticker(plane, sticker);

  // A see-through bubble for the shield power-up
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(type === 'bomber' ? 11 : 7, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x40c4ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  shield.visible = false;
  plane.add(shield);
  plane.userData.shield = shield;

  plane.traverse((part) => { if (part.isMesh && !part.material.transparent) part.castShadow = true; });
  return plane;
}

// 💣 A BOMB. Its nose points toward +Z so we can aim it with lookAt().
export function makeBomb() {
  const bomb = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x4b5320, metalness: 0.4, roughness: 0.5 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 });

  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 12), olive);
  shell.rotation.x = Math.PI / 2;
  bomb.add(shell);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.1, 12), yellow);
  band.rotation.x = Math.PI / 2;
  band.position.z = 0.35;
  bomb.add(band);

  for (const [w, h] of [[0.9, 0.05], [0.05, 0.9]]) {
    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), olive);
    tailFin.position.z = -0.75;
    bomb.add(tailFin);
  }
  bomb.traverse((part) => { part.castShadow = true; });
  return bomb;
}

// 🚀 A MISSILE. Its nose points toward +Z too.
export function makeMissile() {
  const missile = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.5, roughness: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.5 });
  const gray = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6 });

  missile.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 10).rotateX(Math.PI / 2), white));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 10).rotateX(Math.PI / 2), red);
  nose.position.z = 1.5;
  missile.add(nose);
  for (const [w, h] of [[0.9, 0.05], [0.05, 0.9]]) {
    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), gray);
    tailFin.position.z = -1.0;
    missile.add(tailFin);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 1.4, 8).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  flame.position.z = -1.9;
  missile.add(flame);
  return missile;
}

// 🏷️ A NAME TAG that floats above another player's plane, with their health bar.
// You can see it through buildings, so it helps you find them!
export function makeNameTag() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, depthTest: false, sizeAttenuation: false, fog: false,
  }));
  tag.scale.set(0.3, 0.094, 1);
  tag.renderOrder = 10;

  tag.userData.draw = (name, color, health, maxHealth) => {
    g.clearRect(0, 0, 256, 80);
    g.font = 'bold 30px -apple-system, Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(name, 128, 34);
    g.fillStyle = '#' + color.toString(16).padStart(6, '0');
    g.fillText(name, 128, 34);
    // health bar
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(48, 48, 160, 18);
    const part = Math.max(0, health / maxHealth);
    g.fillStyle = part > 0.5 ? '#4caf50' : part > 0.2 ? '#ff9800' : '#f44336';
    g.fillRect(51, 51, 154 * part, 12);
    texture.needsUpdate = true;
  };
  return tag;
}

// =====================================================================
// 🎨 STICKERS: pictures painted on the side of the plane
// =====================================================================
export const STICKERS = {
  none: 'No sticker', flames: '🔥 Flames', shark: '🦈 Shark teeth', lightning: '⚡ Lightning', stars: '⭐ Stars',
};

// Draw a sticker picture. The front of the plane is on the RIGHT side of the picture.
function stickerPicture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (kind === 'flames') {
    const fire = g.createLinearGradient(256, 0, 0, 0);
    fire.addColorStop(0, '#fff176');
    fire.addColorStop(0.4, '#ff9800');
    fire.addColorStop(1, '#d50000');
    g.fillStyle = fire;
    g.beginPath();
    g.moveTo(256, 20);
    const tongues = [[150, 10, 60, 25], [170, 45, 20, 55], [140, 80, 50, 85], [175, 105, 90, 118]];
    for (const [cx, cy, tx, ty] of tongues) {
      g.quadraticCurveTo(cx, cy, tx, ty);
      g.quadraticCurveTo(cx + 30, cy + 10, 230, cy + 18);
    }
    g.lineTo(256, 110);
    g.closePath();
    g.fill();
  } else if (kind === 'shark') {
    g.fillStyle = '#b71c1c';                          // mouth
    g.beginPath();
    g.moveTo(256, 60); g.quadraticCurveTo(170, 70, 120, 80); g.quadraticCurveTo(180, 120, 256, 112);
    g.closePath();
    g.fill();
    g.fillStyle = 'white';                            // teeth
    for (let x = 135; x < 250; x += 16) {
      g.beginPath(); g.moveTo(x, 76); g.lineTo(x + 8, 92); g.lineTo(x + 16, 74); g.fill();
      g.beginPath(); g.moveTo(x + 4, 112); g.lineTo(x + 12, 96); g.lineTo(x + 20, 112); g.fill();
    }
    g.beginPath(); g.arc(215, 35, 15, 0, Math.PI * 2); g.fill();   // eye
    g.fillStyle = 'black';
    g.beginPath(); g.arc(220, 35, 8, 0, Math.PI * 2); g.fill();
  } else if (kind === 'lightning') {
    g.fillStyle = '#ffeb3b';
    g.strokeStyle = '#212121';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(250, 40); g.lineTo(150, 50); g.lineTo(165, 70); g.lineTo(20, 90);
    g.lineTo(120, 60); g.lineTo(105, 42); g.closePath();
    g.fill(); g.stroke();
  } else if (kind === 'stars') {
    for (const [x, y, r] of [[200, 60, 34], [110, 45, 22], [50, 80, 16]]) star(g, x, y, r);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function star(g, x, y, r) {
  g.fillStyle = 'white';
  g.strokeStyle = '#1a237e';
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  g.closePath();
  g.fill();
  g.stroke();
}

// Where the stickers go on each plane: [front z, back z, body radius, height]
const STICKER_SPOTS = {
  fighter: [-2.7, -0.6, 0.74, 1.0], jet: [-3.6, -1.2, 0.86, 1.0], golden: [-3.6, -1.2, 0.86, 1.0],
  bomber: [-4.2, -1.6, 1.15, 1.3], stunt: [-2.0, -0.2, 0.66, 0.9], heli: [-1.2, 1.2, 1.62, 1.4],
};

function addSticker(plane, kind) {
  if (!STICKERS[kind] || kind === 'none') return;
  const [front, back, radius, height] = STICKER_SPOTS[plane.userData.type];
  const material = new THREE.MeshBasicMaterial({ map: stickerPicture(kind), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  material.color.setScalar(0.9);
  for (const side of [-1, 1]) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(back - front, height * 0.9), material);
    decal.position.set(side * (radius + 0.03), plane.userData.type === 'heli' ? 0.2 : 0, (front + back) / 2);
    decal.rotation.y = Math.PI / 2;
    decal.scale.x = side;         // mirror it on the left side, so the front is always at the nose
    decal.renderOrder = 2;
    plane.add(decal);
  }
}

// =====================================================================
// 🪂 A PARACHUTE with the pilot hanging under it
// =====================================================================
export function makeParachute(color) {
  const group = new THREE.Group();
  const canopyShape = new THREE.SphereGeometry(4, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.4);
  canopyShape.scale(1, 0.6, 1);
  const mine = new THREE.Color(color), white = new THREE.Color(0xffffff), colors = [];
  const p = canopyShape.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const slice = Math.floor(((Math.atan2(p.getZ(i), p.getX(i)) + Math.PI) / (Math.PI * 2)) * 8);
    const c = slice % 2 ? mine : white;
    colors.push(c.r, c.g, c.b);
  }
  canopyShape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const canopy = new THREE.Mesh(canopyShape, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  canopy.castShadow = true;

  const strings = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    strings.push(Math.cos(a) * 3.3, 1.1, Math.sin(a) * 3.3, 0, -5.4, 0);
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(strings, 3));
  const ropes = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x555555 }));
  const top = new THREE.Group();
  top.add(canopy, ropes);
  group.add(top);

  // The pilot
  const suit = new THREE.MeshLambertMaterial({ color: 0x556b2f });
  const pilotBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 8), suit);
  pilotBody.position.y = -6.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshLambertMaterial({ color: 0xf1c27d }));
  head.position.y = -5.25;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: mine }));
  helmet.position.y = -5.22;
  group.add(pilotBody, head, helmet);
  for (const part of [pilotBody, head, helmet]) part.castShadow = true;
  group.userData.canopy = top;   // hidden when the pilot is standing on the ground
  return group;
}

// ☢️ THE NUKE: a big yellow bomb hanging under a red and white parachute
export function makeNuke() {
  const group = new THREE.Group();
  const chute = makeParachute(0xd32f2f);
  while (chute.children.length > 1) chute.remove(chute.children[1]); // no pilot, just the parachute
  chute.scale.setScalar(2.2);
  group.add(chute);

  const yellow = new THREE.MeshStandardMaterial({ color: 0xfdd835, metalness: 0.4, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 4, 6, 16), yellow);
  body.position.y = -15;
  body.castShadow = true;
  group.add(body);
  for (const angle of [0, Math.PI / 2]) {
    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.2, 0.15), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    tailFin.position.y = -12.6;
    tailFin.rotation.y = angle;
    group.add(tailFin);
  }

  // The radiation sign ☢️ all around the bomb
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fdd835';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#111';
  for (const cx of [85, 256, 427]) {
    for (const start of [-120, 0, 120]) {
      g.beginPath();
      g.moveTo(cx, 64);
      g.arc(cx, 64, 52, ((start - 30) * Math.PI) / 180, ((start + 30) * Math.PI) / 180);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#fdd835';
    g.beginPath(); g.arc(cx, 64, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111';
    g.beginPath(); g.arc(cx, 64, 10, 0, Math.PI * 2); g.fill();
  }
  const sign = new THREE.CanvasTexture(canvas);
  sign.colorSpace = THREE.SRGBColorSpace;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.43, 1.43, 2.4, 24, 1, true), new THREE.MeshStandardMaterial({ map: sign }));
  band.position.y = -15;
  group.add(band);
  return group;
}

// 🚶 A PERSON (you, when you walk around). The feet are at the bottom (y = 0), the face looks toward -Z.
export function makeHuman(shirt = 0x1e88e5) {
  const person = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xf1c27d });
  const cloth = new THREE.MeshLambertMaterial({ color: shirt });
  const pants = new THREE.MeshLambertMaterial({ color: 0x37474f });
  const dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const add = (parent, geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // Legs and arms hang from a "joint" so they can swing when walking
  const joint = (x, y) => {
    const j = new THREE.Group();
    j.position.set(x, y, 0);
    person.add(j);
    return j;
  };
  const legs = [-0.13, 0.13].map((x) => {
    const j = joint(x, 0.9);
    add(j, new THREE.BoxGeometry(0.22, 0.9, 0.25), pants, 0, -0.45, 0);
    return j;
  });
  add(person, new THREE.BoxGeometry(0.55, 0.7, 0.3), cloth, 0, 1.25, 0);
  const arms = [-0.36, 0.36].map((x) => {
    const j = joint(x, 1.55);
    add(j, new THREE.BoxGeometry(0.16, 0.65, 0.18), cloth, 0, -0.32, 0);
    return j;
  });
  add(person, new THREE.SphereGeometry(0.2, 12, 10), skin, 0, 1.82, 0);
  add(person, new THREE.SphereGeometry(0.21, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloth, 0, 1.86, 0.02); // cap
  const gun = add(arms[1], new THREE.BoxGeometry(0.08, 0.14, 0.5), dark, 0, -0.62, -0.18);
  person.userData = { legs, arms, gun };
  return person;
}

// Make a person's legs and arms swing. speed = how fast they walk.
export function animateHuman(person, speed, time) {
  const swing = Math.sin(time * (4 + speed)) * Math.min(0.8, Math.abs(speed) * 0.12);
  const { legs, arms } = person.userData;
  legs[0].rotation.x = swing;
  legs[1].rotation.x = -swing;
  arms[0].rotation.x = -swing;
  arms[1].rotation.x = 1.4;   // the right arm holds the blaster forward
}
