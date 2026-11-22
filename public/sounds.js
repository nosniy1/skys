// 🔊 All the sounds in the game are made with code, using the "Web Audio" system
// that is built into web browsers. No sound files needed!

export class Sounds {
  // Browsers only allow sound after you click, so we call this when you click "start".
  init() {
    const ctx = new AudioContext();
    this.ctx = ctx;

    // The compressor stops very loud sounds (like bombs) from crackling
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 6;
    compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(compressor);

    // A buffer full of random "noise". Noise sounds like wind or explosions.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.startEngine();
    this.startWind();
    this.startMusic();
  }

  // Helpers to make a sound shape: quickly loud, then fading out
  volume(start, end, seconds, time) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(start, time);
    gain.gain.exponentialRampToValueAtTime(end, time + seconds);
    gain.connect(this.master);
    return gain;
  }

  noiseSource(time, seconds) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.start(time);
    source.stop(time + seconds);
    return source;
  }

  filter(type, frequency) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    return f;
  }

  // ---------- ENGINE: a buzzing "vrrrrr" that goes "chop chop" like a propeller ----------
  startEngine() {
    const ctx = this.ctx;
    this.engine1 = ctx.createOscillator();
    this.engine2 = ctx.createOscillator();
    this.engine1.type = 'sawtooth';
    this.engine2.type = 'square';
    const lowpass = this.filter('lowpass', 500);

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

    this.engine1.connect(lowpass);
    this.engine2.connect(lowpass);
    lowpass.connect(chop).connect(this.engineVolume).connect(this.master);
    this.engine1.start();
    this.engine2.start();
    this.chopper.start();
  }

  // ---------- WIND: a "whoosh" that gets louder when you go fast ----------
  startWind() {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    this.windFilter = this.filter('bandpass', 600);
    this.windFilter.Q.value = 0.8;
    this.windVolume = this.ctx.createGain();
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
    this.engineVolume.gain.setTargetAtTime(alive ? 0.1 + speed * 0.0006 : 0, t, 0.1);

    let wind = alive ? Math.max(0, (speed - 30) / 70) * 0.3 : 0;
    if (alive && nearBuilding) wind += 0.2;
    this.windVolume.gain.setTargetAtTime(wind, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(400 + speed * 12, t, 0.2);
  }

  // ---------- SHOOT: a loud "pew!" with a little "tak". loudness: 1 = close, 0 = far ----------
  shoot(loudness = 1) {
    if (!this.ctx || loudness <= 0.01) return;
    const L = loudness;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.13);
    osc.connect(this.volume(0.35 * L, 0.001, 0.13, t));
    osc.start(t);
    osc.stop(t + 0.14);

    this.noiseSource(t, 0.06).connect(this.filter('highpass', 2000)).connect(this.volume(0.5 * L, 0.001, 0.06, t));
  }

  // ---------- BOOST: a rising "whoooOOSH" ----------
  boost() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const band = this.filter('bandpass', 300);
    band.Q.value = 2;
    band.frequency.setValueAtTime(300, t);
    band.frequency.exponentialRampToValueAtTime(3000, t + 0.7);
    const vol = this.volume(0.001, 0.6, 0.2, t);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    this.noiseSource(t, 1).connect(band).connect(vol);
  }

  // ---------- BOMB DROP: a "clunk", then a whistle while it falls ----------
  bombDrop() {
    if (!this.ctx) return { stop() {} };
    const t = this.ctx.currentTime;
    const clunk = this.ctx.createOscillator();
    clunk.frequency.setValueAtTime(220, t);
    clunk.frequency.exponentialRampToValueAtTime(80, t + 0.1);
    clunk.connect(this.volume(0.4, 0.001, 0.12, t));
    clunk.start(t);
    clunk.stop(t + 0.12);

    const whistle = this.ctx.createOscillator();
    whistle.frequency.setValueAtTime(1400, t + 0.2);
    whistle.frequency.exponentialRampToValueAtTime(350, t + 4);
    const vol = this.ctx.createGain();
    vol.gain.setValueAtTime(0, t);
    vol.gain.linearRampToValueAtTime(0.07, t + 0.5);
    vol.connect(this.master);
    whistle.connect(vol);
    whistle.start(t + 0.2);
    whistle.stop(t + 6);
    return {
      stop: () => {
        vol.gain.cancelScheduledValues(this.ctx.currentTime);
        vol.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      },
    };
  }

  // ---------- BOOM: a huge explosion. loudness goes from 0 (far away) to 1 (very close) ----------
  bigBoom(loudness = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const L = loudness;

    // The sharp "CRACK"
    this.noiseSource(t, 0.25).connect(this.filter('highpass', 800)).connect(this.volume(1.5 * L, 0.001, 0.25, t));

    // The long rumbling
    const rumble = this.filter('lowpass', 2500);
    rumble.frequency.setValueAtTime(2500, t);
    rumble.frequency.exponentialRampToValueAtTime(60, t + 3);
    this.noiseSource(t, 3.5).connect(rumble).connect(this.volume(2.5 * L, 0.001, 3.5, t));

    // The deep "THUMP" you feel in your belly
    const thump = this.ctx.createOscillator();
    thump.frequency.setValueAtTime(100, t);
    thump.frequency.exponentialRampToValueAtTime(25, t + 1.2);
    thump.connect(this.volume(2.5 * L, 0.001, 1.4, t));
    thump.start(t);
    thump.stop(t + 1.4);
  }

  // ---------- HIT: "klang!" when a bullet hits a plane ----------
  hit(loudness = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const frequency of [520, 1230]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(frequency, t);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.6, t + 0.2);
      osc.connect(this.volume(0.2 * loudness, 0.001, 0.2, t));
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }

  // ---------- POP: when you hit a balloon ----------
  pop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500, t);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 0.15);
    osc.connect(this.volume(0.5, 0.001, 0.25, t));
    osc.start(t);
    osc.stop(t + 0.25);
  }

  // ---------- MUSIC: a happy little tune that repeats ----------
  startMusic() {
    const ctx = this.ctx;
    this.musicVolume = ctx.createGain();
    this.musicVolume.gain.value = 0.08;
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
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = 440 * Math.pow(2, (key - 69) / 12);
    const vol = this.ctx.createGain();
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
    this.musicVolume.gain.setTargetAtTime(this.musicOn ? 0.08 : 0, this.ctx.currentTime, 0.1);
  }
}
