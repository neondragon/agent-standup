# Meme mode — design

Date: 2026-10-10. Fork: neondragon/agent-standup, based on upstream 1.19.2.

## Goal

An optional "meme mode" that turns the call into a 2010s montage parody:
MLG-style airhorns, hitmarkers and lens flares, Impact-font kinetic captions,
vine booms on failures, sad trombones, iMovie star wipes, "To be continued"
freezes, emoji rain, screen shake. Turned up to 11 by default, with a slider
to turn it down. Off by default. It is a costume over the existing call: it
never changes what is shown or said, only how loudly.

The request said "MLB transitions"; this reads it as the MLG (Major League
Gaming) montage genre, which is the one with airhorns.

## Approaches rejected

- **Remotion.** It renders React compositions to video frames through a Node
  pipeline. This client is one hand-written HTML file with no build step, it
  runs live, and its motion is CSS keyframes plus the Web Animations API.
  Remotion would add React, a bundler and a render server to play an airhorn.
  Everything Remotion would be used for (timed, composed motion) the browser
  already does natively here.
- **Audio files for everything.** The project synthesises every sound
  (office ambience, chimes, babble). Meme sounds mostly follow suit: airhorn,
  boom, trombone, scratch and friends are WebAudio synth patches, so they work
  offline and go through the same recording bus as the other effects. One
  exception, by Alex's call: the "oh my god" clip (27 KB) is bundled in
  `public/sfx/`, served same-origin, decoded once into the same bus. The
  synth boom stands in if it fails to load. More clips can join the
  `MEME.CLIPS` table the same way.
- **A second page or build.** A separate "meme skin" page would fork the
  client. A module with a handful of hook calls keeps one client.

## Architecture

Two new files and a few lines in `public/index.html`.

### `public/meme.js`

One classic script loaded before the main one. It exposes `window.MEME`:

- `MEME.fire(kind, info)` is the only entry point the client calls. Kinds:
  `talk` (an agent starts a line; `info.id`, `info.text`), `combo` (three
  agents talk at once), `order`, `report` (`info.from`, `info.to`), `tool`
  (`info.id`, `info.name`), `fail` (a tool call failed), `leave` (an agent
  dissolves), `win` (the lead finished a long job), `card` (an episode title
  card), `user` (the human typed). Each kind maps to a small schedule of
  sounds and visuals, scaled by intensity, rate-limited per effect.
- `MEME.active()` is true when `prefs.meme` is on and playback is running
  (`S.playing`) and this window owns the audio.
- `MEME.apply()` toggles the `body.meme` class and the audio bus gain. Called
  from the settings toggle and at start-up.
- A ticker (every 4 s) looks at the existing `.tile.quiet` and `.tile.slow`
  classes and plays crickets or "this is fine" over stalled agents, so no
  extra hook is needed for stalls.

The script reads the main client's globals (`prefs`, `S`, `AUD`, `$`, `L`,
`spd`) lazily at call time. Classic scripts share one global lexical scope,
so top-level `let`/`const` of the main script are visible here once it has
run; nothing in `meme.js` touches them at load time.

The pure parts live in `MEME_CORE` and are exported with `module.exports`
when `module` exists, so they run under `node --test` without a DOM:

- `words(text, max)`: picks the loud words of a line (longest, upper-case
  first, de-duplicated) for the kinetic captions.
- `scale(level)`: intensity 1–11 to `{ chance, cooldown, shake, particles }`.
- `FlashGuard`: at most three full-screen flashes per second, whatever the
  intensity. Under `prefers-reduced-motion: reduce` the full-screen flashes
  and wipes are dropped entirely; everything else still runs, because turning
  on a switch called "unhinged" is an explicit ask for motion (checked on a
  Mac with Reduce Motion on: the mode would otherwise be mostly silent).
- `pick(list, seed)`: deterministic choice, so the same event replays the
  same way (the client already uses `hash(ts)` for its quips).

**Sounds** (WebAudio, on a `MEME.bus` gain connected to the destination and
to `AUD.rec` so video exports carry them; gain follows `prefs.memeVol`, 0
when muted or another window owns the audio): airhorn (×1 or ×3), vine boom,
hitmarker, sad trombone, bruh, scream, dramatic sting (an original three-note
"dun dun dunnn", not a recording of anything), record scratch, ba-dum-tss,
sparkle, crickets, crowd "ohhh", dubstep wub, yeet whoosh; plus the bundled
"oh my god" clip on failures. `server.js` learns the `.mp3` MIME type.

**Visuals** go in `#memeLayer`, an absolutely positioned, pointer-events-none
layer appended to `#center`: Impact-font slam text with black stroke, top
text / bottom text, lens flares (spinning conic rainbow, screen blend),
hitmarker crosshairs, emoji rain, screen shake (WAAPI on `#center`), colour
flash, punch-in zoom with chromatic aberration on the speaking tile, "deep
fried" filter pulses, star wipe and cube spin transitions, "deal with it"
sunglasses on the lead, Illuminati triangle, "To be continued" sepia freeze
with its arrow banner, and a `body.meme` restyle of the subtitles to Impact.

### `public/meme.css`

The styles for the above. Only `body.meme` selectors, so the file is inert
when the mode is off.

### `public/index.html`

- `<link>` and `<script>` for the two files.
- Settings: a "🔥 Meme mode" toggle (`prefs.meme`) with an intensity slider
  1–11 (`prefs.memeLevel`, default 11) and a volume slider (`prefs.memeVol`,
  default 0.8) that appear while it is on. Turning it on claims the audio
  like the other sound toggles.
- `?meme=1` on the URL forces it for one load without saving (demo links).
- `MEME.fire(...)` calls at: `startTalk` (talk/user), the playback loop where
  a group of three is built (combo), the order and report branches, the tool
  branch, `oops` (fail), `vanish` (leave), `confetti` (win), `card` (card).
  Each is one line, placed before the existing `prefs.banter` guards so meme
  mode works with the quiet little lines turned off.

Default `prefs` gains `meme: false, memeLevel: 11, memeVol: 0.8`.

## Behaviour by event

| Event | Sound | Visual |
|---|---|---|
| order | airhorn | "DEPLOYING {name}" slam, flare on the target tile, 📨 fly keeps working |
| report | hitmarker + sparkle, sometimes airhorn ×3 | crosshairs on the reporter, "+{n} XP", "GG", "STONKS 📈" |
| talk | none (the voice is the sound) | punch-in zoom, 1–3 loud words slam across the stage, deep-fried pulse at 9+ |
| user | record scratch | "THE HUMAN HAS ENTERED THE CHAT" top/bottom text, 👀 rain |
| combo | wub + crowd ohhh | "WOMBO COMBO" / "OH BABY A TRIPLE", triple flare, cube spin |
| tool | hitmarker (low chance) | "+10" floating by the tile |
| fail | "oh my god" clip, or vine boom then trombone or bruh | screen shake, red flash, "BRUH" / "TASK FAILED SUCCESSFULLY", 💀 |
| leave | yeet whoosh or dramatic sting | tile flung off-screen with "YEET", or sepia "To be continued ➡" freeze |
| win | airhorn ×3, ba-dum-tss, sparkle | emoji rain (🌮 🥤 🔥 💯), lens flares, Illuminati triangle, "MOM GET THE CAMERA", sunglasses on the lead |
| card | sting | star wipe over the title card |
| stalled (ticker) | crickets | "👁👄👁", "this is fine 🔥🐶" |

Intensity scales the chance of each optional extra, the cooldowns, the shake
amplitude and the particle counts. At 11 nearly everything fires every time;
at 1 only the headline effect of each event fires, about one time in four.

## Out of scope

- Meme visuals in the exported video. The exporter draws its own canvas and
  does not see the DOM layer; the sounds are exported. Drawing memes on the
  canvas is a later project.
- Translating memes. The captions are English internet culture with a few
  French ones mixed in when the language is French; they are not translated.

## Testing

`test/meme.test.js` with `node --test` on `MEME_CORE`: word picking (upper
case first, longest first, de-duplicated, capped), the intensity curve ends
(1 is rare, 11 is nearly certain, monotonic), the flash guard (three per
second, then refused, resets after a second), and deterministic picking.
The DOM and audio parts are checked by hand in the browser on the demo
(`?demo=1&play=1&meme=1`).
