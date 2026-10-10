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
  assert.equal(kokoro.speedFor(178), 1); assert.equal(kokoro.speedFor(80), 0.5); assert.equal(kokoro.speedFor(400), 2); assert.equal(kokoro.speedFor(200), 1.1); assert.equal(kokoro.speedFor(205), 1.15);
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
