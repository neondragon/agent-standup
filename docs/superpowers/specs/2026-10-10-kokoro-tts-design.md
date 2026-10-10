# Natural voices with Kokoro — design

Date: 2026-10-10. Fork: neondragon/agent-standup, based on upstream 1.19.2.

## Goal

Give the agents far better voices than `say`, SAPI and espeak-ng, without
leaving the project's posture: nothing ships in the vsix that is not already
there, nothing leaves the machine except one explicit, one-time download.

Kokoro-82M (Apache 2.0) through `kokoro-js` does this: 28 English voices with
quality grades and gender, one French voice, runs on the CPU through ONNX
Runtime in Node.

## Measurements (Apple M1, Node 26, low power mode off)

| | q8 (default) | q4 |
|---|---|---|
| Model download | 97 MB | 304 MB |
| Warm model load | 0.6 s | 0.6 s |
| Generation speed | ~1.7× realtime | ~3.5× realtime |

With low power mode on, q8 drops to 0.9× realtime and q4 to ~3×.
`npm install kokoro-js@1.2.1` takes about a minute and 424 MB. A
700-character line synthesises in full. A process can load the model only once:
a second load crashes the wasm phonemiser. CoreML is not reachable from
transformers.js in Node, so generation stays on the CPU.

## Approaches rejected

- **Bundle in the vsix.** 400 MB of native binaries for every platform.
- **Run Kokoro in the webview (wasm).** Needs cross-origin isolation inside
  VS Code's iframe, and wasm is slower than native ONNX. Possible later as a
  browser-mode fallback.

## Architecture

Three new files; `server.js` gains routing only.

### `kokoro.js` (server module)

Owns everything Kokoro on the server side.

- `DIR`: `$AGENT_STANDUP_KOKORO_DIR`, else `~/.cache/agent-standup/kokoro`
  (`%LOCALAPPDATA%\agent-standup\kokoro` on Windows). Contains
  `node_modules/`, `models/` and `install.log`.
- `DTYPE`: `$AGENT_STANDUP_KOKORO_DTYPE`, default `q8`, `q4` for speed.
- `status()` → `{ installed, installing, ready, error, npm, log }`.
  `installed` means `node_modules/kokoro-js` exists; `ready` means the worker
  has loaded the model; `log` is the last 400 characters of `install.log`;
  `npm` is the path found, or null.
- `install()`: finds `npm` on `PATH` and in the same directories `findClaude`
  searches, then spawns `npm install --prefix DIR --no-audit --no-fund
  kokoro-js@1.2.1`, appending output to `install.log`. One install at a time.
  Returns at once; the client polls `status()`.
- `voices()` → the fixed, ordered list below, each
  `{ name, label, locale }`.
- `synth(text, voice, speed, outFile)`: sends one request to the worker and
  resolves when the WAV is written. Starts the worker on first use; restarts it
  on crash up to 3 times per server life, after which it rejects and the client
  falls back to system voices.
- `shutdown()`: kills the worker.

Worker launch: `spawn(process.execPath, [kokoro-worker.js], { env:
{ ...process.env, ELECTRON_RUN_AS_NODE: '1' } })`. Under VS Code
`process.execPath` is Code's Electron, which this flag turns into plain Node;
under `node server.js` it is Node and the flag is harmless. onnxruntime-node
and sharp are N-API addons, so the Electron ABI is not a concern.

### `kokoro-worker.js`

Loads the model once (`env.cacheDir = DIR/models`, `dtype`, `device: 'cpu'`)
and serves requests from stdin, one JSON object per line:

```
→ { id, text, voice, speed, out }
← { id, ok: true, seconds }      or      { id, ok: false, error }
← { ready: true }                 once, after the model has loaded
```

Audio comes back as `Float32Array` at 24 kHz; the worker writes 16-bit PCM WAV
to `out` with a small encoder of its own (no dependency). Requests are
processed one at a time. Any uncaught error exits the process; the parent
restarts it.

### `server.js` changes

- `/api/voices?engine=kokoro` → `{ available, voices, platform, engine }`.
  `available` is false until `status().installed`. Without `engine`, or with
  `engine=system`, the existing behaviour is unchanged.
- `/api/tts?engine=kokoro&voice=&rate=&text=` → WAV. The cache key becomes
  `sha1(engine|voice|rate|text)`. Rate (wpm, 90–360) maps to Kokoro speed by
  `rate / 178`, clamped to 0.6–1.5.
- `GET /api/kokoro` → `status()`. `POST /api/kokoro/install` → starts the
  install, returns `status()`.
- `shutdown()` also calls `kokoro.shutdown()`.

### Voice order

The server returns voices in this order so successive agents get distinct
characters; the lead gets the first.

- `en`: af_heart (Heart), am_fenrir (Fenrir), bf_emma (Emma), am_michael
  (Michael), af_bella (Bella), bm_george (George), af_nicole (Nicole),
  am_puck (Puck). Locales `en_US` / `en_GB` by prefix.
- `fr`: ff_siwis (Siwis), `fr_FR`.

### Client (`public/index.html`)

- `prefs.kokoro`: boolean, default `true`; the client
  falls back to system voices whenever Kokoro is unavailable, so the default
  costs nothing before the install.
- ⚙ → Sound gains, under *Agent voices*:
  - a switch **Natural voices (Kokoro)** bound to `prefs.kokoro`;
  - when not installed, a box with **Install (one-time, ~520 MB)** and a
    status line; while installing, the status line shows the log tail and the
    page polls `/api/kokoro` every 2 s; on success the voice pool reloads.
- `TTS.init()` fetches `/api/voices?engine=kokoro` when
  `prefs.kokoro` is true; if `available` is false it fetches the system
  list as today. `TTS.engine` records which one is in use and `TTS.buf()` passes
  it to `/api/tts`.
- `rankVoices()` is bypassed for Kokoro: the server's order is used and the
  pool cap is 8 instead of 5.
- The hint line gains two messages: *npm not found: install Node.js to use
  natural voices* and *Natural voices failed to install (see log)*.
- Nothing else changes. Lip-sync reads the decoded buffer, the cartoon FX chain
  and the voice styles sit downstream of the buffer, warm-ahead and the
  hurry rule work as before.

## Streaming (added 2026-10-10)

Waiting for a whole line meant a 6 s line sat ~3.5 s before its first word.
Now a Kokoro line that is not yet cached is streamed:

- The worker takes `stream: true`, drives kokoro-js's `TextSplitterStream`
  itself (its string input never closes the splitter, which hangs on the last
  sentence), pushing pieces from `pieces()`: sentences, and sentences over
  110 characters cut at clause boundaries into ~90-character pieces so chunk
  lengths stay even. Each piece is sent as `{ id, chunk: <base64 pcm16>,
  seconds }`, then the usual `{ id, ok, seconds }` after the full WAV is
  written. Output goes through `fs.writeSync(1, …)`: on macOS a pipe write from
  `process.stdout` is queued until the loop is idle, which held every chunk
  back until the line was done.
- `GET /api/tts?engine=kokoro&stream=1&…` answers `application/octet-stream`
  with `x-sample-rate: 24000` and frames `[u32 LE length][pcm16]`. A line
  already cached or in progress is sent as one frame. The line still lands in
  the cache under the same key as the non-streamed route.
- The page's `speakStream()` builds one analyser/FX chain fed by a shared gain
  node, converts each frame to an `AudioBuffer` and schedules it back to back;
  the cartoon pitch (`fx.rate`) goes on each chunk's source. `speakServer()`
  uses it when the engine is Kokoro and the line is not in the page cache;
  `warmTTS()` now warms from the next line, so the current line streams.

Measured on the M1 (warm worker, low power off): first chunk (~2 s of audio)
at 1.2–1.4 s; a whole 9 s line took 5.4 s before.

## Error handling

| Case | Behaviour |
|---|---|
| `npm` not found | `status().npm` null; install button disabled; hint explains |
| Install fails | `status().error` set; log tail shown; button reads *Retry* |
| Model download fails (no network) | worker exits with the error; `status().error` shows it; system voices used |
| Worker crashes | restarted on next request, 3 times max, then system voices for this server life |
| Unknown voice or empty text | 400, as today |

## Testing

`node --test test/` with Node's built-in runner.

- `test/wav.test.js`: the encoder writes a valid 16-bit 24 kHz header and
  clamps samples.
- `test/kokoro.test.js`: `status()` on an empty dir; `voices()` order and
  locales; `synth()` against a stub worker (`AGENT_STANDUP_KOKORO_WORKER`
  points at a test script that writes a silent WAV) including a crash and
  restart.
- `test/server.test.js`: `/api/voices?engine=kokoro` reports unavailable on an
  empty dir; `/api/tts?engine=kokoro` returns a WAV with the stub worker.

Manual: `node server.js`, install from the menu, `curl
'localhost:4747/api/tts?engine=kokoro&voice=af_heart&rate=180&text=hello' |
afplay -`, then a listen in VS Code with several sub-agents.

## Documentation

README: a *Natural voices (Kokoro)* section (what, where it installs, size,
how to remove it, `AGENT_STANDUP_KOKORO_DTYPE`), and the privacy paragraph
updated: the install downloads packages from npm and the model from Hugging
Face once, on the user's click, and never afterwards.

## Out of scope

Bundling, in-browser wasm, per-agent voice choice in the UI, other engines,
upstream PR packaging (version stays 1.19.2 until upstream takes it or the
fork publishes).
