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
    if (m.stream) for (let i = 0; i < 2; i++) send({ id: m.id, chunk: Buffer.alloc(480).toString('base64'), seconds: 0.01 });   // two silent pieces
    fs.writeFileSync(m.out, wav(new Float32Array(2400), 24000));
    send({ id: m.id, ok: true, seconds: 0.1 });
  }
})();
