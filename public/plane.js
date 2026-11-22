// ✈️ THE AIRPLANE (and the bombs)
// The plane points toward -Z (forward). Units are meters.
import * as THREE from 'three';

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

export function makePlane(color) {
  const plane = new THREE.Group();
  const hideInCockpit = [];          // things that would block your view in cockpit mode
  plane.userData.hideInCockpit = hideInCockpit;

  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.45 });
  plane.userData.paint = paint;     // so we can change the color later
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, metalness: 0.2, roughness: 0.5 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1a3a8a, roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb0b8bf, metalness: 0.9, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.45 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.8 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 });

  function add(geometry, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    plane.add(mesh);
    return mesh;
  }

  // BODY: a round shape, thick in the middle and thin at the tail
  const profile = [[0, -3.6], [0.2, -3.5], [0.35, -2.8], [0.55, -1.6], [0.72, -0.3],
                   [0.8, 1.0], [0.78, 2.3], [0.68, 2.9], [0.6, 3.05], [0, 3.05]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(profile, 20);
  body.rotateX(-Math.PI / 2);
  add(body, paint);

  // White stripe around the tail
  const stripe = new THREE.CylinderGeometry(0.535, 0.535, 0.3, 20, 1, true);
  stripe.rotateX(Math.PI / 2);
  add(stripe, white, 0, 0, 1.8);

  // ENGINE at the front, with the pointy spinner
  const cowling = new THREE.CylinderGeometry(0.7, 0.72, 0.6, 20, 1, true);
  cowling.rotateX(Math.PI / 2);
  add(cowling, metal, 0, 0, -2.8);
  const spinner = new THREE.ConeGeometry(0.38, 0.9, 16);
  spinner.rotateX(-Math.PI / 2);
  add(spinner, white, 0, 0, -3.55);

  // PROPELLER: two blades, plus a see-through circle so it looks like it is spinning fast
  const propeller = new THREE.Group();
  propeller.position.z = -3.35;
  for (const side of [0, Math.PI]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.6, 0.05), dark);
    blade.geometry.translate(0, 0.95, 0);
    blade.rotation.y = 0.35;          // blades are a bit twisted, like real ones
    const holder = new THREE.Group();
    holder.rotation.z = side;         // one blade up, one blade down
    holder.add(blade);
    propeller.add(holder);
    hideInCockpit.push(blade);
  }
  const blur = new THREE.Mesh(
    new THREE.CircleGeometry(1.75, 32),
    new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
  );
  propeller.add(blur);
  plane.add(propeller);
  plane.userData.propeller = propeller;

  // WINGS (seen from above: x = left/right, y = front/back)
  const wing = flatPiece([[0, 1.0], [4.6, 0.55], [5.1, 0.35], [5.25, 0.05], [5.1, -0.25], [4.6, -0.4],
                          [0, -0.9], [-4.6, -0.4], [-5.1, -0.25], [-5.25, 0.05], [-5.1, 0.35], [-4.6, 0.55]], 0.14);
  wing.rotateX(-Math.PI / 2);
  add(wing, paint, 0, -0.35, -0.6);

  // Round symbols on top of the wings
  for (const x of [-3.6, 3.6]) {
    const outer = new THREE.CircleGeometry(0.6, 24);
    outer.rotateX(-Math.PI / 2);
    add(outer, white, x, -0.24, -0.65);
    const inner = new THREE.CircleGeometry(0.38, 24);
    inner.rotateX(-Math.PI / 2);
    add(inner, blue, x, -0.235, -0.65);
  }

  // TAIL: small flat wing and the tall fin
  const tailWing = flatPiece([[0, 0.45], [1.6, 0.25], [1.8, 0], [1.6, -0.35], [0, -0.5],
                              [-1.6, -0.35], [-1.8, 0], [-1.6, 0.25]], 0.1);
  tailWing.rotateX(-Math.PI / 2);
  add(tailWing, paint, 0, 0.1, 3.0);

  const fin = flatPiece([[0.7, 0], [-0.9, 0], [-0.95, 1.5], [-0.55, 1.6], [0.1, 0.45]], 0.1);
  fin.rotateY(Math.PI / 2);
  add(fin, paint, 0, 0.2, 3.0);

  // COCKPIT: a glass bubble with the pilot inside
  const canopy = new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(1, 0.9, 2.0);
  hideInCockpit.push(
    add(canopy, glass, 0, 0.55, -0.3),
    add(new THREE.SphereGeometry(0.2, 12, 10), skin, 0, 0.72, -0.15),
    add(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet, 0, 0.74, -0.13));

  // WHEELS
  for (const x of [-1.4, 1.4]) {
    add(new THREE.BoxGeometry(0.08, 0.7, 0.08), metal, x, -0.75, -0.7);
    const wheel = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 16);
    wheel.rotateZ(Math.PI / 2);
    add(wheel, dark, x, -1.1, -0.7);
  }
  const tailWheel = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12);
  tailWheel.rotateZ(Math.PI / 2);
  add(tailWheel, dark, 0, -0.45, 3.2);

  plane.traverse((part) => { part.castShadow = true; });
  blur.castShadow = false;

  plane.rotation.order = 'YXZ'; // turn first, then nose up/down, then tilt the wings
  return plane;
}

// 💣 A BOMB. Its nose points toward +Z so we can aim it with lookAt().
export function makeBomb() {
  const bomb = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x4b5320, metalness: 0.4, roughness: 0.5 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 12), olive);
  body.rotation.x = Math.PI / 2;
  bomb.add(body);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.1, 12), yellow);
  band.rotation.x = Math.PI / 2;
  band.position.z = 0.35;
  bomb.add(band);

  for (const [w, h] of [[0.9, 0.05], [0.05, 0.9]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), olive);
    fin.position.z = -0.75;
    bomb.add(fin);
  }
  bomb.traverse((part) => { part.castShadow = true; });
  return bomb;
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
