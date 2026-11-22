// 🌧️ WEATHER: clear, cloudy, rain, thunderstorms and fog. The server decides, so it's the same for everybody.
import * as THREE from 'three';

// How each kind of weather looks: gloom = how dark and gray, rain, storm = lightning, fog
const LOOKS = {
  clear:  { gloom: 0,    rain: 0, storm: 0, fog: 0 },
  cloudy: { gloom: 0.4,  rain: 0, storm: 0, fog: 0.1 },
  rain:   { gloom: 0.6,  rain: 1, storm: 0, fog: 0.25 },
  storm:  { gloom: 0.85, rain: 1, storm: 1, fog: 0.35 },
  fog:    { gloom: 0.35, rain: 0, storm: 0, fog: 1 },
};
export const WEATHER_NAMES = { clear: '☀️ Sunny', cloudy: '☁️ Cloudy', rain: '🌧️ Rain', storm: '⛈️ Thunderstorm', fog: '🌫️ Fog' };

const DROPS = 2500;
const AREA = 130;

export class Weather {
  constructor(scene, sounds, hemisphere, kind) {
    this.scene = scene;
    this.sounds = sounds;
    this.hemisphere = hemisphere;
    this.kind = kind;
    this.now = { ...(LOOKS[kind] || LOOKS.clear) };
    this.target = LOOKS[kind] || LOOKS.clear;
    this.flash = 0;
    this.lightningTimer = 3;

    // Raindrops: little lines falling down
    this.drops = new Float32Array(DROPS * 6);
    for (let i = 0; i < DROPS; i++) this.resetDrop(i, new THREE.Vector3(), true);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.drops, 3));
    this.rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xaaccee, transparent: true, opacity: 0 }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // A lightning bolt: a zig-zag line in the sky
    this.bolt = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, fog: false }));
    this.bolt.visible = false;
    scene.add(this.bolt);
  }

  set(kind) {
    this.kind = kind;
    this.target = LOOKS[kind] || LOOKS.clear;
  }

  resetDrop(i, center, anywhere) {
    const x = center.x + (Math.random() - 0.5) * AREA * 2;
    const z = center.z + (Math.random() - 0.5) * AREA * 2;
    const y = center.y + (anywhere ? (Math.random() - 0.5) * 120 : 60 + Math.random() * 10);
    this.drops.set([x, y, z, x + 0.3, y - 2.5, z], i * 6);
  }

  makeBolt(center) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 500 + Math.random() * 1200;
    let x = center.x + Math.cos(angle) * distance, z = center.z + Math.sin(angle) * distance, y = 450;
    const points = [];
    while (y > 0) {
      points.push(new THREE.Vector3(x, y, z));
      x += (Math.random() - 0.5) * 40;
      z += (Math.random() - 0.5) * 40;
      y -= 20 + Math.random() * 30;
    }
    points.push(new THREE.Vector3(x, 0, z));
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.BufferGeometry().setFromPoints(points);
    return distance;
  }

  update(dt, cameraPosition) {
    // Slowly change to the new weather
    for (const k in this.now) this.now[k] += (this.target[k] - this.now[k]) * Math.min(1, dt * 0.15);

    // Rain
    const raining = this.now.rain > 0.02 && !this.indoors;   // no rain inside buildings!
    this.rain.visible = raining;
    this.rain.material.opacity = this.now.rain * 0.55;
    if (raining) {
      for (let i = 0; i < DROPS; i++) {
        const o = i * 6;
        this.drops[o + 1] -= 90 * dt;
        this.drops[o + 4] -= 90 * dt;
        this.drops[o] += 6 * dt;
        this.drops[o + 3] += 6 * dt;
        if (this.drops[o + 1] < cameraPosition.y - 60 || Math.abs(this.drops[o] - cameraPosition.x) > AREA ||
            Math.abs(this.drops[o + 2] - cameraPosition.z) > AREA) {
          this.resetDrop(i, cameraPosition, false);
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    this.sounds.setRain(this.indoors ? this.now.rain * 0.2 : this.now.rain);

    // Fog: you can't see very far
    this.scene.fog.near = THREE.MathUtils.lerp(600, 25, this.now.fog);
    this.scene.fog.far = THREE.MathUtils.lerp(4200, 450, this.now.fog);

    // Lightning! A flash, a bolt, and thunder a bit later (sound is slower than light)
    if (this.now.storm > 0.5) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 4 + Math.random() * 8;
        this.flash = 1;
        const distance = this.makeBolt(cameraPosition);
        this.sounds.thunder(distance / 340);
      }
    }
    this.flash *= Math.exp(-dt * 7);
    this.bolt.visible = this.flash > 0.3;
    this.hemisphere.intensity += this.flash * 5;
  }
}
