// Agent Standup — natural voices with Kokoro-82M (kokoro-js on ONNX Runtime), installed on demand outside the extension.
// Nothing here runs until the user clicks Install in ⚙ → Sound.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WIN = process.platform === 'win32';
const DIR = process.env.AGENT_STANDUP_KOKORO_DIR || (WIN ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-standup', 'kokoro') : path.join(os.homedir(), '.cache', 'agent-standup', 'kokoro'));
const DTYPES = /^(q8|q4|fp32|fp16)$/;   // q4f16 is gone: its fp16 activations overflow on some lines and the model returns NaN (silence)
let DTYPE = DTYPES.test(process.env.AGENT_STANDUP_KOKORO_DTYPE || '') ? process.env.AGENT_STANDUP_KOKORO_DTYPE : 'q4';   // q4: 305 MB, fast (3× realtime on an M1); q8: 97 MB, half the speed, less RAM
const PKG = 'kokoro-js@1.2.1';
const WORKER = process.env.AGENT_STANDUP_KOKORO_WORKER || path.join(__dirname, 'kokoro-worker.js');
const LOG = path.join(DIR, 'install.log');
const SIZE_MB = 730;   // ≈ 424 MB of packages + 305 MB model (q4)
const MAX_RESTARTS = 3;

// Voices in the order agents get them (the lead takes the first), so successive agents sound distinct. Grades from the Kokoro model card.
const VOICES = [
  ['af_heart', 'Heart', 'en_US'], ['am_fenrir', 'Fenrir', 'en_US'], ['bf_emma', 'Emma', 'en_GB'], ['am_michael', 'Michael', 'en_US'],
  ['af_bella', 'Bella', 'en_US'], ['bm_george', 'George', 'en_GB'], ['af_sarah', 'Sarah', 'en_US'], ['am_puck', 'Puck', 'en_US'],
  ['ff_siwis', 'Siwis', 'fr_FR'],
].map(([name, label, locale]) => ({ name, label, locale }));
const voices = () => VOICES;
const hasVoice = (n) => VOICES.some((v) => v.name === n);
const speedFor = (wpm) => Math.max(0.5, Math.min(2, Math.round((wpm / 178) * 20) / 20));   // 178 wpm ≈ Kokoro's natural pace

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

// ---- worker: one child process, started on first use (or by warm()), restarted on crash up to MAX_RESTARTS times.
// It makes one line at a time, so requests wait here in a queue: a streamed line (someone is listening to it right now)
// goes before the lines the page prepares ahead of time, which would otherwise hold the first words back for 20 s or more.
let worker = null, restarts = 0, seq = 0, queue = [], busy = false;
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
      const r = w.pending.get(m.id); if (!r) continue;
      if (m.chunk !== undefined) { if (r.onChunk) r.onChunk(Buffer.from(m.chunk, 'base64'), m.seconds); continue; }
      w.pending.delete(m.id);
      m.ok ? r.resolve(m) : r.reject(new Error(m.error || 'tts failed'));
    }
  });
  p.stderr.on('data', (d) => { w.err = (w.err + d).slice(-600); });
  p.stdin.on('error', () => {});   // a write after the worker died is reported through 'close', not as an unhandled stream error
  const gone = (why) => { if (worker !== w) return; worker = null; restarts++; lastError = why; fail(w, why); };
  p.on('error', (e) => gone('kokoro worker: ' + e.message));
  p.on('close', (code) => gone('kokoro worker exited (' + code + ') ' + (w.err.trim().split('\n').pop() || '')));
  return w;
}
const fail = (w, why) => { const jobs = [...w.pending.values()]; w.pending.clear(); busy = false; for (const r of jobs) r.reject(new Error(why)); };   // the worker's job is lost: tell the caller, then move on to the next in the queue
function warm() { if (installed() && !worker && restarts < MAX_RESTARTS) try { startWorker(); } catch {} }
function setDtype(d) {   // the page's choice of model; a change restarts the worker, which fetches the other model on first use
  if (!DTYPES.test(d || '') || d === DTYPE) return false;
  DTYPE = d; restarts = 0; lastError = '';
  if (worker) { const w = worker; worker = null; try { w.p.kill(); } catch {} queue.unshift(...[...w.pending.values()].map((r) => r.job)); w.pending.clear(); busy = false; }   // the line in progress is made again by the new model
  warm(); pump(); return true;
}
function pump() {   // hand the worker its next line once it is free
  if (busy || !queue.length) return;
  const job = queue.shift(); let w; try { w = startWorker(); } catch (e) { job.reject(e); return pump(); }
  const id = ++seq; busy = true;
  const next = (fn) => (v) => { busy = false; fn(v); pump(); };
  w.pending.set(id, { job, onChunk: job.onChunk, resolve: next(job.resolve), reject: next(job.reject) });
  w.p.stdin.write(JSON.stringify({ id, text: job.text, voice: job.voice, speed: job.speed, out: job.out, stream: job.stream }) + '\n');
}
function synth(text, voice, speed, out, onChunk) {   // with onChunk(pcm16Buffer, seconds): streamed piece by piece, the whole line still written to `out`
  if (!installed()) return Promise.reject(new Error('kokoro not installed'));
  if (!hasVoice(voice)) return Promise.reject(new Error('unknown voice'));
  return new Promise((resolve, reject) => {
    const job = { text, voice, speed, out, stream: !!onChunk, onChunk, resolve, reject };
    if (job.stream) { const k = queue.findIndex((j) => !j.stream); queue.splice(k < 0 ? queue.length : k, 0, job); } else queue.push(job);   // listened to now: ahead of the lines made ahead of time
    pump();
  });
}
function status() {
  let log = ''; try { log = fs.readFileSync(LOG, 'utf8').slice(-400); } catch {}
  return { dir: DIR, dtype: DTYPE, sizeMb: SIZE_MB, installed: installed(), installing: !!job, ready: !!(worker && worker.ready), gaveUp: restarts >= MAX_RESTARTS, error: lastError || null, npm: findNpm(), log };
}
function shutdown() {
  const waiting = queue.splice(0); for (const j of waiting) j.reject(new Error('kokoro shut down'));   // the queue first: failing the line in progress pumps the queue, which would start a worker again
  if (worker) { const w = worker; worker = null; try { w.p.kill(); } catch {} fail(w, 'kokoro shut down'); }
  busy = false;
  if (job) { try { job.kill(); } catch {} job = null; }
}
const _reset = () => { restarts = 0; lastError = ''; };

module.exports = { DIR, dtype: () => DTYPE, setDtype, voices, hasVoice, speedFor, status, install, warm, synth, shutdown, findNpm, _reset };
