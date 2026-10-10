// test/current.test.js — which session a live page follows
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-root-'));
process.env.AGENT_STANDUP_PROJECTS = root;
process.env.AGENT_STANDUP_KOKORO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'as-k-'));
const { currentSession } = require('../server.js');
const mk = (proj, id, ageMs) => { const d = path.join(root, proj); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, id + '.jsonl'); fs.writeFileSync(f, '{}\n'); const t = (Date.now() - ageMs) / 1000; fs.utimesSync(f, t, t); };

test('a workspace folder also matches sessions in its subfolders; nothing matching falls back to the newest anywhere', () => {
  mk('-ws', 'a', 60000); mk('-ws-sub', 'b', 30000); mk('-other', 'c', 1000);
  assert.deepEqual(currentSession('-ws').id, 'b');
  assert.equal(currentSession('').id, 'c');
  assert.equal(currentSession('-nope').id, 'c');
});

test('the followed session is kept while it is active, dropped once it has been idle', () => {
  mk('-ws', 'a', 60000); mk('-other', 'c', 1000);
  assert.equal(currentSession('', '', { proj: '-ws', id: 'a' }).id, 'a');     // active 1 min ago: stays
  mk('-ws', 'a', 120000);
  assert.equal(currentSession('', '', { proj: '-ws', id: 'a' }).id, 'c');     // idle 2 min: the newest wins
  assert.equal(currentSession('', '', { proj: '-ws', id: '../x' }).id, 'c'); // junk stick is ignored
});
