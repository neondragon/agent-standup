# Natural voices with Kokoro — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents speak with Kokoro-82M neural voices, installed on demand outside the extension, with system voices as the fallback.

**Architecture:** A new server module `kokoro.js` owns the on-demand `npm install` into `~/.cache/agent-standup/kokoro`, and a worker process `kokoro-worker.js` that loads the model once and writes WAVs on request over JSON lines. `server.js` only gains an `engine` parameter and two status/install routes. The client gains a `prefs.kokoro` switch, an install box in ⚙ → Sound, and uses the server's voice order for Kokoro.

**Tech Stack:** Node ≥ 18 (no new dependencies in the repo), `kokoro-js@1.2.1` installed at runtime, Node's built-in `node:test` runner.

Spec: `docs/superpowers/specs/2026-10-10-kokoro-tts-design.md`.

---

## File structure

| File | Responsibility |
|---|---|
| `kokoro-worker.js` (new) | Child process: load model once, serve `{id,text,voice,speed,out}` → WAV. Exports `wav()` for tests. |
| `kokoro.js` (new) | Install dir, `npm` lookup, install job, worker lifecycle with restarts, fixed voice list, `status()`. |
| `server.js` (modify) | `engine` on `/api/voices` and `/api/tts`; `/api/kokoro` and `/api/kokoro/install`; shutdown. |
| `public/index.html` (modify) | `prefs.kokoro`, menu row + install box, `TTS` engine handling, fallback on failure. |
| `test/wav.test.js`, `test/kokoro.test.js`, `test/server.test.js`, `test/stub-worker.js` (new) | Tests. |
| `README.md`, `.vscodeignore`, `package.json` (modify) | Docs, keep `test/` out of the vsix, `npm test`. |

---

### Task 1: WAV encoder in the worker file

**Files:**
- Create: `kokoro-worker.js`
- Create: `test/wav.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/wav.test.js
const test = require('node:test');
const assert = require('node:assert');
const { wav } = require('../kokoro-worker.js');

test('wav writes a 16-bit mono PCM header and clamps samples', () => {
  const buf = wav(new Float32Array([0, 0.5, 1, -1, 2, -2]), 24000);
  assert.equal(buf.length, 44 + 6 * 2);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.readUInt16LE(20), 1);        // PCM
  assert.equal(buf.readUInt16LE(22), 1);        // mono
  assert.equal(buf.readUInt32LE(24), 24000);    // sample rate
  assert.equal(buf.readUInt16LE(34), 16);       // bits
  assert.equal(buf.readUInt32LE(40), 12);       // data bytes
  assert.equal(buf.readInt16LE(44), 0);
  assert.equal(buf.readInt16LE(46), 16384);
  assert.equal(buf.readInt16LE(48), 32767);
  assert.equal(buf.readInt16LE(50), -32768);
  assert.equal(buf.readInt16LE(52), 32767);     // clamped
  assert.equal(buf.readInt16LE(54), -32768);    // clamped
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `node --test test/wav.test.js`
Expected: FAIL, `Cannot find module '../kokoro-worker.js'`.

- [ ] **Step 3: Write the worker file with the encoder and the serving loop**

```js
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
```

- [ ] **Step 4: Run the test, expect pass**

Run: `node --test test/wav.test.js`
Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add kokoro-worker.js test/wav.test.js
git commit -m "kokoro: worker process with a WAV encoder"
```

---

### Task 2: Stub worker for tests

**Files:**
- Create: `test/stub-worker.js`

- [ ] **Step 1: Write the stub**

It speaks the same protocol, writes 0.1 s of silence, and exits when asked to say `CRASH` (to test restarts).

```js
// test/stub-worker.js — stands in for kokoro-worker.js in tests: same protocol, writes 0.1 s of silence.
const fs = require('fs');
const readline = require('readline');
const { wav } = require('../kokoro-worker.js');
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
(async () => {
  send({ ready: true });
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const m = JSON.parse(line);
    if (m.text === 'CRASH') process.exit(3);
    fs.writeFileSync(m.out, wav(new Float32Array(2400), 24000));
    send({ id: m.id, ok: true, seconds: 0.1 });
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add test/stub-worker.js
git commit -m "kokoro: stub worker for tests"
```

---

### Task 3: `kokoro.js` — status, voices, install, worker

**Files:**
- Create: `kokoro.js`
- Create: `test/kokoro.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/kokoro.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-kokoro-'));
process.env.AGENT_STANDUP_KOKORO_DIR = tmp;
process.env.AGENT_STANDUP_KOKORO_WORKER = path.join(__dirname, 'stub-worker.js');
const kokoro = require('../kokoro.js');
const fakeInstall = () => { const d = path.join(tmp, 'node_modules', 'kokoro-js'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'package.json'), '{}'); };

test('status on an empty dir', () => {
  const st = kokoro.status();
  assert.equal(st.installed, false); assert.equal(st.installing, false); assert.equal(st.ready, false);
  assert.equal(st.dir, tmp); assert.equal(st.dtype, 'q8'); assert.equal(st.error, null); assert.equal(st.gaveUp, false);
});

test('voices: lead-first order, locales by prefix', () => {
  const v = kokoro.voices();
  assert.deepEqual(v.slice(0, 3).map((x) => x.name), ['af_heart', 'am_fenrir', 'bf_emma']);
  assert.equal(v.find((x) => x.name === 'bf_emma').locale, 'en_GB');
  assert.equal(v.find((x) => x.name === 'ff_siwis').locale, 'fr_FR');
  assert.equal(v.find((x) => x.name === 'af_heart').label, 'Heart');
  assert.ok(kokoro.hasVoice('am_puck')); assert.ok(!kokoro.hasVoice('Samantha'));
});

test('speedFor maps wpm to a clamped Kokoro speed', () => {
  assert.equal(kokoro.speedFor(178), 1); assert.equal(kokoro.speedFor(90), 0.6); assert.equal(kokoro.speedFor(360), 1.5); assert.equal(kokoro.speedFor(200), 1.1);
});

test('synth rejects when not installed', async () => {
  await assert.rejects(kokoro.synth('hi', 'af_heart', 1, path.join(tmp, 'a.wav')), /not installed/);
});

test('synth writes a wav through the worker, restarts after a crash, gives up after 3', async () => {
  fakeInstall();
  const out = path.join(tmp, 'b.wav');
  const r = await kokoro.synth('hello', 'af_heart', 1, out);
  assert.equal(r.ok, true); assert.ok(fs.statSync(out).size > 44);
  assert.equal(kokoro.status().installed, true);
  await assert.rejects(kokoro.synth('hi', 'nope', 1, out), /unknown voice/);
  for (let i = 0; i < 3; i++) await assert.rejects(kokoro.synth('CRASH', 'af_heart', 1, out), /exited/);
  assert.equal(kokoro.status().gaveUp, true);
  await assert.rejects(kokoro.synth('hello', 'af_heart', 1, out), /gave up/);
  kokoro._reset();
  assert.equal((await kokoro.synth('hello', 'af_heart', 1, out)).ok, true);
  kokoro.shutdown();
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test test/kokoro.test.js`
Expected: FAIL, `Cannot find module '../kokoro.js'`.

- [ ] **Step 3: Write `kokoro.js`**

```js
// Agent Standup — natural voices with Kokoro-82M (kokoro-js on ONNX Runtime), installed on demand outside the extension.
// Nothing here runs until the user clicks Install in ⚙ → Sound. Design: docs/superpowers/specs/2026-10-10-kokoro-tts-design.md
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WIN = process.platform === 'win32';
const DIR = process.env.AGENT_STANDUP_KOKORO_DIR || (WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-standup', 'kokoro') : path.join(os.homedir(), '.cache', 'agent-standup', 'kokoro'));
const DTYPE = /^(q8|q4|fp32|fp16|q4f16)$/.test(process.env.AGENT_STANDUP_KOKORO_DTYPE || '') ? process.env.AGENT_STANDUP_KOKORO_DTYPE : 'q8';
const PKG = 'kokoro-js@1.2.1';
const WORKER = process.env.AGENT_STANDUP_KOKORO_WORKER || path.join(__dirname, 'kokoro-worker.js');
const LOG = path.join(DIR, 'install.log');
const SIZE_MB = 520;   // ≈ 424 MB of packages + 97 MB model (q8)
const MAX_RESTARTS = 3;

// Voices in the order agents get them (the lead takes the first), so successive agents sound distinct. Grades from the Kokoro model card.
const VOICES = [
  ['af_heart', 'Heart', 'en_US'], ['am_fenrir', 'Fenrir', 'en_US'], ['bf_emma', 'Emma', 'en_GB'], ['am_michael', 'Michael', 'en_US'],
  ['af_bella', 'Bella', 'en_US'], ['bm_george', 'George', 'en_GB'], ['af_nicole', 'Nicole', 'en_US'], ['am_puck', 'Puck', 'en_US'],
  ['ff_siwis', 'Siwis', 'fr_FR'],
].map(([name, label, locale]) => ({ name, label, locale }));
const voices = () => VOICES;
const hasVoice = (n) => VOICES.some((v) => v.name === n);
const speedFor = (wpm) => Math.max(0.6, Math.min(1.5, Math.round((wpm / 178) * 20) / 20));

const exists = (f) => { try { fs.statSync(f); return true; } catch { return false; } };
const installed = () => exists(path.join(DIR, 'node_modules', 'kokoro-js', 'package.json'));

function findNpm() {
  const home = os.homedir(), names = WIN ? ['npm.cmd', 'npm.bat', 'npm'] : ['npm'], cands = [];
  if (process.env.AGENT_STANDUP_NPM) cands.push(process.env.AGENT_STANDUP_NPM);
  for (const d of (process.env.PATH || '').split(path.delimiter)) for (const n of names) cands.push(path.join(d, n));
  const dirs = WIN ? [path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')]
    : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.volta/bin')];
  try { const nvm = path.join(home, '.nvm', 'versions', 'node'); for (const v of fs.readdirSync(nvm)) dirs.push(path.join(nvm, v, 'bin')); } catch {}
  for (const d of dirs) for (const n of names) cands.push(path.join(d, n));
  return cands.find((c) => c && exists(c)) || null;
}

// ---- install: `npm install --prefix DIR kokoro-js`, output in DIR/install.log, one job at a time
let job = null, lastError = '';
function install() {
  if (job || installed()) return status();
  const npm = findNpm(); if (!npm) { lastError = 'npm not found'; return status(); }
  fs.mkdirSync(DIR, { recursive: true }); lastError = '';
  const out = fs.openSync(LOG, 'w'), args = ['install', '--prefix', DIR, '--no-audit', '--no-fund', PKG];
  const p = WIN && /\.(cmd|bat)$/i.test(npm)
    ? spawn('"' + npm + '"', args.map((a) => (a === DIR ? '"' + a + '"' : a)), { shell: true, stdio: ['ignore', out, out], windowsHide: true })   // npm's Windows shims need a shell
    : spawn(npm, args, { stdio: ['ignore', out, out], windowsHide: true });
  job = p;
  const done = (why) => { job = null; try { fs.closeSync(out); } catch {} if (why) lastError = why; else if (installed()) warm(); };
  p.on('error', (e) => done('npm: ' + e.message));
  p.on('close', (code) => done(code === 0 && installed() ? '' : 'npm install failed (exit ' + code + ')'));
  return status();
}

// ---- worker: one child process, started on first use (or by warm()), restarted on crash up to MAX_RESTARTS times
let worker = null, restarts = 0, seq = 0;
function startWorker() {
  if (worker) return worker;
  if (restarts >= MAX_RESTARTS) throw new Error('kokoro worker gave up');
  const p = spawn(process.execPath, [WORKER], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AGENT_STANDUP_KOKORO_DIR: DIR, AGENT_STANDUP_KOKORO_DTYPE: DTYPE }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const w = (worker = { p, ready: false, pending: new Map(), err: '' });
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }   // anything that is not ours (library chatter) is ignored
      if (m.ready) { w.ready = true; lastError = ''; continue; }
      const r = w.pending.get(m.id); if (!r) continue; w.pending.delete(m.id);
      m.ok ? r.resolve(m) : r.reject(new Error(m.error || 'tts failed'));
    }
  });
  p.stderr.on('data', (d) => { w.err = (w.err + d).slice(-600); });
  p.stdin.on('error', () => {});   // a write after the worker died is reported through 'close', not as an unhandled stream error
  const gone = (why) => { if (worker !== w) return; worker = null; restarts++; lastError = why; for (const r of w.pending.values()) r.reject(new Error(why)); w.pending.clear(); };
  p.on('error', (e) => gone('kokoro worker: ' + e.message));
  p.on('close', (code) => gone('kokoro worker exited (' + code + ') ' + (w.err.trim().split('\n').pop() || '')));
  return w;
}
function warm() { if (installed() && !worker && restarts < MAX_RESTARTS) try { startWorker(); } catch {} }
function synth(text, voice, speed, out) {
  if (!installed()) return Promise.reject(new Error('kokoro not installed'));
  if (!hasVoice(voice)) return Promise.reject(new Error('unknown voice'));
  let w; try { w = startWorker(); } catch (e) { return Promise.reject(e); }
  const id = ++seq;
  return new Promise((resolve, reject) => { w.pending.set(id, { resolve, reject }); w.p.stdin.write(JSON.stringify({ id, text, voice, speed, out }) + '\n'); });
}
function status() {
  let log = ''; try { log = fs.readFileSync(LOG, 'utf8').slice(-400); } catch {}
  return { dir: DIR, dtype: DTYPE, sizeMb: SIZE_MB, installed: installed(), installing: !!job, ready: !!(worker && worker.ready), gaveUp: restarts >= MAX_RESTARTS, error: lastError || null, npm: findNpm(), log };
}
function shutdown() { if (worker) { try { worker.p.kill(); } catch {} worker = null; } if (job) { try { job.kill(); } catch {} job = null; } }
const _reset = () => { restarts = 0; lastError = ''; };

module.exports = { DIR, DTYPE, voices, hasVoice, speedFor, status, install, warm, synth, shutdown, findNpm, _reset };
```

- [ ] **Step 4: Run, expect pass**

Run: `node --test test/kokoro.test.js`
Expected: `ℹ pass 5`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add kokoro.js test/kokoro.test.js
git commit -m "kokoro: on-demand install, worker lifecycle, voice list"
```

---

### Task 4: Server routes

**Files:**
- Modify: `server.js` (require near the top; `listVoices`/`synthesize`/`tts` at ~398–447; `shutdown` at ~386; routes at ~482–487)
- Create: `test/server.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/server.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-server-'));
process.env.AGENT_STANDUP_KOKORO_DIR = tmp;
process.env.AGENT_STANDUP_KOKORO_WORKER = path.join(__dirname, 'stub-worker.js');
const kokoro = require('../kokoro.js');
const { start, shutdown } = require('../server.js');

let base, srv;
test.before(async () => { srv = start(0); await new Promise((r) => srv.once('listening', r)); base = 'http://localhost:' + srv.address().port; });
test.after(() => { shutdown(); srv.close(); });
const get = (p, init) => fetch(base + p, init);

test('kokoro voices unavailable before install; status reports it', async () => {
  const v = await (await get('/api/voices?engine=kokoro')).json();
  assert.equal(v.available, false); assert.equal(v.engine, 'kokoro');
  const st = await (await get('/api/kokoro')).json();
  assert.equal(st.installed, false);
});

test('system voices are unchanged', async () => {
  const v = await (await get('/api/voices')).json();
  assert.equal(v.engine, 'system'); assert.equal(typeof v.available, 'boolean');
});

test('kokoro tts returns a wav once installed', async () => {
  const d = path.join(tmp, 'node_modules', 'kokoro-js'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'package.json'), '{}');
  const v = await (await get('/api/voices?engine=kokoro')).json();
  assert.equal(v.available, true); assert.equal(v.voices[0].name, 'af_heart');
  const r = await get('/api/tts?engine=kokoro&voice=af_heart&rate=180&text=hello');
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/wav');
  const b = Buffer.from(await r.arrayBuffer()); assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  const bad = await get('/api/tts?engine=kokoro&voice=Samantha&rate=180&text=hello');
  assert.equal(bad.status, 400);
  kokoro.shutdown();
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node --test test/server.test.js`
Expected: FAIL on `v.engine` (undefined) and `/api/kokoro` returning 404.

- [ ] **Step 3: Edit `server.js`**

Add after `const { execFileSync } = require('child_process');`:

```js
const kokoro = require('./kokoro.js');   // natural voices, installed on demand (see kokoro.js)
```

Replace the `shutdown` line:

```js
const shutdown = () => { trWorkers.forEach((w) => w.kill()); kokoro.shutdown(); };
```

After `listVoices()` (just before `const ttsDir = ...`), add:

```js
function voicesFor(engine) {   // the voice list the page asks for: Kokoro when installed and alive, else the system voices
  if (engine === 'kokoro') { const st = kokoro.status(); if (st.installed && !st.gaveUp) kokoro.warm(); return { available: st.installed && !st.gaveUp, voices: kokoro.voices(), platform: process.platform, engine: 'kokoro' }; }
  return { ...listVoices(), engine: 'system' };
}
```

Change `synthesize` to take the engine, dispatching first:

```js
function synthesize(voice, wpm, text, out, engine) {
  if (engine === 'kokoro') return kokoro.synth(text, voice, kokoro.speedFor(wpm), out);
  return new Promise((resolve, reject) => {
    let p;
    if (MAC) p = spawn('say', ['-v', voice, '-r', String(wpm), '--data-format=LEI16@22050', '-o', out, '--', text]);
    else if (WIN) {
      const rate = Math.max(-6, Math.min(8, Math.round((wpm - 175) / 12)));   // SAPI rate: -10..10
      p = spawn('powershell.exe', [...PS, '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice($env:AS_VOICE); $s.Rate = [int]$env:AS_RATE; $s.SetOutputToWaveFile($env:AS_OUT); $s.Speak($env:AS_TEXT); $s.Dispose()'],
        { env: { ...process.env, AS_VOICE: voice, AS_RATE: String(rate), AS_OUT: out, AS_TEXT: text }, windowsHide: true });
    } else p = spawn('espeak-ng', ['-v', voice, '-s', String(wpm), '-w', out, '--', text]);
    p.on('error', reject); p.on('close', (code) => (code === 0 && fs.existsSync(out) ? resolve() : reject(new Error('tts failed'))));
  });
}
```

Change `tts` to validate per engine and key the cache on it:

```js
function tts(text, voice, rate, engine = 'system') {
  if (engine === 'kokoro') { if (!kokoro.hasVoice(voice)) return Promise.reject(new Error('unknown voice')); }
  else { const vs = listVoices(); if (!vs.available || !vs.voices.some((v) => v.name === voice)) return Promise.reject(new Error('unknown voice')); }
  text = String(text).slice(0, 700); rate = Math.max(90, Math.min(360, Math.round(+rate || 180)));
  const key = crypto.createHash('sha1').update([engine, voice, rate, text].join('|')).digest('hex'), file = path.join(ttsDir, key + '.wav');
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (ttsJobs.has(key)) return ttsJobs.get(key);
  fs.mkdirSync(ttsDir, { recursive: true });
  const tmp = file + '.part.wav';
  const job = synthesize(voice, rate, text, tmp, engine).then(() => { fs.renameSync(tmp, file); return file; }).finally(() => ttsJobs.delete(key));
  ttsJobs.set(key, job); return job;
}
```

Replace the two voice routes and add the two Kokoro routes:

```js
    if (url.pathname === '/api/voices') return json(voicesFor(url.searchParams.get('engine') || 'system'));
    if (url.pathname === '/api/tts') {
      return tts(url.searchParams.get('text') || '', url.searchParams.get('voice'), url.searchParams.get('rate'), url.searchParams.get('engine') === 'kokoro' ? 'kokoro' : 'system')
        .then((f) => { res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'max-age=86400' }); fs.createReadStream(f).pipe(res); })
        .catch((e) => json({ error: String(e.message) }, 400));
    }
    if (url.pathname === '/api/kokoro') return json(kokoro.status());
    if (url.pathname === '/api/kokoro/install' && req.method === 'POST') return json(kokoro.install());
```

- [ ] **Step 4: Run all tests, expect pass**

Run: `node --test test/`
Expected: `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server.js test/server.test.js
git commit -m "server: engine parameter on voices and tts, kokoro status and install routes"
```

---

### Task 5: Client — switch, install box, engine-aware TTS

**Files:**
- Modify: `public/index.html` — CSS (~line 186), menu (~231), prefs (~288), `TTS` (~611–627), `speakServer` (~700–703), menu click (~1521), `init()` (~1553)

- [ ] **Step 1: CSS** — after the `#menu .hint` rule (line ~186) add:

```css
  #kokoroInstall { width:100%; padding:7px 10px; border-radius:8px; background:var(--accent); color:#fff; margin:4px 0 2px } #kokoroInstall:disabled { opacity:.5; cursor:default }
```

- [ ] **Step 2: Menu** — right after the `data-t="voice"` row add:

```html
  <button class="mi" data-t="kokoro"><span data-fr="Voix naturelles (Kokoro)" data-en="Natural voices (Kokoro)">Voix naturelles (Kokoro)</span><i class="sw"></i></button>
  <div class="box" id="kokoroBox" style="display:none"><button id="kokoroInstall"></button><div class="hint" id="kokoroHint" style="padding:2px 0 6px"></div></div>
```

- [ ] **Step 3: Prefs** — add `kokoro: true` to the `prefs` defaults (between `voice: true` and `roster: true`).

- [ ] **Step 4: TTS object** — replace the whole `const TTS = { ... };` with:

```js
const TTS = {
  server: false, platform: '', engine: 'system', dead: false, pool: { fr: [], en: [] }, cache: new Map(),
  async init() {   // Kokoro when the user wants it and the server has it (its order is the character order), else the ranked system voices
    this.server = false; this.engine = 'system'; this.pool = { fr: [], en: [] };
    if (prefs.kokoro && !this.dead) {
      try { const d = await (await fetch('/api/voices?engine=kokoro')).json(); if (d.available) { this.server = true; this.engine = 'kokoro'; for (const l of ['fr', 'en']) this.pool[l] = d.voices.filter((v) => v.locale.startsWith(l + '_')).map((v) => v.name).slice(0, 8); return; } } catch {}
    }
    try { const d = await (await fetch('/api/voices')).json(); this.platform = d.platform || ''; if (!d.available) return; this.server = true;
      for (const l of ['fr', 'en']) this.pool[l] = rankVoices(d.voices.filter((v) => v.locale.startsWith(l + '_')).map((v) => v.name)); } catch {}
  },
  voiceFor(p, fr = FR()) { const pool = this.pool[fr ? 'fr' : 'en']; return pool.length ? (p.id === 'main' ? pool[0] : pool[(p.vi >>> 2) % pool.length]) : null; },
  rate() { return Math.round(Math.max(120, Math.min(330, 178 * (S.live ? 1.12 : +$('#speed').value))) / 10) * 10; },
  buf(text, voice, rate) {
    const key = this.engine + '|' + voice + '|' + rate + '|' + text;
    if (!this.cache.has(key)) {
      this.cache.set(key, fetch(`/api/tts?engine=${this.engine}&voice=${encodeURIComponent(voice)}&rate=${rate}&text=${encodeURIComponent(text)}`).then((r) => { if (!r.ok) throw new Error('tts'); return r.arrayBuffer(); }).then((b) => AUD.ctx.decodeAudioData(b)));
      if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
      this.cache.get(key).catch(() => this.cache.delete(key));
    }
    return this.cache.get(key);
  },
  fail() { if (this.engine !== 'kokoro' || this.dead) return; this.dead = true; this.init().then(updateHint); },   // Kokoro broke mid-session: system voices for the rest of it
};
```

- [ ] **Step 5: speakServer** — change its second line to fall back when Kokoro fails:

```js
  let buf; try { buf = await TTS.buf(speakable(text), voice, TTS.rate()); } catch (e) { TTS.fail(); throw e; } if (token !== S.token) return;
```

- [ ] **Step 6: Install box** — after `function warmTTS(i) { ... }` add:

```js
// ---- ⚙ → Natural voices (Kokoro): install box and status, polled while installing
let kokoroTimer = null;
async function kokoroUI() {
  const box = $('#kokoroBox'), btn = $('#kokoroInstall'), hint = $('#kokoroHint'); clearTimeout(kokoroTimer);
  if (!prefs.kokoro) { box.style.display = 'none'; return; }
  let st = null; try { st = await (await fetch('/api/kokoro')).json(); } catch {} if (!st) { box.style.display = 'none'; return; }
  if (st.installed && !st.installing) {
    box.style.display = st.error ? '' : 'none'; btn.style.display = 'none'; hint.textContent = st.error ? L('Voix naturelles indisponibles : ', 'Natural voices unavailable: ') + st.error : '';
    if (TTS.engine !== 'kokoro' && !TTS.dead) TTS.init().then(updateHint);
    return;
  }
  box.style.display = ''; btn.style.display = ''; btn.disabled = st.installing || !st.npm;
  btn.textContent = st.installing ? L('Installation…', 'Installing…') : st.error ? L('Réessayer', 'Retry') : L(`Installer (une fois, ~${st.sizeMb} Mo)`, `Install (one-time, ~${st.sizeMb} MB)`);
  hint.textContent = !st.npm ? L('npm introuvable : installez Node.js pour les voix naturelles.', 'npm not found: install Node.js to use natural voices.')
    : st.installing ? (st.log.trim().split('\n').pop() || '…')
    : st.error ? L('Échec de l’installation : ', 'Install failed: ') + st.error
    : L('Télécharge kokoro-js (npm) et le modèle Kokoro-82M (Hugging Face) dans ', 'Downloads kokoro-js (npm) and the Kokoro-82M model (Hugging Face) into ') + st.dir;
  if (st.installing) kokoroTimer = setTimeout(kokoroUI, 2000);
}
$('#kokoroInstall').onclick = async () => { $('#kokoroInstall').disabled = true; try { await fetch('/api/kokoro/install', { method: 'POST' }); } catch {} kokoroUI(); };
```

- [ ] **Step 7: Menu click** — in the `$('#menu').onclick` handler, before its final `};`, add:

```js
  if (b.dataset.t === 'kokoro') { TTS.dead = false; TTS.cache.clear(); TTS.init().then(updateHint); kokoroUI(); }
```

and in `$('#bMenu').onclick` add `kokoroUI();` after the toggle:

```js
$('#bMenu').onclick = (e) => { e.stopPropagation(); $('#menu').classList.toggle('on'); kokoroUI(); };
```

- [ ] **Step 8: init** — change `TTS.init().then(updateHint);` in `init()` to `TTS.init().then(updateHint).then(kokoroUI);`.

- [ ] **Step 9: Check the page still parses and the tests pass**

Run: `node -e "const s=require('fs').readFileSync('public/index.html','utf8'); const m=s.match(/<script>([\s\S]*)<\/script>/); new Function(m[1]); console.log('ok')"` — Expected: `ok` (syntax only; the script references `document`, so it is compiled, not run).
Run: `node --test test/` — Expected: `ℹ fail 0`.

- [ ] **Step 10: Commit**

```bash
git add public/index.html
git commit -m "web: natural voices switch, install box, Kokoro engine in TTS with system fallback"
```

---

### Task 6: Packaging, scripts, README

**Files:**
- Modify: `.vscodeignore`, `package.json`, `README.md`

- [ ] **Step 1: `.vscodeignore`** — add a line `test/**`.

- [ ] **Step 2: `package.json`** — add `"test": "node --test test/"` to `scripts`.

- [ ] **Step 3: README** — after the *Voices* table section (ends with "Each agent gets a stable voice from the best ones installed."), add:

```markdown
### Natural voices (Kokoro)

⚙ → Sound → **Natural voices (Kokoro)** replaces the system voices with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0), a small neural model that runs on your CPU. Eight English characters and one French voice, assigned so each agent sounds different.

Nothing is bundled: the first time, click **Install** in the same box. It runs `npm install kokoro-js` into `~/.cache/agent-standup/kokoro` (`%LOCALAPPDATA%\agent-standup\kokoro` on Windows) and fetches the model from Hugging Face on first use — about 520 MB once, then nothing leaves your machine. Needs `npm` (comes with Node.js). To remove it, delete that folder.

The first line after a cold start takes a few seconds (model load); after that each line is ready before the previous one ends on a recent laptop. `AGENT_STANDUP_KOKORO_DTYPE=q4` (set in the environment of VS Code or `node server.js`) picks a faster, larger model (304 MB); `AGENT_STANDUP_KOKORO_DIR` moves the install folder. If Kokoro fails mid-session, the call falls back to the system voices.
```

In the *Privacy & security* paragraph, after "Translation and jokes send the shortened agent lines to Claude through your own Claude Code login (or your API key if you set one).", add: "Natural voices download packages from npm and the model from Hugging Face once, when you click Install, and synthesise locally afterwards."

In *Privacy and usage counting* at the end, add to the optional network uses: "the one-time download of natural voices (if you install them)".

- [ ] **Step 4: Package check**

Run: `npm run package 2>&1 | tail -3 && ls -la *.vsix`
Expected: a vsix of roughly the same size as before (no `node_modules`, no `test/`).

- [ ] **Step 5: Commit**

```bash
git add .vscodeignore package.json README.md
git commit -m "docs: natural voices (Kokoro) section, npm test, keep tests out of the vsix"
```

---

### Task 7: Manual verification (orchestrator)

- [ ] `node server.js` → open `http://localhost:4747/?demo=1`, ⚙ → Sound, switch on *Natural voices*, click *Install*; the box shows the npm log tail and hides when done.
- [ ] `curl -s 'localhost:4747/api/kokoro'` shows `installed: true`, and after the first line `ready: true`.
- [ ] `curl -s 'localhost:4747/api/tts?engine=kokoro&voice=af_heart&rate=180&text=The%20tests%20pass%20now.' | afplay -` plays Heart.
- [ ] In the demo, the lead and sub-agents have distinct voices and mouths move; switching *Natural voices* off returns to the system voices at once.
- [ ] `code --install-extension agent-standup-1.19.2.vsix`, reload, open the call: voices work inside VS Code (worker runs through Electron with `ELECTRON_RUN_AS_NODE`).
