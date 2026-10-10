// Original, copyright-free background music for the launch videos, synthesised from scratch (no samples, no downloads).
// A mellow lo-fi loop (Am7 - Fmaj7 - Cmaj7 - G6) with soft keys, a pad, a bass and brushed drums, plus gentle chimes at given times.
//   node scripts/promo-music.js out.wav 45 3.2,15,22.5     → 45 s of music with chimes at 3.2 s, 15 s and 22.5 s
const fs = require('fs');
const SR = 44100, TAU = Math.PI * 2;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

function make(file, seconds, chimes = [], bpm = 92) {
  const N = Math.round(seconds * SR), L = new Float32Array(N), R = new Float32Array(N), keys = new Float32Array(N);
  const beat = 60 / bpm; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (buf, t, dur, fn, gain) => { const a = Math.max(0, Math.round(t * SR)), b = Math.min(N, Math.round((t + dur) * SR)); for (let i = a; i < b; i++) buf[i] += gain * fn((i - a) / SR, (i - a) / (b - a)); };
  const CH = [   // [bass, chord tones]
    [45, [57, 60, 64, 67]], [41, [53, 57, 60, 64]], [48, [60, 64, 67, 71]], [43, [55, 59, 62, 64]],
  ];
  const bars = Math.ceil(seconds / (beat * 4)) + 1;
  for (let bar = 0; bar < bars; bar++) {
    const [bass, tones] = CH[Math.floor(bar / 2) % 4], t0 = bar * beat * 4, intro = bar < 2, outro = t0 > seconds - 6;
    // pad: slow attack, long release, slightly detuned between left and right
    if (bar % 2 === 0) for (const m of tones) for (const [buf, det] of [[L, 0.997], [R, 1.003]])
      add(buf, t0, beat * 8.4, (t, p) => Math.sin(TAU * hz(m) * det * t) * Math.min(1, t / 0.9) * Math.min(1, (1 - p) * 4), 0.022);
    // bass: root on beat 1 and a short answer on 3.5
    for (const [bt, len, m] of [[0, 1.6, bass], [2.5, 0.8, bass + 7]]) add(L, t0 + bt * beat, len * beat, (t) => Math.sin(TAU * hz(m) * t) * Math.exp(-t * 2.4) * Math.min(1, t / 0.02), 0.16), add(R, t0 + bt * beat, len * beat, (t) => Math.sin(TAU * hz(m) * t) * Math.exp(-t * 2.4) * Math.min(1, t / 0.02), 0.16);
    // keys: eighth-note pluck pattern on the chord tones, light swing, accents on the beat
    const pat = [0, 2, 1, 3, 2, 1, 3, 2];
    for (let k = 0; k < 8; k++) {
      if (intro && k % 2) continue; const sw = k % 2 ? 0.07 : 0, m = tones[pat[k]] + 12, acc = k % 4 === 0 ? 1 : 0.62, t = t0 + (k / 2 + sw) * beat, pan = 0.35 + 0.3 * Math.sin(k + bar);
      const fn = (x) => (Math.sin(TAU * hz(m) * x) + 0.35 * Math.sin(TAU * hz(m) * 2.01 * x) * Math.exp(-x * 7)) * Math.exp(-x * 4.2) * Math.min(1, x / 0.004);
      add(keys, t, 1.1, fn, 0.05 * acc * (outro ? 0.8 : 1));
    }
    // brushed drums from bar 2: soft kick on 1 and 3, noise brush on 2 and 4, quiet hats
    if (bar >= 2) {
      for (const bt of [0, 2]) add(L, t0 + bt * beat, 0.3, (t) => Math.sin(TAU * (48 + 90 * Math.exp(-t * 28)) * t) * Math.exp(-t * 11), 0.22), add(R, t0 + bt * beat, 0.3, (t) => Math.sin(TAU * (48 + 90 * Math.exp(-t * 28)) * t) * Math.exp(-t * 11), 0.22);
      for (const bt of [1, 3]) { let lp = 0; add(L, t0 + bt * beat, 0.22, (t) => (lp += 0.35 * (rnd() - lp)) * Math.exp(-t * 16), 0.11); add(R, t0 + bt * beat + 0.004, 0.22, (t) => (lp += 0.35 * (rnd() - lp)) * Math.exp(-t * 16), 0.11); }
      for (let k = 0; k < 8; k++) { const v = (k % 2 ? 0.5 : 0.8) * (0.7 + 0.3 * Math.abs(rnd())); add(L, t0 + (k / 2) * beat, 0.05, (t) => rnd() * Math.exp(-t * 90), 0.018 * v); add(R, t0 + (k / 2) * beat + 0.006, 0.05, (t) => rnd() * Math.exp(-t * 90), 0.018 * v); }
    }
  }
  // gentle chimes for the scene changes (a soft bell: two partials)
  for (const [i, c] of chimes.entries()) { const m = [76, 79, 83, 79, 84, 72][i % 6]; for (const buf of [keys]) add(buf, c, 1.6, (t) => (Math.sin(TAU * hz(m) * t) + 0.4 * Math.sin(TAU * hz(m) * 2.76 * t)) * Math.exp(-t * 3.2) * Math.min(1, t / 0.003), 0.07); }
  // keys go through a dotted-eighth echo and are spread across the stereo field
  const d = Math.round(beat * 0.75 * SR);
  for (let i = 0; i < N; i++) { const e = keys[i] + (i > d ? 0.34 * (keys[i - d] + 0.34 * (i > 2 * d ? keys[i - 2 * d] : 0)) : 0); L[i] += e * 0.9; R[i] += e * 1.0 + (i > 400 ? 0.12 * keys[i - 400] : 0); }
  // warm it up (one-pole low-pass), fade in and out, soft-clip, normalise
  let a = 0, b = 0, peak = 0; const fi = 1.2 * SR, fo = 2.8 * SR;
  for (let i = 0; i < N; i++) {
    a += 0.42 * (L[i] - a); b += 0.42 * (R[i] - b); const g = Math.min(1, i / fi) * Math.min(1, (N - i) / fo);
    L[i] = Math.tanh(a * 1.6 * g); R[i] = Math.tanh(b * 1.6 * g); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const buf = Buffer.alloc(44 + N * 4), k = 0.8 / (peak || 1);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * k * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * k * 32767), 46 + i * 4); }
  fs.writeFileSync(file, buf); return file;
}
module.exports = make;
if (require.main === module) { const [f, s, c] = process.argv.slice(2); console.log(make(f || 'music.wav', +s || 40, (c || '').split(',').filter(Boolean).map(Number))); }
