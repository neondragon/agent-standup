// test/meme.test.js — the pure parts of meme mode (public/meme.js exports MEME_CORE under Node)
const test = require('node:test');
const assert = require('node:assert');
const CORE = require('../public/meme.js');

test('words: capitals first, then the longest, no duplicates, capped, upper-cased', () => {
  assert.deepEqual(CORE.words('the tests pass and the build is GREEN, tests pass', 3), ['GREEN', 'TESTS', 'BUILD']);
  assert.deepEqual(CORE.words('ok', 3), []);   // nothing of three letters or more
  assert.deepEqual(CORE.words('Found it: one query per row. Batched, and the page is fast again.', 2), ['BATCHED', 'FOUND']);   // five letters each: the first one in the line wins the tie
  assert.deepEqual(CORE.words('’quoted’ words—with 1234 digits', 5), ['QUOTED', 'DIGITS', 'WORDS', 'WITH']);   // digits-only tokens are not words
  assert.equal(CORE.words('').length, 0);
});

test('scale: 1 is rare and slow, 11 is certain and quick, everything monotonic, junk means 11', () => {
  const lo = CORE.scale(1), hi = CORE.scale(11);
  assert.equal(lo.chance, 0.2); assert.equal(hi.chance, 1);
  assert.equal(lo.cooldown, 6000); assert.equal(hi.cooldown, 600);
  assert.equal(lo.shake, 2); assert.equal(hi.shake, 18);
  assert.equal(lo.particles, 6); assert.equal(hi.particles, 40);
  let prev = lo;
  for (let l = 2; l <= 11; l++) { const s = CORE.scale(l); assert.ok(s.chance > prev.chance && s.cooldown < prev.cooldown && s.shake > prev.shake && s.particles >= prev.particles, `level ${l}`); prev = s; }
  assert.equal(CORE.scale(0).level, 1); assert.equal(CORE.scale(99).level, 11); assert.equal(CORE.scale(undefined).level, 11); assert.equal(CORE.scale('abc').level, 11); assert.equal(CORE.scale(6.4).level, 6);
});

test('FlashGuard: three flashes a second, then refused, free again after the window', () => {
  let now = 1000; const g = new CORE.FlashGuard(3, 1000, () => now);
  assert.ok(g.ok()); now += 100; assert.ok(g.ok()); now += 100; assert.ok(g.ok());
  now += 100; assert.equal(g.ok(), false); now += 500; assert.equal(g.ok(), false);   // still three within the last second
  now += 250; assert.ok(g.ok());   // the first one is now older than a second
});

test('pick and hash are deterministic', () => {
  assert.equal(CORE.hash('abc'), CORE.hash('abc')); assert.notEqual(CORE.hash('abc'), CORE.hash('abd'));
  const l = ['a', 'b', 'c']; assert.equal(CORE.pick(l, 7), 'b'); assert.equal(CORE.pick(l, CORE.hash('x')), CORE.pick(l, CORE.hash('x'))); assert.equal(CORE.pick(l, -1), l[(-1 >>> 0) % 3]);
});
