// 🌅 DAY AND NIGHT: the sun goes around, the sky changes color, and lights turn on at night.
// The server tells everybody when the day started, so it's the same time for all players.
import * as THREE from 'three';

const DAY_LENGTH = 480;  // seconds for a whole day and night (8 minutes). Try changing it!

const color = (hex) => new THREE.Color(hex);
const SKY = {
  top:     { day: color('#2a66c9'), sunset: color('#3d4f9a'), night: color('#030714') },
  mid:     { day: color('#86bdf0'), sunset: color('#e58a6b'), night: color('#0a1430') },
  horizon: { day: color('#cfe6f7'), sunset: color('#ffb470'), night: color('#101a36') },
};
const NUKE_SKY = { top: color('#2a0500'), mid: color('#b8340a'), horizon: color('#ff7a1a') };
const NUKE_SUN = color('#ff5a1a'), HEMI_SKY = color('#cfe8ff');
const WHITE_SUN = color('#fff1dc'), ORANGE_SUN = color('#ff9a50'), MOON_LIGHT = color('#8fa8ff');

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class DayNight {
  constructor(world, sun, hemisphere, serverNow, dayStartedAt) {
    this.world = world;
    this.sun = sun;
    this.hemisphere = hemisphere;
    this.clockDifference = serverNow - Date.now(); // the server's clock might be a bit different
    this.dayStartedAt = dayStartedAt;
    this.sunDirection = new THREE.Vector3();
    this.lightDirection = new THREE.Vector3(); // where the light comes from (sun by day, moon by night)
    this.night = 0;
    this.skyTimer = 0;
    this.colors = { top: new THREE.Color(), mid: new THREE.Color(), horizon: new THREE.Color() };
    this.gray = new THREE.Color();
    this.weather = null;
    this.nukeGlow = 0;   // ☢️ after the nuke, the sky burns red and orange for a while
  }

  // The server's clock, in seconds (the same on every computer)
  get serverSeconds() {
    return (Date.now() + this.clockDifference) / 1000;
  }

  // 0 = morning, 0.25 = noon, 0.5 = evening, 0.75 = midnight
  get timeOfDay() {
    const seconds = (Date.now() + this.clockDifference - this.dayStartedAt) / 1000;
    return ((seconds / DAY_LENGTH) % 1 + 1) % 1;
  }

  update(dt) {
    const angle = this.timeOfDay * Math.PI * 2;
    const height = Math.sin(angle) * 0.75 + 0.2;           // how high the sun is in the sky
    this.sunDirection.set(Math.cos(angle), height, 0.4).normalize();

    const daylight = smoothstep(-0.15, 0.2, height);        // 1 = day, 0 = night
    const sunset = THREE.MathUtils.clamp(1 - Math.abs(height - 0.02) / 0.22, 0, 1);
    this.night = 1 - daylight;

    // The light: the sun during the day, the moon during the night
    const sunPower = smoothstep(-0.02, 0.25, height);
    if (height > -0.02) {
      this.lightDirection.copy(this.sunDirection);
      this.sun.color.copy(WHITE_SUN).lerp(ORANGE_SUN, sunset);
      this.sun.intensity = 3 * sunPower + 0.3 * this.night;
    } else {
      this.lightDirection.set(-this.sunDirection.x, Math.abs(this.sunDirection.y) + 0.4, -this.sunDirection.z).normalize();
      this.sun.color.copy(MOON_LIGHT);
      this.sun.intensity = 0.5 * this.night;
    }
    this.hemisphere.intensity = 0.3 + 1.1 * daylight;
    // ☢️ After the nuke: a red-orange glow everywhere
    this.nukeGlow = Math.max(0, this.nukeGlow - dt / 55);
    if (this.nukeGlow > 0) {
      this.sun.color.lerp(NUKE_SUN, this.nukeGlow);
      this.sun.intensity += 2 * this.nukeGlow;
      this.hemisphere.color.copy(HEMI_SKY).lerp(NUKE_SUN, this.nukeGlow);
    } else {
      this.hemisphere.color.copy(HEMI_SKY);
    }

    // Bad weather makes everything darker and grayer
    const gloom = this.weather ? this.weather.now.gloom : 0;
    this.sun.intensity *= 1 - 0.75 * gloom;
    this.hemisphere.intensity *= 1 - 0.35 * gloom;

    // The sky colors don't need to change every frame
    this.skyTimer -= dt;
    if (this.skyTimer > 0) return;
    this.skyTimer = 0.25;
    for (const part of ['top', 'mid', 'horizon']) {
      this.colors[part].copy(SKY[part].night).lerp(SKY[part].day, daylight).lerp(SKY[part].sunset, sunset * 0.85 * (1 - gloom));
      this.gray.setRGB(0.5, 0.53, 0.58).multiplyScalar(0.15 + 0.85 * daylight);
      this.colors[part].lerp(this.gray, gloom * 0.8);
      this.colors[part].lerp(NUKE_SKY[part], this.nukeGlow * 0.9);
    }
    this.world.setSkyLook({
      ...this.colors,
      sunDirection: this.sunDirection,
      sunColor: this.sun.color,
      daylight, sunset, night: this.night, gloom,
    });
  }
}
