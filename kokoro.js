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
