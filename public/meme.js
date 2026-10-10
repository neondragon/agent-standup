// Meme mode: an optional costume over the call (design: docs/superpowers/specs/2026-10-10-meme-mode-design.md).
// Airhorns, hitmarkers, lens flares, Impact captions, vine booms, sad trombones, star wipes, emoji rain. It never changes
// what is shown or said, only how loudly. Off by default (⚙ → 🔥 Meme mode), intensity 1–11.
//
// Loaded before the page's own script. It reads that script's globals (prefs, S, AUD) at call time only: classic scripts
// share one global lexical scope, and nothing here runs before the page has started playing. The pure parts (MEME_CORE)
// have no DOM and also run under `node --test` (test/meme.test.js).
(function (root) {
'use strict';

// =====================================================================
//  pure parts: word picking, intensity curve, flash guard, deterministic choice
// =====================================================================
const CORE = {
  hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; },
  pick(list, seed) { return list[(seed >>> 0) % list.length]; },
  // The loud words of a line, for the kinetic captions: words already in capitals first, then the longest; no duplicates.
  words(text, max = 3) {
    const seen = new Set(), out = [];
    const ws = String(text || '').split(/[^\p{L}\p{N}'’]+/u).map((w) => w.replace(/^['’]+|['’]+$/g, '')).filter((w) => w.length >= 3 && /\p{L}/u.test(w));
    const score = (w) => (w === w.toUpperCase() ? 100 : 0) + w.length;
    for (const w of ws.sort((a, b) => score(b) - score(a))) { const k = w.toLowerCase(); if (seen.has(k) || out.length >= max) continue; seen.add(k); out.push(w.toUpperCase()); }
    return out;
  },
  // Intensity 1–11 → how often the optional extras fire, how long each effect rests, how hard the screen shakes, how much stuff rains.
  scale(level) {
    const n = Math.round(+level), l = Number.isFinite(n) ? Math.max(1, Math.min(11, n)) : 11, t = (l - 1) / 10;
    return { level: l, chance: +(0.2 + 0.8 * t).toFixed(3), cooldown: Math.round(6000 - 5400 * t), shake: +(2 + 16 * t).toFixed(1), particles: Math.round(6 + 34 * t) };
  },
  // Full-screen flashes are capped whatever the intensity: at most `max` in any `win` ms.
  FlashGuard: class {
    constructor(max = 3, win = 1000, now = () => Date.now()) { this.max = max; this.win = win; this.now = now; this.times = []; }
    ok() { const t = this.now(); this.times = this.times.filter((x) => t - x < this.win); if (this.times.length >= this.max) return false; this.times.push(t); return true; }
  },
};

// =====================================================================
//  the mode itself: sounds (WebAudio synth + one bundled clip) and visuals (#memeLayer over the stage)
// =====================================================================
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const T = (fr, en) => (typeof prefs !== 'undefined' && prefs.lang === 'fr' ? fr : en);
const nameOf = (id) => (((typeof S !== 'undefined' && S.agents) || {})[id] || {}).name || id;

const MEME = {
  CORE, on: false, bus: null, nb: null, clips: new Map(), guard: new CORE.FlashGuard(), last: {}, timer: 0, rm: false,
  CLIPS: { omg: '/sfx/oh-my-god.mp3', scratch1: '/sfx/scratch-1.mp3', scratch2: '/sfx/scratch-2.mp3', scratch3: '/sfx/scratch-3.mp3' },   // bundled clips: name → file under public/
  PAL: ['#fff', '#ffe600', '#ff3b3b', '#3bff6e', '#52d8ff', '#ff5cf0'],
  WINS: () => ['GG', 'W', 'EZ', 'POGGERS', 'NO SCOPE', 'OH BABY', 'BASED', 'SHEEEESH', 'CERTIFIED HOOD CLASSIC', 'ABSOLUTE UNIT', 'LET HIM COOK'].concat(T(['BIEN OUEJ', 'C’EST PAS FAUX', 'OKLM', 'MAIS OUI C’EST CLAIR'], [])),
  FAILS: () => ['BRUH', 'TASK FAILED SUCCESSFULLY', 'OH NO', 'EMOTIONAL DAMAGE', 'SKILL ISSUE', 'IT’S OVER', 'RIP', 'F IN THE CHAT', 'WHO DID THIS', 'WORKS ON MY MACHINE', 'CRINGE'].concat(T(['OH LE BOULET', 'C’EST LA CATA', 'MAIS NON', 'LA FRANCE A PEUR'], [])),
  STALLS: () => ['👁👄👁', T('tout va bien 🔥🐶', 'this is fine 🔥🐶'), 'hello?? 📞', T('⏳ ça vient ça vient', '⏳ any day now'), T('il est en train de CUISINER 🧑‍🍳', 'bro is COOKING 🧑‍🍳'), 'AFK?', T('*grillons*', '*crickets*')],
  COMBOS: ['WOMBO COMBO', 'OH BABY A TRIPLE', 'TRIPLE KILL', 'HOLY MOLY', 'MULTI-TRACK DRIFTING'],

  // ---------- lifecycle ----------
  active() { return !!(this.on && typeof S !== 'undefined' && S.playing && !S.recomputing && !document.hidden); },
  sound() { return !!(this.on && this.bus && typeof AUD !== 'undefined' && AUD.ctx && !AUD.off()); },
  cfg() { return CORE.scale(typeof prefs !== 'undefined' ? prefs.memeLevel : 11); },
  roll(k = 1) { return Math.random() < this.cfg().chance * k; },
  rest(key, mul = 1) { const now = performance.now(); if (now < (this.last[key] || 0)) return false; this.last[key] = now + this.cfg().cooldown * mul; return true; },
  apply() {   // called when the switch, the mute state or the audio ownership changes, and once at start-up
    this.on = !!(typeof prefs !== 'undefined' && prefs.meme);
    document.body.classList.toggle('meme', this.on);
    this.rm = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);   // the switch is an explicit ask for motion, so this only turns off full-screen flashes and wipes
    this.ensureBus(); if (this.bus) this.bus.gain.value = this.sound() ? (prefs.memeVol ?? 0.8) : 0;
    if (this.on && !this.timer) this.timer = setInterval(() => this.tick(), 4000);
    if (!this.on) { clearInterval(this.timer); this.timer = 0; const l = document.getElementById('memeLayer'); if (l) l.innerHTML = ''; document.querySelectorAll('.mm-fry, .mm-zoom').forEach((t) => t.classList.remove('mm-fry', 'mm-zoom')); }
  },
  ensureBus() { if (this.bus || typeof AUD === 'undefined' || !AUD.ctx) return; const c = AUD.ctx; this.bus = c.createGain(); this.bus.connect(c.destination); if (AUD.rec) this.bus.connect(AUD.rec); },   // into the export mix too
  fire(kind, info = {}) { if (!this.active()) return; try { this.ensureBus(); const h = this.ON[kind]; if (h) h.call(this, info); } catch {} },
  tick() {   // stalled agents (the tiles the client already marks .slow / .quiet) get crickets
    if (!this.active()) return; const stuck = [...document.querySelectorAll('#stage .tile.quiet, #stage .tile.slow')].filter((t) => t.style.display !== 'none');
    if (!stuck.length || !this.roll(0.5) || !this.rest('stall', 4)) return;
    const t = stuck[Math.floor(Math.random() * stuck.length)], id = t.id.slice(2), r = this.rect(id); this.crickets();
    this.slam(CORE.pick(this.STALLS(), CORE.hash(id + ((Date.now() / 10000) | 0))), { size: 30, left: r && r.cx + 'px', top: r && r.y + 'px', ms: 2500 });
  },

  // ---------- what each event does ----------
  ON: {
    talk(i) { if (i.id === 'user') return this.ON.user.call(this, i); if (!this.rest('talk', 0.5)) return; this.zoom(i.id); if (this.roll()) this.kinetic(i.text); if (this.cfg().level >= 9 && this.roll(0.6)) this.fry(i.id); },
    interrupt() {   // the human's message cut a line that was being read: a real record scratch, one of three (user() then skips its synthesised one)
      this.scratched = performance.now(); this.clip('scratch' + (1 + Math.floor(Math.random() * 3)), () => this.scratch());
    },
    user() { if (!this.rest('user', 2)) return; if (performance.now() - (this.scratched || 0) > 2500) this.scratch(); this.topBottom(T('L’HUMAIN EST', 'THE HUMAN HAS'), T('ENTRÉ DANS LE CHAT', 'ENTERED THE CHAT')); this.flash('rgba(255,255,255,.5)'); if (this.roll()) this.rain(['👀', '😳', '🫡'], Math.round(this.cfg().particles / 2)); },
    order(i) {
      if (!this.rest('order')) return; this.airhorn(1); const r = this.rect(i.to); if (r) this.flare(r.cx, r.cy, Math.max(200, r.w * 1.2));
      this.slam(T(`${nameOf(i.to)} DÉPLOYÉ`, `DEPLOYING ${nameOf(i.to)}`), { size: 56, color: '#ffe600' }); if (this.roll(0.5)) this.flash('rgba(255,230,0,.35)');
    },
    report(i) {
      if (!this.rest('report')) return; this.hitmarker(); this.sparkle(); const r = this.rect(i.from);
      if (r) for (let k = 0; k < 3; k++) setTimeout(() => this.cross(r.x + Math.random() * r.w, r.y + Math.random() * r.h), k * 90);
      const xp = 100 * (1 + Math.floor(Math.random() * 9)); this.slam(`+${xp} XP`, { size: 40, color: '#3bff6e', left: r && r.cx + 'px', top: r && r.y + 'px' });
      if (this.roll(0.7)) setTimeout(() => this.active() && this.slam(CORE.pick(this.WINS(), CORE.hash(i.from + xp)), { size: 64 }), 250);
      if (this.roll(0.45)) { this.airhorn(3); this.flash('rgba(255,255,255,.35)'); }
      if (this.roll(0.5)) setTimeout(() => this.active() && this.slam('STONKS 📈', { size: 44, color: '#52d8ff', top: '8%' }), 600);
    },
    tool(i) {
      if (!this.roll(0.08) || !this.rest('tool', 0.3)) return; this.hitmarker(); const r = this.rect(i.id); if (!r) return;
      this.cross(r.cx + (Math.random() - 0.5) * r.w * 0.6, r.cy + (Math.random() - 0.5) * r.h * 0.6); this.slam('+10', { size: 22, left: r.cx + 'px', top: r.cy + 'px', ms: 800 });
    },
    fail(i) {
      if (!this.rest('fail', 1.5)) return; this.shake(1.4); this.flash('rgba(255,0,0,.45)');
      if (Math.random() < 0.4) this.clip('omg', () => this.boom()); else { this.boom(); setTimeout(() => this.active() && (Math.random() < 0.5 ? this.trombone() : this.bruh()), 450); }
      this.slam(CORE.pick(this.FAILS(), CORE.hash(i.id + Date.now())), { size: 70, color: '#ff3b3b' });
      if (this.roll()) this.rain(['💀', '🤡', '🔥', '😭'], Math.round(this.cfg().particles / 2)); const r = this.rect(i.id); if (r && this.roll(0.5)) this.slam('💀', { size: 60, left: r.cx + 'px', top: r.cy + 'px' });
    },
    leave(i) {
      if (!this.rest('leave')) return;
      if (Math.random() < 0.5) { this.yeet(); this.fling(i.id); const r = this.rect(i.id); this.slam('YEET', { size: 64, color: '#ffe600', left: r && r.cx + 'px', top: r && r.cy + 'px' }); } else { this.sting(); this.freeze(); }
    },
    win() {
      if (!this.rest('win', 4)) return; this.airhorn(3); setTimeout(() => this.active() && this.badumtss(), 1300); setTimeout(() => this.active() && this.sparkle(), 1800);
      this.rain(['🌮', '🥤', '🔥', '💯', '😂', '🏆']); const l = this.layer().getBoundingClientRect(); for (let k = 0; k < 4; k++) setTimeout(() => this.flare(Math.random() * l.width, Math.random() * l.height, 220 + Math.random() * 220), k * 250);
      this.triangle(); this.slam(T('MAMAN VIENS VOIR', 'MOM GET THE CAMERA'), { size: 64, color: '#ffe600', top: '20%' }); setTimeout(() => this.shades('main'), 900); this.flash('rgba(255,255,255,.5)'); if (this.roll(0.6)) this.spin();
    },
    card() { if (!this.rest('card', 2)) return; this.sting(); this.wipe('star'); },
    combo(i) {
      if (!this.rest('combo', 3)) return; this.wub(); setTimeout(() => this.active() && this.ohh(), 300); this.shake(0.8);
      this.slam(CORE.pick(this.COMBOS, CORE.hash(String(Date.now()))), { size: 80, color: '#ff5cf0', top: '30%' });
      (i.ids || []).forEach((id, k) => { const r = this.rect(id); if (r) setTimeout(() => this.flare(r.cx, r.cy, r.w * 1.3), k * 150); }); if (this.roll(0.6)) this.spin();
    },
  },

  // ---------- sounds: synth patches on the meme bus; one bundled clip ----------
  node(type, f) { const o = AUD.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; },
  env(t, a, h, r, v) { const g = AUD.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + a); g.gain.setValueAtTime(v, t + a + h); g.gain.exponentialRampToValueAtTime(0.0001, t + a + h + r); return g; },
  dist(k = 40) { const ws = AUD.ctx.createWaveShaper(), n = 256, curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); } ws.curve = curve; return ws; },
  noise() { const c = AUD.ctx; if (!this.nb) { this.nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = this.nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } const s = c.createBufferSource(); s.buffer = this.nb; s.loop = true; return s; },
  filt(type, f, q = 1) { const b = AUD.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; },
  airhorn(n = 1) {   // MLG: three detuned saws and a sub square, clipped hard, pitch sliding up into the note; the last of three holds
    if (!this.sound()) return; const c = AUD.ctx;
    for (let k = 0; k < n; k++) {
      const t = c.currentTime + k * 0.32, len = n > 1 && k === n - 1 ? 0.85 : 0.28, g = this.env(t, 0.015, len, 0.15, 0.35), d = this.dist(50), lp = this.filt('lowpass', 2600, 2);
      [[466, 'sawtooth'], [468.5, 'sawtooth'], [463.5, 'sawtooth'], [233, 'square']].forEach(([f, ty]) => { const o = this.node(ty, f * 0.88); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); o.connect(d); o.start(t); o.stop(t + len + 0.2); });
      d.connect(lp).connect(g).connect(this.bus);
    }
  },
  boom() {   // vine boom: a sine dropping from 120 to 32 Hz with a thud of low noise
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime, o = this.node('sine', 120), g = this.env(t, 0.005, 0.05, 1.3, 0.9); o.frequency.exponentialRampToValueAtTime(32, t + 0.5); o.connect(this.dist(8)).connect(g).connect(this.bus); o.start(t); o.stop(t + 1.5);
    const n = this.noise(), ng = this.env(t, 0.003, 0.03, 0.25, 0.5); n.connect(this.filt('lowpass', 220)).connect(ng).connect(this.bus); n.start(t); n.stop(t + 0.4);
  },
  hitmarker() {   // two clicks of bright noise and a tink
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime;
    for (let k = 0; k < 2; k++) { const at = t + k * 0.045, n = this.noise(), g = this.env(at, 0.002, 0.01, 0.05, 0.35); n.connect(this.filt('highpass', 3800)).connect(g).connect(this.bus); n.start(at); n.stop(at + 0.08); }
    const o = this.node('sine', 2650), g = this.env(t, 0.002, 0.02, 0.07, 0.18); o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.12);
  },
  trombone() {   // sad trombone: four notes, each sliding down with a closing wah
    if (!this.sound()) return; const c = AUD.ctx; let t = c.currentTime;
    [[233, 0.38], [220, 0.38], [208, 0.38], [196, 1.0]].forEach(([f, d]) => {
      const o = this.node('sawtooth', f), bp = this.filt('bandpass', 900, 2.5); bp.frequency.exponentialRampToValueAtTime(380, t + d); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.94, t + d);
      const g = this.env(t, 0.04, d - 0.12, 0.1, 0.3); o.connect(bp).connect(g).connect(this.bus); o.start(t); o.stop(t + d + 0.1); t += d + 0.05;
    });
  },
  bruh() {   // one low vowel: two saws through a formant sweep, pitch sagging
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime, bp = this.filt('bandpass', 350, 3); bp.frequency.linearRampToValueAtTime(950, t + 0.12); bp.frequency.linearRampToValueAtTime(260, t + 0.5);
    [115, 116.5].forEach((f) => { const o = this.node('sawtooth', f); o.frequency.linearRampToValueAtTime(f * 0.74, t + 0.55); o.connect(bp); o.start(t); o.stop(t + 0.65); });
    bp.connect(this.env(t, 0.03, 0.35, 0.2, 0.45)).connect(this.bus);
  },
  scream() {   // a saw with fast vibrato, rising then falling, through a formant and a clipper
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime, o = this.node('sawtooth', 520); o.frequency.linearRampToValueAtTime(980, t + 0.25); o.frequency.linearRampToValueAtTime(700, t + 0.8);
    const lfo = this.node('sine', 24), lg = c.createGain(); lg.gain.value = 60; lfo.connect(lg).connect(o.frequency);
    o.connect(this.filt('bandpass', 1400, 1.5)).connect(this.dist(20)).connect(this.env(t, 0.03, 0.55, 0.3, 0.3)).connect(this.bus); o.start(t); lfo.start(t); o.stop(t + 1); lfo.stop(t + 1);
  },
  sting() {   // dramatic "dun dun dunnn": three minor stabs of our own, the last one held
    if (!this.sound()) return; const c = AUD.ctx, t0 = c.currentTime;
    [[0, 0.32, [196, 233, 294]], [0.42, 0.32, [185, 220, 277]], [0.84, 1.6, [147, 175, 220]]].forEach(([at, d, fs]) => {
      const t = t0 + at, lp = this.filt('lowpass', 1200), g = this.env(t, 0.02, d, 0.3, 0.22);
      fs.forEach((f) => [this.node('sawtooth', f), this.node('square', f / 2)].forEach((o) => { o.connect(lp); o.start(t); o.stop(t + d + 0.4); })); lp.connect(g).connect(this.bus);
    });
  },
  scratch() {   // record scratch: resonant noise swept down then back up
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime, n = this.noise(), bp = this.filt('bandpass', 2400, 6); bp.frequency.exponentialRampToValueAtTime(300, t + 0.18); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.36);
    n.connect(bp).connect(this.env(t, 0.01, 0.3, 0.08, 0.5)).connect(this.bus); n.start(t); n.stop(t + 0.45);
  },
  badumtss() {   // kick, snare, crash
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime;
    const kick = (at) => { const o = this.node('sine', 160), g = this.env(at, 0.003, 0.03, 0.22, 0.8); o.frequency.exponentialRampToValueAtTime(48, at + 0.18); o.connect(g).connect(this.bus); o.start(at); o.stop(at + 0.3); };
    const snare = (at) => { const n = this.noise(), g = this.env(at, 0.002, 0.03, 0.16, 0.5); n.connect(this.filt('highpass', 1100)).connect(g).connect(this.bus); n.start(at); n.stop(at + 0.25); const o = this.node('triangle', 190), og = this.env(at, 0.002, 0.02, 0.1, 0.4); o.connect(og).connect(this.bus); o.start(at); o.stop(at + 0.15); };
    const crash = (at) => { const n = this.noise(), g = this.env(at, 0.003, 0.05, 1.4, 0.35); n.connect(this.filt('highpass', 5000)).connect(g).connect(this.bus); n.start(at); n.stop(at + 1.6); };
    kick(t); snare(t + 0.17); crash(t + 0.36);
  },
  sparkle() { if (!this.sound()) return; const t = AUD.ctx.currentTime; [880, 1109, 1319, 1760, 2217].forEach((f, i) => { const at = t + i * 0.06, o = this.node('sine', f), g = this.env(at, 0.005, 0.04, 0.5, 0.14); o.connect(g).connect(this.bus); o.start(at); o.stop(at + 0.6); }); },
  crickets() {   // three chirps: a high sine chopped at 38 Hz
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime;
    for (let k = 0; k < 3; k++) { const at = t + k * 0.5, o = this.node('sine', 4300), g = this.env(at, 0.01, 0.12, 0.05, 0.08), lfo = this.node('square', 38), lg = c.createGain(); lg.gain.value = 0.08; lfo.connect(lg).connect(g.gain); o.connect(g).connect(this.bus); o.start(at); lfo.start(at); o.stop(at + 0.2); lfo.stop(at + 0.2); }
  },
  ohh() {   // a crowd going "ohhh": seven detuned saws sagging through a closing formant
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime, bp = this.filt('bandpass', 700, 1.2); bp.frequency.exponentialRampToValueAtTime(380, t + 1.1);
    for (let k = 0; k < 7; k++) { const f = 200 + k * 23 + Math.random() * 10, o = this.node('sawtooth', f); o.frequency.linearRampToValueAtTime(f * 0.8, t + 1.1); o.connect(bp); o.start(t); o.stop(t + 1.3); }
    bp.connect(this.env(t, 0.18, 0.4, 0.6, 0.25)).connect(this.bus);
  },
  wub() {   // dubstep: a sub saw under a resonant low-pass that an accelerating LFO opens and closes
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime, lp = this.filt('lowpass', 400, 12), lfo = this.node('sine', 4), lg = c.createGain(); lg.gain.value = 350; lfo.frequency.linearRampToValueAtTime(12, t + 1.2); lfo.connect(lg).connect(lp.frequency);
    [this.node('sawtooth', 55), this.node('square', 55.5)].forEach((o) => { o.connect(lp); o.start(t); o.stop(t + 1.5); }); lp.connect(this.dist(15)).connect(this.env(t, 0.03, 1.1, 0.25, 0.4)).connect(this.bus); lfo.start(t); lfo.stop(t + 1.5);
  },
  yeet() {   // a rising whoosh
    if (!this.sound()) return; const c = AUD.ctx, t = c.currentTime, n = this.noise(), bp = this.filt('bandpass', 400, 1); bp.frequency.exponentialRampToValueAtTime(6500, t + 0.35); n.connect(bp).connect(this.env(t, 0.02, 0.2, 0.15, 0.35)).connect(this.bus); n.start(t); n.stop(t + 0.45);
    const o = this.node('sine', 300); o.frequency.exponentialRampToValueAtTime(1400, t + 0.35); o.connect(this.env(t, 0.02, 0.2, 0.1, 0.12)).connect(this.bus); o.start(t); o.stop(t + 0.4);
  },
  async clip(name, fallback) {   // a bundled clip, decoded once, played on the meme bus; the synth stands in if it cannot be loaded
    if (!this.sound()) return;
    try {
      if (!this.clips.has(name)) this.clips.set(name, fetch(this.CLIPS[name]).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }).then((ab) => AUD.ctx.decodeAudioData(ab)));
      const buf = await this.clips.get(name); if (!this.sound()) return; const s = AUD.ctx.createBufferSource(); s.buffer = buf; s.connect(this.bus); s.start();
    } catch { this.clips.delete(name); if (fallback) fallback(); }
  },

  // ---------- visuals: everything lands in #memeLayer, nothing there is clickable ----------
  layer() { let l = document.getElementById('memeLayer'); if (!l) { l = document.createElement('div'); l.id = 'memeLayer'; (document.getElementById('center') || document.body).appendChild(l); } return l; },
  el(cls, html, style) { const d = document.createElement('div'); d.className = 'mm ' + cls; d.innerHTML = html; for (const k in style || {}) if (style[k] != null && style[k] !== false) d.style.setProperty(k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(style[k])); this.layer().appendChild(d); return d; },
  gone(d, ms) { setTimeout(() => d.remove(), ms); },
  rect(id) {   // a tile's box in layer coordinates, or null when it is not on screen
    const t = document.getElementById('t-' + id); if (!t || t.style.display === 'none' || document.body.classList.contains('tree') || document.body.classList.contains('board')) return null;
    const r = t.getBoundingClientRect(), l = this.layer().getBoundingClientRect(); if (!r.width) return null;
    return { x: r.left - l.left, y: r.top - l.top, w: r.width, h: r.height, cx: r.left - l.left + r.width / 2, cy: r.top - l.top + r.height / 2 };
  },
  slam(text, o = {}) {   // Impact text slamming in; random spot on the stage unless anchored
    const d = this.el('slam', esc(text), { left: o.left || 15 + Math.random() * 70 + '%', top: o.top || 15 + Math.random() * 60 + '%', fontSize: (o.size || 48) + 'px', color: o.color || '#fff', '--rot': (o.rot ?? Math.random() * 24 - 12) + 'deg' });
    this.gone(d, o.ms || 1400); return d;
  },
  kinetic(text) { const n = this.cfg().level >= 8 ? 3 : this.cfg().level >= 4 ? 2 : 1; CORE.words(text, n).forEach((w, i) => setTimeout(() => this.active() && this.slam(w, { size: 34 + Math.random() * 40, color: this.PAL[i % this.PAL.length] }), 350 + i * 420)); },
  topBottom(top, bottom, ms = 2200) { this.gone(this.el('tb', `<div class="top">${esc(top)}</div><div class="bot">${esc(bottom || '')}</div>`), ms); },
  flare(x, y, size = 260, ms = 1600) { this.gone(this.el('flare', '', { left: x + 'px', top: y + 'px', width: size + 'px', height: size + 'px', animationDuration: ms + 'ms' }), ms); },
  cross(x, y) { this.gone(this.el('hit', '✕', { left: x + 'px', top: y + 'px' }), 700); },
  rain(emojis, n) { n = n || this.cfg().particles; for (let i = 0; i < n; i++) this.gone(this.el('rain', emojis[i % emojis.length], { left: Math.random() * 100 + '%', animationDelay: Math.random() * 0.8 + 's', animationDuration: 1.6 + Math.random() * 1.6 + 's', fontSize: 18 + Math.random() * 26 + 'px' }), 4200); },
  shake(mul = 1) {
    const amp = this.cfg().shake * mul, c = document.getElementById('center'); if (!c || !c.animate) return;
    const kf = []; for (let i = 0; i < 10; i++) kf.push({ transform: `translate(${(Math.random() * 2 - 1) * amp}px,${(Math.random() * 2 - 1) * amp}px) rotate(${((Math.random() * 2 - 1) * amp) / 6}deg)` }); kf.push({ transform: 'none' });
    c.animate(kf, { duration: 450, easing: 'ease-out' });
  },
  flash(color = '#fff', ms = 110) { if (this.rm || !this.guard.ok()) return; this.gone(this.el('flash', '', { background: color, animationDuration: ms + 'ms' }), ms + 20); },   // never under reduced motion: strobing is the one thing the switch does not override
  zoom(id) { const t = document.getElementById('t-' + id); if (!t) return; t.classList.remove('mm-zoom'); void t.offsetWidth; t.classList.add('mm-zoom'); setTimeout(() => t.classList.remove('mm-zoom'), 520); },
  fry(id, ms = 1800) { const t = document.getElementById('t-' + id); if (!t) return; t.classList.add('mm-fry'); setTimeout(() => t.classList.remove('mm-fry'), ms); },
  wipe(kind = 'star') { if (this.rm) return; this.gone(this.el('wipe ' + kind, ''), 1300); },
  spin() { const s = document.getElementById('stage'); if (!s || !s.animate) return; s.animate([{ transform: 'perspective(900px) rotateY(0)' }, { transform: 'perspective(900px) rotateY(360deg)' }], { duration: 1100, easing: 'cubic-bezier(.6,0,.3,1)' }); },
  shades(id, ms = 3500) { const r = this.rect(id); if (!r) return; this.gone(this.el('shades', '🕶️', { left: r.cx + 'px', top: r.y + 'px', fontSize: Math.max(30, r.w * 0.28) + 'px', '--fall': r.h * 0.3 + 'px' }), ms); },
  triangle(ms = 2600) { this.gone(this.el('tri', '<i></i><span>👁️</span>'), ms); },
  freeze(ms = 2600) {   // "To be continued": sepia over the stage and the arrow banner
    const c = document.getElementById('center'); if (!c) return; c.classList.add('mm-freeze'); const d = this.el('tbc', `<span>${esc(T('À suivre', 'To Be Continued'))}</span> ➡︎`);
    setTimeout(() => { c.classList.remove('mm-freeze'); d.remove(); }, ms);
  },
  fling(id) {   // the leaving tile is thrown off-screen; the client hides it 1.25 s into its own dissolve, so the throw stays a little longer then lets go
    const t = document.getElementById('t-' + id); if (!t || !t.animate) return; const dir = Math.random() < 0.5 ? -1 : 1;
    const a = t.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dir * 120}vw,-40vh) rotate(${dir * 540}deg) scale(.4)`, opacity: 0.6 }], { duration: 900, easing: 'cubic-bezier(.2,.6,.5,1)', fill: 'forwards' });
    setTimeout(() => a.cancel(), 1500);
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
if (typeof root.document !== 'undefined') root.MEME = MEME;
})(typeof window !== 'undefined' ? window : globalThis);
