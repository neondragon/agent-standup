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
