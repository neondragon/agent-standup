# Agent Standup

**See who is waiting on whom, and who is blocked — across all your Claude Code sessions — at zero token cost.** Agent Standup turns the session files Claude Code already writes into a live team call (and a board of every session): it only reads local files, it never calls Claude by default.

**Your Claude Code session as a live team call.** The lead gives orders, sub-agents join the call, work at their desks, share their screen and report back — with voices, expressions and a view of the real work as it happens.

**→ Website & download: https://atoll92.github.io/agent-standup/**

![Agent Standup: a team of AI agents in a call](https://atoll92.github.io/agent-standup/media/hero.gif)

_A fictional team fixing a slow login page — the built-in demo (⚙ → Source → Demo). [Watch the full 1-minute video](https://atoll92.github.io/agent-standup/media/demo.mp4)._

[![Buy me a coffee](https://img.shields.io/badge/-Buy%20the%20(replaced)%20dev%20a%20coffee-ffdd00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/bored_dev_and_his_robots)

> Unofficial community project, not affiliated with or endorsed by Anthropic. "Claude" is a trademark of Anthropic.

## What you get

- **Token usage per agent** — a ⚡ counter in the header and on each tile shows how many tokens each agent used (input + output + cache writes; cache reads shown separately in the tooltip), counted once per message as recorded by Claude Code. Handy to see which sub-agent is the expensive one. It is read from the session files, not an estimate of your bill.
- **Stuck or quiet agents** — in the live call, a tile pulses amber with ⏳ when a command has been running for over a minute, shows 💤 when a working agent has gone quiet for 3 minutes, and a red ✗ counter for failed tool calls. The browser tab title shows how many agents are working.
- **Built-in demo** — no session yet? ⚙ → Source → **Demo** plays a fictional team (no data of yours).
- **Live call** — follows your newest Claude Code session in real time. Each agent is a small character at its desk; the one who speaks gets the spotlight and keeps it until someone else talks. Agents that talk back-to-back talk over each other, like a real meeting.
- **Real voices, lip-sync** — lines are spoken aloud; mouths follow the actual volume of the voice.
- **Live screen sharing with the real output** — when an agent works, its screen fills the stage (presenter's camera in the corner, "sharing" badge): a **terminal** with the command history and the actual output of each command, search results and tool calls; or an **editor** with the file it reads (real content and line numbers) or the exact diff it applies. See *What you see for each agent* below.
- **Agents come and go** — a sub-agent joins when it is given a task and leaves the call 2 minutes (playback time) after its report, with a dissolve animation. It comes back if it gets a new task.
- **Sub-agent tree** — the full hierarchy (you → Claude → sub-agents → their sub-agents) with status, tool counts and the current action.
- **Click any agent** — its prompt, tool usage and reports.
- **Replay** — pick any past session, scrub through it, see a timeline of who worked when, and get a **recap** (agents, tool calls, commands, files changed, busiest agents).
- **Video export** — records the call as a 1280×720 `.webm` with voices and subtitles.
- **French or English** — agent text is translated on the fly (see below).
- **Office music** — optional live web radio (FIP and its themed stations) that fades down smoothly while an agent talks and fades back up when the room goes quiet.
- Office ambience, optional (off by default) and fully synthesised: keyboards that type when agents run commands, clicks when they read, a coffee machine, a phone buzzing, a far-away door… (⚙ → Office ambience). Plus small reactions and jokes between agents ("episode mode").

## What you see for each agent

**On its tile**
- **Activity tag** (top right) — what the agent is doing right now: `Reading App.jsx`, `Editing foo.ts`, `Writing …`, `Running npm test` (or the command's own description), `Searching “pattern”`, `Listing **/*.js`, `Fetching host`, `Updating todo list`; then `✓ done` when it reports.
- **Ticker** (bottom) — the current tool call and target, with a spinner and a running counter while it executes, then `✓` / `✗` and its **real duration**.
- Status border: orange while working, spotlight while speaking, the tile fades and dissolves 2 minutes after its report.

**On the shared screen** (appears when an agent uses a tool, stays while a command is still running, then ~4 s after the last action)
- **Terminal** — `❯ command` (with its description), then its **real output** (first lines, errors in red, “… +N lines”), `● Grep(…)` / `● Glob(…)` with matches, a spinner for what is still running. Footer: `✓ Bash · 1.2 s` or `⠋ Bash · running 3.4 s`.
- **Editor** — for `Read`: the file with its real content and line numbers (read-only); for `Edit`: the removed/added lines; for `Write`: the new content, with the tool's result line.
- **Task list** — if the agent keeps a todo list, a side panel shows it live (☐ pending, ◐ in progress, ☑ done).
- The presenter's camera lip-syncs when they speak; the subtitle bar shows what they say.

**Click an agent** — its prompt, tool counts and a **Recent activity** list (last 30 calls with status, duration, and expandable command + output).

Outputs are trimmed (about 1–2 KB each) to keep the call fast. Results of internal calls (sub-agent launches, messages) are not shown.

## Screenshots

| Real commands, real output | The exact change | Who asked whom |
|---|---|---|
| ![terminal](https://atoll92.github.io/agent-standup/media/terminal-output.jpg) | ![editor](https://atoll92.github.io/agent-standup/media/editor-diff.jpg) | ![tree](https://atoll92.github.io/agent-standup/media/tree.jpg) |

| Task list of an agent | End-of-episode recap | In French |
|---|---|---|
| ![todo](https://atoll92.github.io/agent-standup/media/todo.jpg) | ![recap](https://atoll92.github.io/agent-standup/media/recap.jpg) | ![fr](https://atoll92.github.io/agent-standup/media/hero-fr.jpg) |

## Personality, without noise
Sub-agents answer when they get an order ("Running the tests, as usual.", "Grepping like there's no tomorrow."), say goodbye when they leave, and now and then have a little thought; a failing tool call makes the tile shake; confetti when the lead finishes a long job. It is all local (no API), absent from the transcript, and can be turned off in ⚙ → Little lines & animations.

## Agents list
On wide windows (900 px+), a fixed list sits left of the call: every agent with its role and one status line, **most urgent first** (needs you, stalled, working, waiting, done) and the lead pinned on top. It stays readable with dozens of agents, which a grid of tiles does not. Click a name to put that agent in the spotlight (kept for 25 s even when someone else speaks), double-click for details. Toggle it in ⚙ → Agents list.

## All your sessions (Sessions view)
The **Sessions** tab lists every session active in the last 12 hours, across all projects, with one state each: working, needs you?, waiting on sub-agents, your turn, or idle (and how many sub-agents are active). It refreshes every few seconds and reads only the end of each transcript, so thirty parallel sessions stay cheap. Click a card to follow that session in the call.

## At a glance
Every tile carries one status: **working** (with what it is doing), **waiting on another agent** (who), **needs you?** (a file edit or write, or a question, has been pending for 15 s+), **stalled** (waiting on an agent that has been silent for 2 min+), or **done**. A summary sits in the header, and the tab title shows how many agents need you. The "needs you?" signal is a heuristic: Claude Code does not record permission prompts, so commands (Bash) are not flagged because they can legitimately run for minutes (they get a ⏳ badge after 1 min instead). Measured on real sessions, edits that stay pending for 15 s+ are rare, so the signal is mostly right.

## Voices
Four styles in ⚙ (default: **Cartoon voices**, so everything stays understandable):
- **Animal Crossing** — every agent "talks" in gibberish, one blip per letter, with a sentence melody (up for questions, down for statements) and a register of its own.
- **Simlish** — the same idea with flowing syllables, vowels and little consonant noises.
- **Cartoon voices** — the real words read by your system voice, with a character per agent (chipmunk, deep, robot, wobbly, radio, monster, squeaky).
- **Natural voices** — plain system voices.

The two gibberish styles need no system voice and no translation, so they sound the same on macOS, Windows and Linux and in any language; the words stay on screen.

## Handy extras
- **Copy as Markdown** in the recap: a ready-to-paste standup report (who did what, files, tokens, final report of each agent).
- **Notify me when agents finish** (⚙): a soft chime, the tab title and, in VS Code, a notification once the team has worked for a while and gone quiet.
- **Search** the transcript, **ambience volume**, and a compact layout when the panel is narrow (side bar).

## Install (VS Code)

### Option 0 — from the Marketplace (easiest)
In VS Code: Extensions view → search **Agent Standup** → Install. Or: https://marketplace.visualstudio.com/items?itemName=DoubleGeste.agent-standup

### Option A — from a GitHub Release
1. Open the repository's **Releases** page and download `agent-standup-<version>.vsix` (don't send it by email: Gmail and others block `.vsix` files).
2. In VS Code: Extensions view → `…` menu (top right) → **Install from VSIX…** → pick the file.
   Or from a terminal: `code --install-extension agent-standup-<version>.vsix` (macOS: run *Shell Command: Install 'code' command in PATH* first if `code` isn't found).
3. **Developer: Reload Window**, then click the camera icon in the Activity Bar (or run **Agent Standup: Open live call**) and press **Join**.

Direct download of the current version: https://github.com/Atoll92/agent-standup/releases/download/v1.19.2/agent-standup-1.19.2.vsix  
Or with the GitHub CLI: `gh release download --repo Atoll92/agent-standup --pattern "*.vsix"`, then the `code --install-extension` line above.

### Option B — build it yourself
```bash
git clone https://github.com/Atoll92/agent-standup.git
cd agent-standup
npm run package                       # needs Node 18+; produces agent-standup-<version>.vsix
code --install-extension agent-standup-*.vsix
```
To hack on it instead: open the folder in VS Code and press **F5** (launches an Extension Development Host).

### Option C — no extension
`node server.js` and open http://localhost:4747 (see *Standalone* below).

The first click on **Join** is required by browsers to allow sound.

### Commands

| Command | What it does |
|---|---|
| **Agent Standup: Open live call** | Opens the call in a panel beside the editor |
| **Agent Standup: Show sidebar** | Opens the call in the Activity Bar view |
| **Agent Standup: Open in browser (voice + sound)** | Opens the same call in your default browser |

### Settings

| Setting | Default | |
|---|---|---|
| `agentStandup.port` | `0` | Local port of the server. `0` = a free port is picked automatically for each VS Code window (recommended) |
| `agentStandup.claudePath` | _(auto)_ | Full path to the Claude Code executable if it isn't found automatically (needed only for French translation) |
| `agentStandup.autoOpen` | `false` | Open the call when VS Code starts |
| `agentStandup.onlyThisWorkspace` | `true` | Follow only sessions started in the open folder (falls back to the newest session if there is none) |

## Controls

| | |
|---|---|
| **Appel / Call · Arbre / Tree** | tiles or hierarchy |
| **⏸ / ▶** (Space) | pause / resume |
| **☰** | transcript |
| **🔊 / 🔇** (M) | mute everything |
| **⚙** | language · voices · ambience · **office music (station + volume)** · reactions · remove finished agents · **Live ↔ Replay** (and session picker) · recap · export video |
| **T** · **R** · **L** | tree/call · recap · transcript |
| Esc | close recap / menu |

In Replay, a slider and a speed control appear at the bottom, and clicking a transcript line jumps there.

## Office music

Turn on **Office music** in ⚙ and pick a station (FIP, Groove, Jazz, Electro, Reggae, Rock, Nouveautés, Pop) and a volume. The stream is played live from Radio France's public Icecast servers directly in the page; it starts when you press **Join** (browsers require a click). When any agent speaks, the music drops to ~15 % within a fraction of a second and returns slowly after the last line. Muting (🔊 / M) stops the stream. Music is for your ears only: it is **never included in video exports**. Stations are for personal listening; nothing is stored or redistributed.

## One window talks at a time

If several Agent Standup windows are open on the same machine (sidebar, editor panel, browser tab), only the last one where you pressed **Join / Play / 🔊** plays sound; the others stay silent and show 🔈 (click it to take the sound back). This avoids hearing the same call twice, possibly in two languages. A window that stops answering releases the sound after a few seconds.

## Voices

Voices are generated on your machine and played identically in the editor and in the browser:

| OS | Engine | Notes |
|---|---|---|
| macOS | `say` | For nicer voices: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices → download a *Premium* / *Enhanced* voice |
| Windows | installed system voices (SAPI, via PowerShell) | For French: Settings → Time & language → Speech (or Language) → add French |
| Linux | `espeak-ng` | Must be installed |

If no voice is available the agents "mumble" instead. Each agent gets a stable voice from the best ones installed.

### Natural voices (Kokoro)

⚙ → Sound → **Natural voices (Kokoro)** replaces the system voices with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0), a small neural model that runs on your CPU. Eight English characters and one French voice, assigned so each agent sounds different.

Nothing is bundled: the first time, click **Install** in the same box. It runs `npm install kokoro-js` into `~/.cache/agent-standup/kokoro` (`%LOCALAPPDATA%\agent-standup\kokoro` on Windows) and fetches the model from Hugging Face on first use — about 520 MB once, then nothing leaves your machine. Needs `npm` (comes with Node.js). To remove it, delete that folder.

Lines are streamed: the first sentence plays about a second after the line appears while the rest is still being synthesised (long sentences are cut at clause boundaries). The first line after a cold start takes a few seconds more (model load). `AGENT_STANDUP_KOKORO_DTYPE=q4` (set in the environment of VS Code or `node server.js`) picks a faster, larger model (304 MB); `AGENT_STANDUP_KOKORO_DIR` moves the install folder. If Kokoro fails mid-session, the call falls back to the system voices.

**Voice speed** (⚙ → Sound) is a multiplier on every voice, system or Kokoro; the default ×1.15 is a touch brisker than the engines' own pace. Live sessions add another ×1.12 so the call keeps up.

## Translation (French ↔ English)

Agent messages are in the language of the session. With French selected, each line is translated as it arrives using your local `claude` CLI (`claude -p`, Haiku) through two warm background workers: about 3–4 s per line once warm (the very first line takes ~10 s), then spoken. If a translation is not ready in time (7 s live), that line is read in the original language. The menu shows a hint if translation or the French voice is unavailable.

Optional speed-up: set `ANTHROPIC_API_KEY` in the environment of VS Code / the server and translation calls the Anthropic API directly (~1–2 s).

**Privacy & security:** everything runs locally. The server listens on `127.0.0.1` only and rejects requests that do not come from `localhost` (other websites and DNS-rebinding attempts get a 403), so no web page can read your sessions. Translation and jokes send the shortened agent lines to Claude through your own Claude Code login (or your API key if you set one). Natural voices download packages from npm and the model from Hugging Face once, when you click Install, and synthesize locally afterwards. With English selected and music off, nothing leaves your machine. (Office music connects your browser to `icecast.radiofrance.fr` while it is on.)

## Standalone (no VS Code)

```bash
node server.js            # http://localhost:4747   (PORT=… to change)
```

- `http://localhost:4747/` → live, newest session
- `http://localhost:4747/?live=0` → replay picker
- `?proj=<project-dir>` → limit live to one project folder under `~/.claude/projects`

Requires Node 18+.

## How it works

Claude Code writes every session to `~/.claude/projects/<project>/<session>.jsonl`, and each sub-agent to `<session>/subagents/agent-*.jsonl` (with a `.meta.json` linking it to the tool call that created it). Agent Standup merges these into one timeline: orders (the prompt a lead sends to a sub-agent), spoken text, tool calls (with their inputs), the **results** of those calls (matched by tool-call id, with real durations) and final reports. Each file is parsed once and then only the new lines are read, so even a very large session refreshes in a few milliseconds; responses are compressed. The page polls the server every 0.7 s and plays new events.

The website counts visits anonymously (a 1-pixel file hosted on GitHub per channel: no cookies, no third-party tracker); the app itself has no telemetry.

## Troubleshooting

- **Nothing happens / "Waiting for a session"** — start Claude Code in the open folder; with `onlyThisWorkspace` the call follows that folder.
- **Panel is blank** — use **Open in browser**; if you set a fixed `agentStandup.port` it may be taken (use `0`).
- **Two voices at once (e.g. French and English)** — update to ≥ 1.8.1: only one window plays sound now. A line that could not be translated in time is read by an English voice, not by a French voice reading English.
- **No sound** — press **Join** (or Play) once; check 🔊 isn't muted and *Agent voices* is on in ⚙.
- **French is read in English / hint about translation** — Agent Standup looks for Claude Code in your `PATH`, the usual install folders (Homebrew, npm, nvm, `~/.local/bin`, Windows `%APPDATA%\npm`) and the copy bundled with the official VS Code *Claude Code* extension. If none is found the app quietly stays in English; set `agentStandup.claudePath`, or run `claude` once in a terminal to sign in. If VS Code itself was started from inside a Claude Code session, restart it normally.
- **French is read in English** — `claude` CLI not found or not logged in (hint in ⚙); install a French system voice.
- **Characters or backgrounds look empty** — update to ≥ 1.2.1 (fixed a duplicate SVG id bug).
- **Terminal output missing for a command** — the call is still running (spinner), or it is an internal call (sub-agent launch / message); outputs are only recorded once a call finishes.
- **Pill says OFFLINE** — the local server stopped answering (another VS Code window that was serving the port was closed: the extension takes over within a few seconds), or restart `node server.js`.
- **Delay behind the real session** — expected ≈ 5–7 s in French (translation), ≈ 2 s in English; the call skips ahead when it falls too far behind.

## Limits

- Tool outputs are trimmed (about 1–2 KB each); the shared screen shows the beginning of long outputs.
- Output only exists once a tool call has finished: a running command shows a spinner and its live timer, not partial output.
- Voices on macOS/Windows/Linux differ in quality; Windows needs a French voice installed for French.
- Very large sessions (10 MB+ of transcript) take a second or two to load the first time (about 1.9 s for a 12 MB, 168-sub-agent session on a recent Mac); after that updates take milliseconds.
- Video export records in real time and needs a Chromium-based browser/VS Code.

## Support

This dev was replaced by his own agents. If Agent Standup made your sessions more fun, you can [buy him a coffee](https://www.buymeacoffee.com/bored_dev_and_his_robots) ☕ — there is also a ☕ line in the ⚙ menu and at the end of each recap.

## License

MIT

## Support the project / work with me
Agent Standup is free and MIT licensed. If it saves you time you can [buy the (replaced) dev a coffee](https://www.buymeacoffee.com/bored_dev_and_his_robots). I'm also available for work around AI agents and developer tooling: reach me through my GitHub profile, [Atoll92](https://github.com/Atoll92).

## Privacy and usage counting
Agent Standup reads local session files and sends nothing anywhere by default. The only optional network uses are: French translation / jokes (your own Claude login, off unless you turn them on), the FIP radio stream (if you turn it on), the one-time download of natural voices (if you install them), and the **optional usage counter**: if you set `agentStandup.shareUsage` to `true` (off by default, and ignored when VS Code telemetry is off), the extension makes at most one empty request per day to a 1-pixel file in this repository's releases. There is no identifier and no content; GitHub sees your IP like for any download. It lets the maintainer count active installs (`npm run stats`).
