// test/server.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-server-'));
process.env.AGENT_STANDUP_KOKORO_DIR = tmp;
process.env.AGENT_STANDUP_PREFS = path.join(tmp, 'prefs', 'prefs.json');
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

test('the page can pick the kokoro model', async () => {
  const v = await (await get('/api/voices?engine=kokoro&dtype=q4')).json(); assert.equal(v.dtype, 'q4');
  const st = await (await get('/api/kokoro')).json(); assert.equal(st.dtype, 'q4');
  const back = await (await get('/api/voices?engine=kokoro&dtype=q8')).json(); assert.equal(back.dtype, 'q8');
  const junk = await (await get('/api/voices?engine=kokoro&dtype=fp64')).json(); assert.equal(junk.dtype, 'q8');
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

const frames = (b) => { const out = []; for (let i = 0; i + 4 <= b.length;) { const n = b.readUInt32LE(i); out.push(b.subarray(i + 4, i + 4 + n)); i += 4 + n; } return out; };
test('streamed kokoro tts sends one frame per piece, then serves the cached line whole', async () => {
  const q = '/api/tts?engine=kokoro&stream=1&voice=bf_emma&rate=180&text=Streamed%20line%20' + Date.now();   // unique: the cache in os.tmpdir() outlives test runs
  const r = await get(q);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/octet-stream'); assert.equal(r.headers.get('x-sample-rate'), '24000');
  const f = frames(Buffer.from(await r.arrayBuffer()));
  assert.deepEqual(f.map((x) => x.length), [480, 480]);
  const again = frames(Buffer.from(await (await get(q)).arrayBuffer()));
  assert.equal(again.length, 1); assert.equal(again[0].length, 4800);   // the stub's 2400-sample wav, header stripped
  const bad = await get('/api/tts?engine=kokoro&stream=1&voice=Samantha&rate=180&text=hello');
  assert.equal(bad.status, 400);
  kokoro.shutdown();
});

test('settings persist on the server, served as a script the page loads first', async () => {
  assert.deepEqual(await (await get('/api/prefs')).json(), {});
  assert.equal(await (await get('/api/prefs.js')).text(), 'window.SAVED_PREFS = null;');
  const put = await fetch(base + '/api/prefs', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: 'en', voiceSpeed: 1.3 }) });
  assert.equal((await put.json()).ok, true);
  assert.deepEqual(await (await get('/api/prefs')).json(), { lang: 'en', voiceSpeed: 1.3 });
  assert.equal(await (await get('/api/prefs.js')).text(), 'window.SAVED_PREFS = {"lang":"en","voiceSpeed":1.3};');
  const bad = await fetch(base + '/api/prefs', { method: 'PUT', body: '[1]' }); assert.equal(bad.status, 400);
  assert.deepEqual(JSON.parse(fs.readFileSync(process.env.AGENT_STANDUP_PREFS, 'utf8')), { lang: 'en', voiceSpeed: 1.3 });
});

test('meme mode files are served with their types, the bundled clip included', async () => {
  const js = await get('/meme.js'); assert.equal(js.status, 200); assert.equal(js.headers.get('content-type'), 'text/javascript');
  const css = await get('/meme.css'); assert.equal(css.status, 200); assert.equal(css.headers.get('content-type'), 'text/css');
  const mp3 = await get('/sfx/oh-my-god.mp3'); assert.equal(mp3.status, 200); assert.equal(mp3.headers.get('content-type'), 'audio/mpeg'); assert.equal((await mp3.arrayBuffer()).byteLength, 27002);
});
