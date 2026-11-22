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

    // The "muffler" makes everything sound far away (like after a HUGE explosion)
    this.muffler = ctx.createBiquadFilter();
    this.muffler.type = 'lowpass';
    this.muffler.frequency.value = 20000;
    this.muffler.connect(compressor);

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.muffler);

    // A buffer full of random "noise". Noise sounds like wind or explosions.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.startEngine();
    this.startWind();
    this.startRain();
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

    // JET ENGINE: a high whine and a deep roar (only used by the jet)
    this.engineKind = 'propeller';
    this.jetWhine = ctx.createOscillator();
    this.jetWhine.type = 'sawtooth';
    this.jetVolume = ctx.createGain();
    this.jetVolume.gain.value = 0;
    this.jetWhine.connect(this.filter('lowpass', 2500)).connect(this.jetVolume).connect(this.master);
    this.jetWhine.start();
    const roar = ctx.createBufferSource();
    roar.buffer = this.noise;
    roar.loop = true;
    this.roarFilter = this.filter('lowpass', 600);
    this.roarVolume = ctx.createGain();
    this.roarVolume.gain.value = 0;
    roar.connect(this.roarFilter).connect(this.roarVolume).connect(this.master);
    roar.start();
  }

  // 'propeller' or 'jet'
  setEngine(kind) {
    this.engineKind = kind;
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
    // The helicopter goes "wop wop wop" (slower chopping); cars just hum quietly
    const chopSpeed = this.engineKind === 'heli' ? 9 + speed * 0.05 : 10 + speed * 0.35;
    this.chopper.frequency.setTargetAtTime(this.engineKind === 'car' ? 30 : chopSpeed, t, 0.1);
    const jet = this.engineKind === 'jet';
    this.engineVolume.gain.setTargetAtTime(alive && !jet ? 0.1 + speed * 0.0006 : 0, t, 0.1);
    this.jetWhine.frequency.setTargetAtTime(250 + speed * 5, t, 0.2);
    this.jetVolume.gain.setTargetAtTime(alive && jet ? 0.015 + speed * 0.0002 : 0, t, 0.2);
    this.roarVolume.gain.setTargetAtTime(alive && jet ? 0.08 + speed * 0.0025 : 0, t, 0.2);
    this.roarFilter.frequency.setTargetAtTime(300 + speed * 6, t, 0.2);

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

  // ---------- RAIN: a soft "shhhhh" that is louder when it rains harder ----------
  startRain() {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    this.rainVolume = this.ctx.createGain();
    this.rainVolume.gain.value = 0;
    source.connect(this.filter('highpass', 1500)).connect(this.rainVolume).connect(this.master);
    source.start();
  }

  setRain(amount) {
    if (this.ctx) this.rainVolume.gain.setTargetAtTime(amount * 0.12, this.ctx.currentTime, 0.5);
  }

  // ---------- THUNDER: "KRRRAAACK... rumble rumble" ----------
  thunder(delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    this.noiseSource(t, 0.4).connect(this.filter('highpass', 400)).connect(this.volume(1.2, 0.001, 0.4, t));
    const low = this.filter('lowpass', 200);
    const vol = this.ctx.createGain();
    vol.gain.setValueAtTime(0.001, t);
    vol.gain.exponentialRampToValueAtTime(2, t + 0.3);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 4);
    vol.connect(this.master);
    this.noiseSource(t, 4).connect(low).connect(vol);
  }

  // ---------- 🚓 POLICE SIREN: "wee-woo wee-woo", louder when they are close ----------
  policeSiren(loudness) {
    if (!this.ctx) return;
    if (!this.police) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      const wobble = this.ctx.createOscillator();   // switches between two notes
      wobble.type = 'square';
      wobble.frequency.value = 1.4;
      const wobbleAmount = this.ctx.createGain();
      wobbleAmount.gain.value = 200;
      osc.frequency.value = 760;
      wobble.connect(wobbleAmount).connect(osc.frequency);
      const vol = this.ctx.createGain();
      vol.gain.value = 0;
      osc.connect(this.filter('lowpass', 1600)).connect(vol).connect(this.master);
      osc.start();
      wobble.start();
      this.police = vol;
    }
    this.police.gain.setTargetAtTime(loudness * 0.06, this.ctx.currentTime, 0.2);
  }

  // ---------- 💵 CASH: "cha-ching!" ----------
  cash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseSource(t, 0.08).connect(this.filter('highpass', 3000)).connect(this.volume(0.4, 0.001, 0.08, t));
    this.note(96, t + 0.08, 0.35, 'triangle', 0.3, this.master);
    this.note(100, t + 0.14, 0.4, 'triangle', 0.3, this.master);
  }

  // ---------- 🔔 BANK ALARM: "RIIIING!" ----------
  alarm() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1100;
    const vol = this.ctx.createGain();
    for (let i = 0; i < 40; i++) {                   // ring-ring-ring for 4 seconds
      vol.gain.setValueAtTime(i % 2 ? 0 : 0.08, t + i * 0.1);
    }
    vol.gain.setValueAtTime(0, t + 4);
    osc.connect(vol).connect(this.master);
    osc.start(t);
    osc.stop(t + 4);
  }

  // ---------- 🚪 DOOR: "creeeak" ----------
  creak() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.linearRampToValueAtTime(320, t + 0.25);
    osc.frequency.linearRampToValueAtTime(140, t + 0.6);
    const vol = this.ctx.createGain();
    vol.gain.setValueAtTime(0.001, t);
    vol.gain.linearRampToValueAtTime(0.06, t + 0.1);
    vol.gain.linearRampToValueAtTime(0, t + 0.6);
    osc.connect(this.filter('bandpass', 700)).connect(vol).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  // ---------- COIN: "ding!" ----------
  coin() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.note(88, t, 0.08, 'square', 0.25, this.master);
    this.note(93, t + 0.07, 0.3, 'square', 0.25, this.master);
  }

  // ---------- HORN: "honk honk!" ----------
  horn(loudness = 1) {
    if (!this.ctx || loudness <= 0.01) return;
    const t = this.ctx.currentTime;
    for (const start of [0, 0.25]) {
      for (const frequency of [349, 440]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = frequency;
        const vol = this.ctx.createGain();
        vol.gain.setValueAtTime(0.12 * loudness, t + start);
        vol.gain.setValueAtTime(0.12 * loudness, t + start + 0.18);
        vol.gain.linearRampToValueAtTime(0, t + start + 0.2);
        osc.connect(this.filter('lowpass', 1800)).connect(vol).connect(this.master);
        osc.start(t + start);
        osc.stop(t + start + 0.21);
      }
    }
  }

  // ---------- SPLASH: when something falls in the sea ----------
  splash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const band = this.filter('bandpass', 1200);
    band.frequency.setValueAtTime(2500, t);
    band.frequency.exponentialRampToValueAtTime(300, t + 1);
    this.noiseSource(t, 1.2).connect(band).connect(this.volume(1.5, 0.001, 1.2, t));
  }

  // ---------- ☢️ NUKE SIREN: "WOOOooOOOooo" while the nuke falls ----------
  siren(seconds) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    for (let s = 0; s < seconds; s += 2) {
      osc.frequency.setValueAtTime(350, t + s);
      osc.frequency.linearRampToValueAtTime(900, t + s + 1);
      osc.frequency.linearRampToValueAtTime(350, t + s + 2);
    }
    const vol = this.ctx.createGain();
    vol.gain.setValueAtTime(0.12, t);
    vol.gain.setValueAtTime(0.12, t + seconds - 0.1);
    vol.gain.linearRampToValueAtTime(0, t + seconds);
    osc.connect(this.filter('lowpass', 2000)).connect(vol).connect(this.master);
    osc.start(t);
    osc.stop(t + seconds);
    this.sirenSound = { osc, vol };
  }

  stopSiren() {
    if (!this.sirenSound) return;
    const t = this.ctx.currentTime;
    this.sirenSound.vol.gain.cancelScheduledValues(t);
    this.sirenSound.vol.gain.setTargetAtTime(0, t, 0.05);
    this.sirenSound = null;
  }

  // ---------- ☢️ THE NUKE: the BIGGEST, LOUDEST boom ever ----------
  nukeBoom() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // a blinding CRACK
    this.noiseSource(t, 0.6).connect(this.filter('highpass', 300)).connect(this.volume(3, 0.001, 0.6, t));
    // a giant thump you feel in your whole body
    const thump = this.ctx.createOscillator();
    thump.frequency.setValueAtTime(70, t);
    thump.frequency.exponentialRampToValueAtTime(18, t + 4);
    thump.connect(this.volume(4, 0.001, 5, t));
    thump.start(t);
    thump.stop(t + 5);
    // a rumble that goes on and on...
    const low = this.filter('lowpass', 900);
    low.frequency.setValueAtTime(900, t);
    low.frequency.exponentialRampToValueAtTime(50, t + 12);
    const vol = this.ctx.createGain();
    vol.gain.setValueAtTime(3.5, t);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 13);
    vol.connect(this.master);
    this.noiseSource(t, 13).connect(low).connect(vol);
    // a second, even longer rumble of the shock waves
    const deep = this.filter('lowpass', 250);
    const deepVolume = this.ctx.createGain();
    deepVolume.gain.setValueAtTime(0.001, t);
    deepVolume.gain.exponentialRampToValueAtTime(3, t + 2);
    deepVolume.gain.exponentialRampToValueAtTime(0.001, t + 22);
    deepVolume.connect(this.master);
    this.noiseSource(t, 22).connect(deep).connect(deepVolume);
    // and the shock waves arriving one after the other
    for (const delay of [1.2, 2.5, 3.8, 6, 9]) this.thunder(delay);

    // Your ears are ringing... everything sounds muffled for a while
    this.muffler.frequency.cancelScheduledValues(t);
    this.muffler.frequency.setValueAtTime(20000, t);
    this.muffler.frequency.setValueAtTime(20000, t + 0.6);
    this.muffler.frequency.exponentialRampToValueAtTime(350, t + 1.2);
    this.muffler.frequency.setValueAtTime(350, t + 5);
    this.muffler.frequency.exponentialRampToValueAtTime(20000, t + 14);
    const ring = this.ctx.createOscillator();
    ring.frequency.value = 3900;
    const ringVolume = this.ctx.createGain();
    ringVolume.gain.setValueAtTime(0.001, t + 0.6);
    ringVolume.gain.exponentialRampToValueAtTime(0.12, t + 1.5);
    ringVolume.gain.exponentialRampToValueAtTime(0.001, t + 11);
    ring.connect(ringVolume).connect(this.ctx.destination);   // the ringing is inside your head, so it isn't muffled
    ring.start(t);
    ring.stop(t + 11);
  }

  // ---------- MISSILE: a "FSSHHHH" when it launches ----------
  missileLaunch(loudness = 1) {
    if (!this.ctx || loudness <= 0.01) return;
    const t = this.ctx.currentTime;
    const band = this.filter('bandpass', 800);
    band.frequency.setValueAtTime(800, t);
    band.frequency.exponentialRampToValueAtTime(2500, t + 0.4);
    band.frequency.exponentialRampToValueAtTime(600, t + 1.5);
    const vol = this.volume(0.9 * loudness, 0.001, 1.6, t);
    this.noiseSource(t, 1.6).connect(band).connect(vol);
  }

  // ---------- BEEP: for warnings and countdowns ----------
  beep(frequency = 1000, seconds = 0.1, loudness = 0.25) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = frequency;
    const vol = this.ctx.createGain();
    vol.gain.setValueAtTime(loudness, t);
    vol.gain.setValueAtTime(loudness, t + seconds * 0.8);
    vol.gain.linearRampToValueAtTime(0, t + seconds);
    osc.connect(vol).connect(this.master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  // ---------- RUMBLE: a building falling down ----------
  rumble(loudness = 1) {
    if (!this.ctx || loudness <= 0.01) return;
    const t = this.ctx.currentTime;
    const low = this.filter('lowpass', 300);
    const vol = this.ctx.createGain();
    vol.gain.setValueAtTime(0.001, t);
    vol.gain.exponentialRampToValueAtTime(1.5 * loudness, t + 0.5);
    vol.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
    vol.connect(this.master);
    this.noiseSource(t, 3.5).connect(low).connect(vol);
  }

  // ---------- POWER-UP: a happy "ding-ding-ding!" going up ----------
  powerUp() {
    if (!this.ctx) return;
    [72, 76, 79, 84].forEach((key, i) => this.note(key, this.ctx.currentTime + i * 0.08, 0.3, 'square', 0.4, this.master));
  }

  // ---------- FANFARE: for the winner! ----------
  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const tune = [[67, 0, 0.15], [72, 0.15, 0.15], [76, 0.3, 0.15], [79, 0.45, 0.4], [76, 0.85, 0.15], [79, 1.0, 0.8]];
    for (const [key, start, length] of tune) {
      this.note(key, t + start, length, 'square', 0.35, this.master);
      this.note(key - 12, t + start, length, 'triangle', 0.5, this.master);
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

  note(key, time, length, type, loudness, output = this.musicVolume) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = 440 * Math.pow(2, (key - 69) / 12);
    const vol = this.ctx.createGain();
    vol.gain.setValueAtTime(0.001, time);
    vol.gain.exponentialRampToValueAtTime(loudness, time + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.001, time + length);
    osc.connect(vol).connect(output);
    osc.start(time);
    osc.stop(time + length);
  }

  toggleMusic() {
    if (!this.ctx) return;
    this.musicOn = !this.musicOn;
    this.musicVolume.gain.setTargetAtTime(this.musicOn ? 0.08 : 0, this.ctx.currentTime, 0.1);
  }
}
