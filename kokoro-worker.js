#!/usr/bin/env node
// Agent Standup — Kokoro worker. Loads the Kokoro-82M model once, then reads one JSON request per stdin line
// ({ id, text, voice, speed, out }) and writes a 16-bit WAV to `out`, answering { id, ok, seconds } or { id, ok: false, error }.
// Started by kokoro.js with AGENT_STANDUP_KOKORO_DIR (where kokoro-js is installed) and AGENT_STANDUP_KOKORO_DTYPE.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createRequire } = require('module');

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const send = (o) => fs.writeSync(1, JSON.stringify(o) + '\n');   // synchronous: on macOS a pipe write from process.stdout is queued until the loop is idle, which would hold streamed chunks back until the whole line is done

function pcm16(samples) {   // Float32 in [-1, 1] → 16-bit little-endian PCM
  const n = samples.length, buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); buf.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), i * 2); }
  return buf;
}
function wavHeader(bytes, rate) {   // 16-bit PCM mono
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + bytes, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(bytes, 40);
  return h;
}
const wav = (samples, rate) => { const pcm = pcm16(samples); return Buffer.concat([wavHeader(pcm.length, rate), pcm]); };
const finite = (samples) => { for (let i = 0; i < samples.length; i++) if (samples[i] !== samples[i]) return false; return true; };   // a quantised model can return NaN for a whole line (fp16 overflow): that would be written as silence
// Pieces a line is spoken in when streaming: sentences, and long sentences cut at clause boundaries, so the first sound comes fast.
function pieces(text) {
  const out = [], sents = String(text).split(/(?<=[.!?…]["')\]]*)\s+/);   // a sentence ends at punctuation followed by a space: "2.3 seconds" stays whole
  for (const s of sents) {
    const t = s.trim(); if (!t) continue;
    if (t.length <= 110) { out.push(t); continue; }
    let cur = '';
    for (const part of t.split(/(?<=[,;:—])\s+/)) { if (cur && cur.length + part.length > 90) { out.push(cur); cur = part; } else cur = cur ? cur + ' ' + part : part; }
    if (cur) out.push(cur);
  }
  return out;
}
module.exports = { wav, pcm16, wavHeader, pieces, finite };

async function main() {
  const dir = process.env.AGENT_STANDUP_KOKORO_DIR, dtype = process.env.AGENT_STANDUP_KOKORO_DTYPE || 'q4f16';
  const req = createRequire(path.join(dir, 'node_modules', 'x.js'));   // resolve from the install dir, not from the extension
  const tf = req('@huggingface/transformers'); tf.env.cacheDir = path.join(dir, 'models');
  const { KokoroTTS, TextSplitterStream } = req('kokoro-js');
  const load = () => KokoroTTS.from_pretrained(MODEL, { dtype, device: 'cpu' });
  let tts; try { tts = await load(); } catch (e) {
    // A download cut short (the worker is killed when the model choice changes) leaves a truncated .onnx that transformers.js
    // never re-checks; drop this model's files and fetch them again, once.
    const onnx = path.join(dir, 'models', ...MODEL.split('/'), 'onnx'), name = { q8: 'model_quantized', q4: 'model_q4', fp32: 'model', fp16: 'model_fp16', q4f16: 'model_q4f16' }[dtype] || 'model';
    let dropped = 0; for (const f of ['.onnx', '.onnx_data']) { try { fs.unlinkSync(path.join(onnx, name + f)); dropped++; } catch {} }
    if (!dropped) throw e; console.error('kokoro: model files for ' + dtype + ' were unreadable (' + String(e.message).slice(0, 80) + '); fetching them again'); tts = await load();
  }
  // NaN output (seen with q4f16) is made once more; if it comes back NaN again the line fails, and the server hands it to the system voice instead of caching silence.
  const sound = async (samples, text, m) => { if (finite(samples)) return samples; const again = await tts.generate(String(text), { voice: m.voice, speed: +m.speed || 1 }); if (finite(again.audio)) return again.audio; throw new Error('the model returned NaN for: ' + String(text).slice(0, 60)); };
  send({ ready: true });
  for await (const line of readline.createInterface({ input: process.stdin })) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    try {
      if (m.stream) {   // one chunk per piece as soon as it is ready; the whole line is still written to `out` at the end
        const splitter = new TextSplitterStream(); for (const p of pieces(m.text)) { splitter.push(p); splitter.flush(); } splitter.close();
        const parts = []; let total = 0;
        for await (const { text: piece, audio } of tts.stream(splitter, { voice: m.voice, speed: +m.speed || 1 })) {
          const samples = await sound(audio.audio, piece || m.text, m);
          const pcm = pcm16(samples), seconds = samples.length / audio.sampling_rate; parts.push(pcm); total += seconds;
          send({ id: m.id, chunk: pcm.toString('base64'), seconds });
        }
        const all = Buffer.concat(parts); fs.writeFileSync(m.out, Buffer.concat([wavHeader(all.length, 24000), all]));
        send({ id: m.id, ok: true, seconds: total }); continue;
      }
      const a = await tts.generate(String(m.text), { voice: m.voice, speed: +m.speed || 1 }), samples = await sound(a.audio, m.text, m);
      fs.writeFileSync(m.out, wav(samples, a.sampling_rate));
      send({ id: m.id, ok: true, seconds: samples.length / a.sampling_rate });
    } catch (e) { send({ id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
  }
}
if (require.main === module) main().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
