// 🗺️ THE MINI-MAP in the bottom-left corner, like in GTA.
// It turns with you: the top of the map is always the way you are facing.
const SIZE = 220;            // pixels
const RADIUS = SIZE / 2;
const METERS = 700;          // how many meters from the middle to the edge of the map
const SCALE = RADIUS / METERS;
const WORLD = 3200;          // the map picture covers 3200 x 3200 meters
const PIXELS_PER_METER = 0.25;

export class Minimap {
  constructor(world) {
    this.world = world;
    this.canvas = document.getElementById('minimap');
    this.canvas.width = this.canvas.height = SIZE;
    this.g = this.canvas.getContext('2d');
    this.background = document.createElement('canvas');
    this.background.width = this.background.height = WORLD * PIXELS_PER_METER;
    this.refresh();
  }

  // Draw the city, airport and sea once (and again after buildings fall down)
  refresh() {
    const g = this.background.getContext('2d');
    const k = PIXELS_PER_METER, w = this.world, half = WORLD / 2;
    const px = (x) => (x + half) * k;
    g.fillStyle = '#4f9a3f';
    g.fillRect(0, 0, WORLD * k, WORLD * k);
    g.fillStyle = '#e8d6a0';                                                   // beach
    g.fillRect(px(w.citySize / 2 + 30), 0, (w.coast.shore - w.citySize / 2 - 30) * k, WORLD * k);
    g.fillStyle = '#2f7fbf';                                                   // sea
    g.fillRect(px(w.coast.shore), 0, WORLD * k, WORLD * k);
    g.fillStyle = '#5a5b60';                                                   // city streets
    g.fillRect(px(-w.citySize / 2), px(-w.citySize / 2), w.citySize * k, w.citySize * k);
    g.fillStyle = '#5cb84a';                                                   // central park
    g.fillRect(px(-53), px(-53), 106 * k, 106 * k);
    const a = w.airport;                                                       // the airport
    g.fillStyle = '#9a9a96';
    g.fillRect(px(a.x - 135), px(-190), 110 * k, 380 * k);
    g.fillStyle = '#2b2c30';
    g.fillRect(px(a.x - a.width / 2), px(-a.length / 2), a.width * k, a.length * k);
    for (const b of w.buildings) {                                             // buildings
      if (b.height < 8) continue;
      g.fillStyle = b.height > 80 ? '#e0e0e0' : '#b8b8b8';
      g.fillRect(px(b.minX), px(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
    }
  }

  // things: [{ x, z, color, size, shape: 'dot' | 'square' | 'nuke', blink }]
  draw(me, heading, things, time) {
    const g = this.g;
    g.save();
    g.clearRect(0, 0, SIZE, SIZE);
    g.beginPath();
    g.arc(RADIUS, RADIUS, RADIUS - 2, 0, Math.PI * 2);
    g.clip();
    // The map, turned so that "forward" is up
    g.save();
    g.translate(RADIUS, RADIUS);
    g.rotate(heading);
    g.scale(SCALE, SCALE);
    g.translate(-me.x, -me.z);
    g.drawImage(this.background, -WORLD / 2, -WORLD / 2, WORLD, WORLD);
    g.restore();

    // Things on the map (if they are too far away, they stick to the edge)
    const cos = Math.cos(heading), sin = Math.sin(heading);
    for (const t of things) {
      if (t.blink && Math.floor(time * 4) % 2) continue;
      const dx = t.x - me.x, dz = t.z - me.z;
      let sx = (cos * dx - sin * dz) * SCALE, sy = (sin * dx + cos * dz) * SCALE;
      const d = Math.hypot(sx, sy);
      if (d > RADIUS - 8) {
        if (!t.edge) continue;
        sx *= (RADIUS - 8) / d;
        sy *= (RADIUS - 8) / d;
      }
      const x = RADIUS + sx, y = RADIUS + sy;
      g.fillStyle = t.color;
      g.strokeStyle = 'black';
      g.lineWidth = 1.5;
      if (t.shape === 'nuke') {
        g.font = `${t.size * 3}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('☢️', x, y);
      } else if (t.shape === 'square') {
        g.fillRect(x - t.size, y - t.size, t.size * 2, t.size * 2);
        g.strokeRect(x - t.size, y - t.size, t.size * 2, t.size * 2);
      } else {
        g.beginPath();
        g.arc(x, y, t.size, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }

    // Me: an arrow in the middle, always pointing up
    g.fillStyle = 'white';
    g.strokeStyle = 'black';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(RADIUS, RADIUS - 9);
    g.lineTo(RADIUS + 7, RADIUS + 7);
    g.lineTo(RADIUS, RADIUS + 3);
    g.lineTo(RADIUS - 7, RADIUS + 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // A ring around the map, and "N" for north
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(RADIUS, RADIUS, RADIUS - 2, 0, Math.PI * 2);
    g.stroke();
    const nx = RADIUS + sin * (RADIUS - 12), ny = RADIUS - cos * (RADIUS - 12);
    g.fillStyle = 'white';
    g.font = 'bold 14px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny);
  }
}
