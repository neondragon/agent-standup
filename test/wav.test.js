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
