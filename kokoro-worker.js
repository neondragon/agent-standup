#!/usr/bin/env node
// Agent Standup — Kokoro worker. Loads the Kokoro-82M model once, then reads one JSON request per stdin line
// ({ id, text, voice, speed, out }) and writes a 16-bit WAV to `out`, answering { id, ok, seconds } or { id, ok: false, error }.
// Started by kokoro.js with AGENT_STANDUP_KOKORO_DIR (where kokoro-js is installed) and AGENT_STANDUP_KOKORO_DTYPE.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createRequire } = require('module');

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');

function wav(samples, rate) {   // Float32 in [-1, 1] → 16-bit PCM mono WAV
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); buf.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2); }
  return buf;
}
module.exports = { wav };

async function main() {
  const dir = process.env.AGENT_STANDUP_KOKORO_DIR, dtype = process.env.AGENT_STANDUP_KOKORO_DTYPE || 'q8';
  const req = createRequire(path.join(dir, 'node_modules', 'x.js'));   // resolve from the install dir, not from the extension
  const tf = req('@huggingface/transformers'); tf.env.cacheDir = path.join(dir, 'models');
  const { KokoroTTS } = req('kokoro-js');
  const tts = await KokoroTTS.from_pretrained(MODEL, { dtype, device: 'cpu' });
  send({ ready: true });
  for await (const line of readline.createInterface({ input: process.stdin })) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    try {
      const a = await tts.generate(String(m.text), { voice: m.voice, speed: +m.speed || 1 });
      fs.writeFileSync(m.out, wav(a.audio, a.sampling_rate));
      send({ id: m.id, ok: true, seconds: a.audio.length / a.sampling_rate });
    } catch (e) { send({ id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
  }
}
if (require.main === module) main().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
