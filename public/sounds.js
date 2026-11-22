// All the sounds in the game are made with code, using the "Web Audio" system
// that is built into web browsers. No sound files needed!

export class Sounds {
  // Browsers only allow sound after you click, so we call this when you click "start".
  init() {
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // A buffer full of random "noise". Noise sounds like wind or explosions.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.startEngine();
    this.startWind();
    this.startMusic();
  }

  // ---------- ENGINE: a buzzing "vrrrrr" that goes "chop chop" like a propeller ----------
  startEngine() {
    const ctx = this.ctx;
    this.engine1 = ctx.createOscillator();
    this.engine2 = ctx.createOscillator();
    this.engine1.type = 'sawtooth';
    this.engine2.type = 'square';

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;

    // The "chop" makes the volume go up and down very fast
    const chop = ctx.createGain();
    chop.gain.value = 0.6;
    this.chopper = ctx.createOscillator();
    this.chopper.frequency.value = 20;
    const chopAmount = ctx.createGain();
    chopAmount.gain.value = 0.4;
    this.chopper.connect(chopAmount).connect(chop.gain);

    this.engineVolume = ctx.createGain();
    this.engineVolume.gain.value = 0;

    this.engine1.connect(filter);
    this.engine2.connect(filter);
    filter.connect(chop).connect(this.engineVolume).connect(this.master);
    this.engine1.start();
    this.engine2.start();
    this.chopper.start();
  }

  // ---------- WIND: a "whoosh" that gets louder when you go fast ----------
  startWind() {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.8;
    this.windVolume = ctx.createGain();
    this.windVolume.gain.value = 0;
    source.connect(this.windFilter).connect(this.windVolume).connect(this.master);
    source.start();
  }

  // Called every frame so the engine and wind follow your speed
  update(speed, alive, nearBuilding) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const pitch = 45 + speed * 0.9;
    this.engine1.frequency.setTargetAtTime(pitch, t, 0.1);
    this.engine2.frequency.setTargetAtTime(pitch * 1.01, t, 0.1);
    this.chopper.frequency.setTargetAtTime(10 + speed * 0.35, t, 0.1);
    this.engineVolume.gain.setTargetAtTime(alive ? 0.12 + speed * 0.0008 : 0, t, 0.1);

    let wind = alive ? Math.max(0, (speed - 30) / 70) * 0.35 : 0;
    if (alive && nearBuilding) wind += 0.25;
    this.windVolume.gain.setTargetAtTime(wind, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(400 + speed * 12, t, 0.2);
  }

  // ---------- SHOOT: "pew!" ----------
  shoot() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(250, t + 0.12);
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.08, t);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(vol).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  // ---------- BOOST: a rising "whoooOOSH" ----------
  boost() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(3000, t + 0.7);
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.001, t);
    vol.gain.exponentialRampToValueAtTime(0.6, t + 0.2);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    source.connect(filter).connect(vol).connect(this.master);
    source.start(t);
    source.stop(t + 1);
  }

  // ---------- BOOM: a big explosion ----------
  boom() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;

    // The crackle
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1500, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + 1.5);
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(1.2, t);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    source.connect(filter).connect(vol).connect(this.master);
    source.start(t);
    source.stop(t + 2);

    // The deep "thump"
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    const thump = ctx.createGain();
    thump.gain.setValueAtTime(1, t);
    thump.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.connect(thump).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.8);
  }

  // ---------- POP: when you hit a balloon ----------
  pop() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500, t);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 0.15);
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.4, t);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(vol).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  // ---------- MUSIC: a happy little tune that repeats ----------
  startMusic() {
    const ctx = this.ctx;
    this.musicVolume = ctx.createGain();
    this.musicVolume.gain.value = 0.1;
    this.musicVolume.connect(this.master);
    this.musicOn = true;

    // Each number is a piano key (60 = middle C). 8 notes per bar, 4 bars.
    const melody = [
      72, 76, 79, 76, 72, 76, 79, 84,
      71, 74, 79, 74, 71, 74, 79, 83,
      72, 76, 81, 76, 72, 76, 81, 84,
      72, 77, 81, 77, 72, 77, 79, 77,
    ];
    const bass = [48, 43, 45, 41]; // one bass note per bar: C, G, A, F
    const stepTime = 0.2;           // seconds per note (try changing it!)

    let step = 0;
    let nextTime = ctx.currentTime + 0.1;
    // Every 50 milliseconds we plan the next few notes ahead of time
    setInterval(() => {
      while (nextTime < ctx.currentTime + 0.3) {
        const s = step % melody.length;
        this.note(melody[s], nextTime, stepTime * 0.9, 'triangle', 0.5);
        if (s % 4 === 0) this.note(bass[Math.floor(s / 8)], nextTime, stepTime * 3.5, 'sine', 0.9);
        nextTime += stepTime;
        step++;
      }
    }, 50);
  }

  note(key, time, length, type, loudness) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = 440 * Math.pow(2, (key - 69) / 12);
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(0.001, time);
    vol.gain.exponentialRampToValueAtTime(loudness, time + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.001, time + length);
    osc.connect(vol).connect(this.musicVolume);
    osc.start(time);
    osc.stop(time + length);
  }

  toggleMusic() {
    if (!this.ctx) return;
    this.musicOn = !this.musicOn;
    this.musicVolume.gain.setTargetAtTime(this.musicOn ? 0.1 : 0, this.ctx.currentTime, 0.1);
  }
}
