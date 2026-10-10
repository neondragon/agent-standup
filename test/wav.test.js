// test/wav.test.js
const test = require('node:test');
const assert = require('node:assert');
const { wav, pieces, finite } = require('../kokoro-worker.js');

test('finite spots NaN output (a quantised model can return a whole line of NaN)', () => {
  assert.equal(finite(new Float32Array([0, 0.5, -1])), true);
  assert.equal(finite(new Float32Array(0)), true);
  assert.equal(finite(new Float32Array([0, NaN, 0.2])), false);
  assert.equal(finite(new Float32Array(1000).fill(NaN)), false);
});

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

test('pieces: sentences, long sentences cut at clauses, nothing lost', () => {
  assert.deepEqual(pieces('Done. The tests pass now! Next?'), ['Done.', 'The tests pass now!', 'Next?']);
  assert.deepEqual(pieces('no punctuation at all'), ['no punctuation at all']);
  assert.deepEqual(pieces('First words at 2.3 seconds. Next one (v1.2) here!'), ['First words at 2.3 seconds.', 'Next one (v1.2) here!']);
  const long = 'First clause goes here and keeps going for a while, second clause also keeps going for quite a while longer, third clause goes on and on and on and on, fourth clause finishes the sentence at last.';
  const p = pieces(long);
  assert.ok(p.length >= 2 && p.every((x) => x.length <= 110), p);
  assert.equal(p.join(' '), long);
});
