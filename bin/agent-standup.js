#!/usr/bin/env node
// Agent Standup from a terminal: the live call in your browser, and one-line status for status bars (Claude Code, tmux, Neovim…).
//   agent-standup [serve] [--port 4747] [--open]   start the local server and (optionally) open the page
//   agent-standup status [--here] [--json]          counts of working / needs you / your turn
//   agent-standup statusline                        same, one short line; reads Claude Code's statusLine JSON on stdin
// Everything reads the local session files Claude Code already writes. Nothing is sent anywhere.
const path = require('path'), { spawn } = require('child_process');
const pkg = require('../package.json');
const argv = process.argv.slice(2), flags = {}, rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], val = () => argv[++i];
  if (a === '--port') flags.port = val(); else if (a === '--projects') flags.projects = val(); else if (a === '--characters') flags.characters = val(); else if (a === '--config-dir') flags.config = val();
  else if (a === '--open') flags.open = true; else if (a === '--here') flags.here = true; else if (a === '--json') flags.json = true; else if (a === '--titles') flags.titles = true;
  else if (a === '-h' || a === '--help') flags.help = true; else if (a === '-v' || a === '--version') flags.version = true; else rest.push(a);
}
const cmd = rest[0] || 'serve';
const HELP = `Agent Standup ${pkg.version} — your Claude Code agents as a live video call

Usage
  agent-standup [serve] [--port 4747] [--open]   start the local server (http://localhost:4747)
  agent-standup status [--here] [--json]          what is going on right now (--here: only the current folder)
  agent-standup statusline                        one short line for a status bar (reads Claude Code's JSON on stdin)

Options
  --port N          port of the local server (default 4747)
  --open            open the page in your browser
  --projects DIR    where the session files are (default ~/.claude/projects, or $CLAUDE_CONFIG_DIR/projects)
  --characters DIR  folder with your own pixel-art characters (default ~/.agent-standup/characters)
  --here            status: only sessions of the current folder
  --json            status: machine-readable output (add --titles to include session titles)
`;
if (flags.help || cmd === 'help') { process.stdout.write(HELP); process.exit(0); }
if (flags.version || cmd === 'version') { console.log(pkg.version); process.exit(0); }
if (flags.projects) process.env.AGENT_STANDUP_PROJECTS = path.resolve(flags.projects);
if (flags.config) process.env.CLAUDE_CONFIG_DIR = path.resolve(flags.config);
if (flags.characters) process.env.AGENT_STANDUP_CHARACTERS = path.resolve(flags.characters);
if (flags.port) process.env.PORT = String(parseInt(flags.port, 10) || 4747);
const server = require('../server.js');
const projKey = (dir) => String(dir || '').replace(/[^a-zA-Z0-9]/g, '-');   // Claude Code's project folder naming

function snapshot(dir) {
  const now = Date.now(), all = server.boardRows(), rows = dir ? all.filter((r) => r.proj === projKey(dir)) : all;
  const act = rows.filter((r) => r.state !== 'idle' || now - r.mtime < 15 * 60e3), n = (st) => act.filter((r) => r.state === st).length;
  return { rows: act, needsYou: n('blocked'), working: n('working') + n('waiting'), yourTurn: n('turn'), idle: rows.length - act.length };
}
const line = (s, short) => { const p = []; if (s.needsYou) p.push(short ? `✋${s.needsYou}` : `✋ ${s.needsYou} needs you`); if (s.working) p.push(short ? `⚙${s.working}` : `⚙ ${s.working} working`); if (!s.needsYou && !s.working && s.yourTurn) p.push(short ? '✓' : '✓ your turn'); return p.join(short ? ' ' : ' · ') || (short ? '' : 'idle'); };

if (cmd === 'status') {
  const s = snapshot(flags.here ? process.cwd() : '');
  if (flags.json) console.log(JSON.stringify({ needsYou: s.needsYou, working: s.working, yourTurn: s.yourTurn, idle: s.idle, sessions: s.rows.map((r) => ({ project: r.proj, id: r.id, state: r.state, tool: r.tool, ageMs: Math.round(r.ageMs), subAgentsActive: r.subActive, subAgents: r.subTotal, ...(flags.titles ? { title: r.title } : {}) })) }, null, 2));
  else console.log(line(s, false));
} else if (cmd === 'statusline') {
  let raw = ''; const go = () => { let dir = ''; try { const j = JSON.parse(raw); dir = (j.workspace && j.workspace.current_dir) || j.cwd || ''; } catch {} console.log(line(snapshot(dir), true)); process.exit(0); };
  if (process.stdin.isTTY) go(); else { process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => (raw += d)); process.stdin.on('end', go); setTimeout(go, 800); }
} else if (cmd === 'serve') {
  const port = +process.env.PORT || 4747, srv = server.start(port);
  srv.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use (Agent Standup may already be running, e.g. inside your editor). Try: agent-standup --port ${port + 1}` : String(e)); process.exit(1); });
  srv.on('listening', () => { if (flags.open) { const url = `http://localhost:${port}/`, opener = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]; try { spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {} } });
  process.on('SIGINT', () => { try { server.shutdown(); } catch {} process.exit(0); });
} else { console.error(`Unknown command "${cmd}".\n\n${HELP}`); process.exit(2); }
