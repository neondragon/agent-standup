#!/usr/bin/env node
// Agent Standup: turns Claude Code session transcripts into a replayable "team call" timeline.
// No dependencies. Run: node server.js  → http://localhost:4747
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const kokoro = require('./kokoro.js');   // natural voices, installed on demand (see kokoro.js)

const PORT = process.env.PORT || 4747;
// Same place Claude Code writes to: honours CLAUDE_CONFIG_DIR (custom config dirs are common on Linux); AGENT_STANDUP_PROJECTS overrides it.
const ROOT = process.env.AGENT_STANDUP_PROJECTS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const PUBLIC = path.join(__dirname, 'public');
// Settings live here, not in the page's localStorage: the server port changes between VS Code windows and reloads, and localStorage is per origin (port included), so the page kept forgetting them.
const PREFS = process.env.AGENT_STANDUP_PREFS || (process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'agent-standup', 'prefs.json') : path.join(os.homedir(), '.config', 'agent-standup', 'prefs.json'));
function readPrefs() { try { const v = JSON.parse(fs.readFileSync(PREFS, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } }
function writePrefs(v) { fs.mkdirSync(path.dirname(PREFS), { recursive: true }); const tmp = PREFS + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, PREFS); }

const blocks = (rec) => {
  const c = rec.message && rec.message.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
};
const clip = (x, n = 700) => String(x == null ? '' : x).slice(0, n);
const HARNESS = /<(system-reminder|browser_instruction|ide_selection|ide_opened_file|task-notification|command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>\s*/g;
// What each tool call looks like on a screen ("d"), plus its id/timestamp so the result can be matched later.
const toolLabel = (b, ts) => {
  const i = b.input || {};
  const arg = i.file_path || i.path || i.pattern || i.command || i.url || i.query || i.description || '';
  const out = { id: b.id, ts, name: b.name, arg: String(arg).slice(0, 90) };
  switch (b.name) {
    case 'Bash': out.d = { kind: 'cmd', text: clip(i.command, 1200), note: clip(i.description, 140) }; break;
    case 'Read': out.d = { kind: 'read', file: i.file_path, offset: i.offset, limit: i.limit }; break;
    case 'Edit': case 'MultiEdit': { const e = i.edits ? i.edits[0] || {} : i; out.d = { kind: 'edit', file: i.file_path, old: clip(e.old_string, 500), new: clip(e.new_string, 500) }; break; }
    case 'Write': out.d = { kind: 'write', file: i.file_path, text: clip(i.content, 800) }; break;
    case 'Grep': out.d = { kind: 'grep', pattern: clip(i.pattern, 100), path: i.path, glob: i.glob }; break;
    case 'Glob': out.d = { kind: 'glob', pattern: clip(i.pattern, 100), path: i.path }; break;
    case 'TodoWrite': out.d = { kind: 'todo', items: (i.todos || []).slice(0, 20).map((x) => ({ c: clip(x.content, 120), s: x.status })) }; break;
    case 'WebFetch': out.d = { kind: 'web', url: i.url }; break;
    case 'WebSearch': out.d = { kind: 'web', query: i.query }; break;
    default: out.d = { kind: 'text', text: clip(JSON.stringify(i), 300) };
  }
  return out;
};
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : '');
const RESULT_MAX = { Read: 1900, Bash: 1300, Grep: 900, Glob: 800, WebFetch: 800, WebSearch: 800, Edit: 200, MultiEdit: 200, Write: 200 };
const NO_RESULT = new Set(['Agent', 'Task', 'SendMessage', 'TodoWrite']);   // internal bookkeeping, nothing to show

function listSessions() {
  const rows = [];
  if (!fs.existsSync(ROOT)) return rows;
  for (const proj of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, proj);
    let files;
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const id = f.replace(/\.jsonl$/, '');
      const st = fs.statSync(path.join(dir, f));
      const subDir = path.join(dir, id, 'subagents');
      const agents = fs.existsSync(subDir) ? fs.readdirSync(subDir).filter((x) => x.endsWith('.jsonl')).length : 0;
      rows.push({ proj, id, mtime: st.mtimeMs, size: st.size, agents });
    }
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  const top = rows.slice(0, 60);
  for (const r of top) {
    // cheap title: last ai-title record, else first user text
    const text = fs.readFileSync(path.join(ROOT, r.proj, r.id + '.jsonl'), 'utf8');
    const m = [...text.matchAll(/"type":"ai-title","aiTitle":"((?:[^"\\]|\\.)*)"/g)].pop();
    r.title = m ? JSON.parse('"' + m[1] + '"') : null;
    if (!r.title) {
      const u = text.match(/"role":"user","content":"((?:[^"\\]|\\.)*)"/);
      r.title = u ? JSON.parse('"' + u[1] + '"').slice(0, 80) : r.id;
    }
    r.project = r.proj.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');
  }
  return top;
}

function stamp(proj, id) {
  const base = path.join(ROOT, proj); let n = 0;
  const add = (f) => { try { const s = fs.statSync(f); n += s.mtimeMs + s.size; } catch {} };
  add(path.join(base, id + '.jsonl'));
  const sd = path.join(base, id, 'subagents');
  if (fs.existsSync(sd)) for (const f of fs.readdirSync(sd)) add(path.join(sd, f));
  return n;
}
const tlCache = new Map();   // "proj/id" → { st (file stamp), tl, at, ms, files[], json?, gz? }
const MAX_CACHED_SESSIONS = 3;
function timelineEntry(proj, id) {
  const key = proj + '/' + id, st = stamp(proj, id), hit = tlCache.get(key), now = Date.now();
  if (hit && hit.st === st && !(hit.recentUntil && now > hit.recentUntil)) return hit;   // a sub-agent's 4-minute silence rule can flip without any file change
  if (hit && now - hit.at < Math.max(250, hit.ms * 2)) return hit;   // very big sessions: don't rebuild on every poll
  const t0 = Date.now(), tl = buildTimeline(proj, id), base = path.join(ROOT, proj), sd = path.join(base, id, 'subagents');
  const files = [path.join(base, id + '.jsonl')]; try { for (const f of fs.readdirSync(sd)) files.push(path.join(sd, f)); } catch {}
  const entry = { st, tl, at: Date.now(), ms: Date.now() - t0, files, recentUntil: tl.recentUntil || 0 };
  tlCache.delete(key); tlCache.set(key, entry);
  while (tlCache.size > MAX_CACHED_SESSIONS) {   // free the memory of sessions nobody is looking at any more
    const [oldKey, old] = tlCache.entries().next().value; tlCache.delete(oldKey);
    for (const f of old.files) fileStates.delete(f);
  }
  return entry;
}
const timeline = (proj, id) => timelineEntry(proj, id).tl;

// ---- Board: one cheap row per recent session (state from the tail of its transcript), so many parallel sessions can be watched at once.
const readTail = (file, bytes) => { const fd = fs.openSync(file, 'r'); try { const sz = fs.fstatSync(fd).size, n = Math.min(bytes, sz), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, sz - n); return { text: buf.toString('utf8'), cut: sz > bytes }; } finally { fs.closeSync(fd); } };
const readHead = (file, bytes) => { const fd = fs.openSync(file, 'r'); try { const n = Math.min(bytes, fs.fstatSync(fd).size), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, 0); return buf.toString('utf8'); } finally { fs.closeSync(fd); } };
const APPROVAL = /^(Edit|Write|MultiEdit|NotebookEdit)/, ASKS = /^(AskUserQuestion|ExitPlanMode)/, SUBTOOL = /^(Task|Agent)$/;
const boardCache = new Map();   // file → { sig, parsed, title }
let boardMemo = { at: 0, rows: [] };
function parseTail(file, st) {
  const sig = st.mtimeMs + ':' + st.size, hit = boardCache.get(file); if (hit && hit.sig === sig) return hit;
  const { text, cut } = readTail(file, 192 * 1024), lines = text.split('\n'); if (cut) lines.shift();
  const pend = new Map(); let lastType = null, lastTool = false, lastTs = 0;
  for (const l of lines) {
    if (!l) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    const t = Date.parse(r.timestamp) || 0, bl = blocks(r);
    if (r.type === 'assistant' || r.type === 'user') { lastType = r.type; lastTool = bl.some((b) => b.type === 'tool_use'); if (t) lastTs = t; }
    for (const b of bl) { if (b.type === 'tool_use') pend.set(b.id, { name: b.name, ts: t }); else if (b.type === 'tool_result') pend.delete(b.tool_use_id); }
  }
  let title = hit && hit.title, tried = hit && hit.tried;
  if (!title && !tried) {
    const big = readTail(file, 256 * 1024).text, m = [...big.matchAll(/"type":"ai-title","aiTitle":"((?:[^"\\]|\\.)*)"/g)].pop();
    if (m) { try { title = JSON.parse('"' + m[1] + '"'); } catch {} }
    if (!title) { const hd = readHead(file, 64 * 1024), u2 = hd.match(/"type":"user"[\s\S]{0,3000}?"type":"text","text":"(?!<)((?:[^"\\]|\\.)*)"/); if (u2) { try { title = JSON.parse('"' + u2[1] + '"').replace(/\s+/g, ' ').slice(0, 90); } catch {} } }
    if (!title) { const u = readHead(file, 64 * 1024).match(/"role":"user","content":"((?:[^"\\]|\\.)*)"/); if (u) { try { title = JSON.parse('"' + u[1] + '"').replace(/\s+/g, ' ').slice(0, 90); } catch {} } }
  }
  const out = { sig, title: title || null, tried: true, lastType, lastTool, lastTs, pending: [...pend.values()] };
  boardCache.set(file, out); if (boardCache.size > 200) boardCache.delete(boardCache.keys().next().value); return out;
}
function boardRows() {
  if (Date.now() - boardMemo.at < 1200) return boardMemo.rows;   // several windows polling at once share one scan
  const out = boardRows0(); boardMemo = { at: Date.now(), rows: out }; return out;
}
function boardRows0() {
  const now = Date.now(), rows = [];
  if (!fs.existsSync(ROOT)) return rows;
  for (const proj of fs.readdirSync(ROOT)) {
    const dir = path.join(ROOT, proj); let files; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) { try { const st = fs.statSync(path.join(dir, f)); if (now - st.mtimeMs < 12 * 3600e3) rows.push({ proj, id: f.slice(0, -6), st }); } catch {} }
  }
  rows.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return rows.slice(0, 40).map(({ proj, id, st }) => {
    const file = path.join(ROOT, proj, id + '.jsonl'); let p; try { p = parseTail(file, st); } catch { p = { pending: [] }; }
    const age = now - st.mtimeMs, lp = (p.pending || [])[(p.pending || []).length - 1]; let state = 'idle', tool = '', ageMs = age;
    if (age < 30 * 60e3) {
      if (lp) { ageMs = now - (lp.ts || st.mtimeMs); tool = lp.name;
        state = SUBTOOL.test(lp.name) ? 'waiting' : (ASKS.test(lp.name) && ageMs > 4000) || (APPROVAL.test(lp.name) && ageMs > 15000) ? 'blocked' : 'working'; }
      else if (p.lastType === 'assistant' && !p.lastTool) state = 'turn';
      else state = age < 10 * 60e3 ? 'working' : 'idle';
    }
    let subActive = 0, subTotal = 0; const sd = path.join(ROOT, proj, id, 'subagents');
    try { for (const x of fs.readdirSync(sd)) if (x.endsWith('.jsonl')) { subTotal++; if (now - fs.statSync(path.join(sd, x)).mtimeMs < 90e3) subActive++; } } catch {}
    return { proj, id, title: p.title || id, mtime: st.mtimeMs, state, tool, ageMs, subActive, subTotal };
  });
}
// Most recently active session (optionally limited to one project dir) — drives the live feed.
// The session a live page follows: the newest one in the project (a workspace folder matches its own sessions and those of
// its subfolders). While the followed session is still active it is kept, so another session writing elsewhere does not
// steal the call mid-line; `stick` is { proj, id } of what the page follows now.
const STICK_MS = 90000;
function sessionMtime(proj, id) {
  try {
    let m = fs.statSync(path.join(ROOT, proj, id + '.jsonl')).mtimeMs; const sd = path.join(ROOT, proj, id, 'subagents');
    if (fs.existsSync(sd)) for (const x of fs.readdirSync(sd)) m = Math.max(m, fs.statSync(path.join(sd, x)).mtimeMs);
    return m;
  } catch { return 0; }
}
function currentSession(projFilter, idFilter, stick) {
  if (stick && stick.id && stick.proj && /^[\w.\-]+$/.test(stick.id) && /^[\w.\-]+$/.test(stick.proj) && Date.now() - sessionMtime(stick.proj, stick.id) < STICK_MS) return { proj: stick.proj, id: stick.id, mtime: sessionMtime(stick.proj, stick.id) };
  if (idFilter && projFilter && projFilter !== '..' && idFilter !== '..' && /^[\w.\-]+$/.test(idFilter) && /^[\w.\-]+$/.test(projFilter) && fs.existsSync(path.join(ROOT, projFilter, idFilter + '.jsonl'))) return { proj: projFilter, id: idFilter, mtime: Date.now() };   // pinned from the board
  let best = null;
  if (!fs.existsSync(ROOT)) return {};
  const consider = (proj, id, m) => { if (!best || m > best.mtime) best = { proj, id, mtime: m }; };
  for (const proj of fs.readdirSync(ROOT)) {
    if (projFilter && proj !== projFilter && !proj.startsWith(projFilter + '-')) continue;   // the folder, or a folder inside it
    const dir = path.join(ROOT, proj); let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const id = f.slice(0, -6); let m = fs.statSync(path.join(dir, f)).mtimeMs;
      const sd = path.join(dir, id, 'subagents');
      if (fs.existsSync(sd)) for (const x of fs.readdirSync(sd)) m = Math.max(m, fs.statSync(path.join(sd, x)).mtimeMs);
      consider(proj, id, m);
    }
  }
  if (!best && projFilter) return currentSession('');
  return best || {};
}

// ---- Incremental transcript reader: each .jsonl is parsed once, then only the bytes appended since are read.
// A session is merged from its main file and one file per sub-agent; the per-file results are cached and re-assembled cheaply.
const fileStates = new Map();   // path → { agent, offset, tail, raw[], toolName{}, msgUsage Map }
function readNew(file, agent) {
  let size; try { size = fs.statSync(file).size; } catch { fileStates.delete(file); return null; }
  let st = fileStates.get(file);
  if (!st || size < st.offset) { st = { agent, offset: 0, tail: Buffer.alloc(0), raw: [], toolName: {}, msgUsage: new Map() }; fileStates.set(file, st); }
  while (size > st.offset) {   // read in chunks of at most 16 MB so a huge transcript never needs one giant buffer
    const fd = fs.openSync(file, 'r'); let buf;
    try { buf = Buffer.alloc(Math.min(16 * 1024 * 1024, size - st.offset)); fs.readSync(fd, buf, 0, buf.length, st.offset); } finally { fs.closeSync(fd); }
    st.offset += buf.length;
    const all = st.tail.length ? Buffer.concat([st.tail, buf]) : buf, cut = all.lastIndexOf(10);   // only complete lines; a half-written last line waits for the next read
    if (cut < 0) { st.tail = all; continue; }
    st.tail = all.subarray(cut + 1);
    for (const line of all.subarray(0, cut).toString('utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (!r || typeof r !== 'object') continue;
      try { parseRecord(st, r); } catch {}   // one odd record must not take the whole timeline down
    }
  }
  return st;
}
function parseRecord(st, r) {
  const agent = st.agent, ts = Date.parse(r.timestamp) || 0;
  if (r.type === 'queue-operation' && typeof r.content === 'string' && r.content.includes('<task-notification>')) {   // how Claude Code reports that a background sub-agent has stopped
    const id = (r.content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/) || [])[1], status = (r.content.match(/<status>([^<]+)<\/status>/) || [])[1];
    if (id && status && status !== 'running') st.raw.push({ ts, agent, kind: 'agentdone', toolId: id });
    return;
  }
  if (r.type === 'user') {
    const items = [];   // tool results: the real output that appeared on the agent's screen
    for (const b of blocks(r)) if (b.type === 'tool_result' && (st.toolName[b.tool_use_id] === 'Agent' || st.toolName[b.tool_use_id] === 'Task') && !(st.bg && st.bg[b.tool_use_id]) && !/^\s*Async agent launched/i.test(resultText(b.content))) st.raw.push({ ts, agent, kind: 'agentdone', toolId: b.tool_use_id });   // a synchronous call: the lead got the sub-agent's answer back, so it has finished (async launches answer immediately and are not a completion)
    for (const b of blocks(r)) if (b.type === 'tool_result' && st.toolName[b.tool_use_id] && !NO_RESULT.has(st.toolName[b.tool_use_id])) {
      const n = st.toolName[b.tool_use_id];
      items.push({ id: b.tool_use_id, err: !!b.is_error, out: clip(resultText(b.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trimEnd(), RESULT_MAX[n] || 600) });
    }
    if (items.length) st.raw.push({ ts, agent, kind: 'results', items });
    if (agent !== 'main') return;   // a sub-agent's first user message is the order, emitted from the parent's side
    // what the human typed, without the blocks the harness wraps around it (reminders, browser/IDE context, command echoes)
    const txt = blocks(r).filter((b) => b.type === 'text').map((b) => b.text).join('\n').replace(HARNESS, '').replace(/^\s*\[Request interrupted[^\]]*\]\s*/i, '').trim();
    if (txt && !/^<(system-reminder|command-|local-command|task-notification)/.test(txt) && !r.isMeta) st.raw.push({ ts, agent: 'user', kind: 'user', text: txt });
  } else if (r.type === 'assistant') {
    const m = r.message || {};
    if (m.id && m.usage) {   // the same message is repeated once per content block with identical numbers: keep one per message id
      const u = m.usage, prev = st.msgUsage.get(m.id);
      st.msgUsage.set(m.id, { ts: prev ? prev.ts : ts, u: { i: u.input_tokens || 0, o: u.output_tokens || 0, r: u.cache_read_input_tokens || 0, w: u.cache_creation_input_tokens || 0 }, model: m.model });
    }
    for (const b of blocks(r)) {
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) st.raw.push({ ts, agent, kind: 'say', text: b.text.trim() });
      else if (b.type === 'tool_use') {
        st.toolName[b.id] = b.name; if (b.input && b.input.run_in_background) (st.bg = st.bg || {})[b.id] = true;
        if (b.name === 'Agent' || b.name === 'Task') st.raw.push({ ts, agent, kind: 'agentcall', toolId: b.id, text: (b.input && b.input.prompt) || '', title: (b.input && b.input.description) || '' });
        else st.raw.push({ ts, agent, kind: 'tool', tool: toolLabel(b, ts) });
      }
    }
  }
}
const metaCache = new Map();   // meta file path → { mtime, value }
function readMeta(f) {
  try { const mt = fs.statSync(f).mtimeMs, c = metaCache.get(f); if (c && c.mtime === mt) return c.value; const v = JSON.parse(fs.readFileSync(f, 'utf8')); metaCache.set(f, { mtime: mt, value: v }); return v; } catch { return {}; }
}

function buildTimeline(proj, id) {
  const base = path.join(ROOT, proj), mainFile = path.join(base, id + '.jsonl');
  if (!fs.existsSync(mainFile)) throw new Error('session not found');
  const agents = { main: { id: 'main', role: 'Lead', type: 'main' } };
  const states = [readNew(mainFile, 'main')];
  const subDir = path.join(base, id, 'subagents');
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir).filter((x) => x.endsWith('.jsonl'))) {
      const aid = f.replace(/^agent-/, '').replace(/\.jsonl$/, ''), m = readMeta(path.join(subDir, f.replace(/\.jsonl$/, '.meta.json')));
      agents[aid] = { id: aid, role: m.description || m.agentType || 'Agent', type: m.agentType || 'agent', toolUseId: m.toolUseId };
      try { agents[aid].mtime = fs.statSync(path.join(subDir, f)).mtimeMs; } catch {}
      const st = readNew(path.join(subDir, f), aid); if (st) states.push(st);
    }
  }
  const childByTool = {};   // Agent tool_use id → the sub-agent it created, so we know who ordered whom
  for (const a of Object.values(agents)) if (a.toolUseId) childByTool[a.toolUseId] = a.id;

  const finished = new Set(), now0 = Date.now(); for (const st of states) if (st) for (const e of st.raw) if (e.kind === 'agentdone' && childByTool[e.toolId]) finished.add(childByTool[e.toolId]);
  let recentUntil = 0; for (const a of Object.values(agents)) if (a.id !== 'main' && a.mtime && now0 - a.mtime <= 240000) recentUntil = Math.max(recentUntil, a.mtime + 241000);
  for (const a of Object.values(agents)) if (a.id !== 'main' && now0 - (a.mtime || 0) > 240000) finished.add(a.id);   // old transcripts without a completion record: silent for 4 min counts as finished
  const events = [], parent = {}, doneSeen = new Set();
  for (const st of states) {
    if (!st) continue;
    let lastSay = -1;   // the last thing a sub-agent says is its report back to the lead
    if (st.agent !== 'main' && finished.has(st.agent)) for (let i = st.raw.length - 1; i >= 0; i--) if (st.raw[i].kind === 'say') { lastSay = i; break; }
    st.raw.forEach((e, i) => {
      if (e.kind === 'agentdone') { const to = childByTool[e.toolId]; if (to && !doneSeen.has(to)) { doneSeen.add(to); events.push({ ts: e.ts, agent: to, kind: 'finish', to: e.agent }); } }
      else if (e.kind === 'agentcall') { const to = childByTool[e.toolId]; if (to) { parent[to] = e.agent; events.push({ ts: e.ts, agent: e.agent, to, kind: 'order', text: e.text, title: e.title }); } }
      else if (i === lastSay) events.push({ ...e, kind: 'report', to: null });   // `to` filled below, once every order is known
      else events.push(e);
    });
    for (const [, mu] of st.msgUsage) events.push({ ts: mu.ts, agent: st.agent, kind: 'usage', u: mu.u, model: mu.model });
  }
  for (const e of events) if (e.kind === 'report' && e.to === null) e.to = parent[e.agent] || 'main';

  events.sort((a, b) => a.ts - b.ts);
  const merged = []; let lastReal = -1;   // consecutive tool calls of one agent become one activity beat; usage events are transparent to that rule
  for (const e of events) {
    const p = lastReal >= 0 ? merged[lastReal] : null;
    if (e.kind === 'usage' || e.kind === 'finish') { merged.push(e); continue; }
    if (e.kind === 'tool' && p && p.kind === 'tools' && p.agent === e.agent) p.tools.push(e.tool);
    else { merged.push(e.kind === 'tool' ? { ts: e.ts, agent: e.agent, kind: 'tools', tools: [e.tool] } : e); lastReal = merged.length - 1; }
  }
  const real = merged.find((e) => e.kind !== 'usage' && e.kind !== 'finish'), first = real ? real.ts : 0, last = merged.length ? merged[merged.length - 1].ts : 0;   // time zero = the first thing said or done
  return { id, proj, agents: Object.values(agents), events: merged.map((e) => ({ ...e, t: Math.max(0, e.ts - first) })), durationMs: last - first, recentUntil };
}

// Ask the local `claude` CLI (uses the user's existing login) to map a JSON array of strings to another array. Cached.
const { spawn } = require('child_process');
const cache = new Map();
// Find a usable `claude` binary: explicit setting → PATH → usual install spots → the one bundled with the VS Code Claude Code extension.
let lastTrError = '', claudeCache = null;
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
function bundledClaude() {
  const home = os.homedir(); let best = null;
  for (const dir of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.vscode-oss']) {
    let names; try { names = fs.readdirSync(path.join(home, dir, 'extensions')); } catch { continue; }
    for (const d of names.filter((x) => x.startsWith('anthropic.claude-code-')))
      for (const n of ['claude', 'claude.exe']) { const f = path.join(home, dir, 'extensions', d, 'resources', 'native-binary', n); if (exists(f) && (!best || d.localeCompare(best.d, undefined, { numeric: true }) > 0)) best = { d, f }; }
  }
  return best && best.f;
}
function findClaude() {
  if (claudeCache && exists(claudeCache)) return claudeCache;
  const home = os.homedir(), win = process.platform === 'win32', names = win ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude'], cands = [];
  if (process.env.AGENT_STANDUP_CLAUDE) cands.push(process.env.AGENT_STANDUP_CLAUDE);
  for (const d of (process.env.PATH || '').split(path.delimiter)) for (const n of names) cands.push(path.join(d, n));
  const dirs = win ? [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude')]
    : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.claude/local'), path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), path.join(home, '.bun/bin'), path.join(home, '.volta/bin')];
  try { const nvm = path.join(home, '.nvm', 'versions', 'node'); for (const v of fs.readdirSync(nvm)) dirs.push(path.join(nvm, v, 'bin')); } catch {}
  for (const d of dirs) for (const n of names) cands.push(path.join(d, n));
  const found = cands.find(exists) || bundledClaude() || null;
  return (claudeCache = found);
}
function spawnClaude(args, opts) {
  const bin = findClaude(); if (!bin) { lastTrError = 'not-found'; return null; }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) return spawn('"' + bin + '"', args, { ...opts, shell: true, windowsHide: true });   // npm's Windows shims need a shell
  return spawn(bin, args, { ...opts, windowsHide: true });
}
let running = 0; const queue = [];
const pump = () => { while (running < 3 && queue.length) { running++; queue.shift()(); } };
const schedule = (fn) => new Promise((res, rej) => { queue.push(() => fn().then(res, rej).finally(() => { running--; pump(); })); pump(); });
// Fast path (~1-2 s instead of ~6 s): if the user has an Anthropic API key in the environment, call the API directly.
async function apiMap(prompt, need) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('no key');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) });
  const j = await r.json(); const out = j.content[0].text, arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
  if (arr.length !== need.length) throw new Error('bad length'); return arr;
}
function claudeMap(kind, instruction, texts) {
  const need = [...new Set(texts.filter((t) => !cache.has(kind + '|' + t)))];
  const done = (ok) => ({ texts: texts.map((t) => cache.get(kind + '|' + t) || t), ok });
  if (!need.length) return Promise.resolve(done(true));
  const prompt = instruction + ' Output ONLY a JSON array of strings, same length and order, no markdown.\n' + JSON.stringify(need);
  return apiMap(prompt, need).then((arr) => { need.forEach((t, i) => cache.set(kind + '|' + t, String(arr[i]))); return done(true); }).catch(() => schedule(() => new Promise((resolve) => {
    const p = spawnClaude(['-p', '--model', 'haiku', '--no-session-persistence'], { cwd: os.tmpdir() }); if (!p) return resolve(done(false));
    let out = ''; const timer = setTimeout(() => p.kill(), 60000);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(done(false)));
    p.on('close', () => {
      clearTimeout(timer);
      let ok = false;
      try {
        const arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
        if (arr.length === need.length) { need.forEach((t, i) => cache.set(kind + '|' + t, String(arr[i]))); ok = true; }
      } catch {}
      resolve(done(ok));
    });
    p.stdin.end(prompt);
  })));
}
const translate = (texts) => translateFast(texts);

// Warm `claude` workers: after a slow first call each translation takes ~2-3 s (a cold `claude -p` costs ~6 s).
const TR_INSTR = 'Translate each string of this JSON array into natural spoken French, as a teammate would say it in a meeting. Keep code identifiers, file paths, library names and numbers unchanged.';
const TR_SYS = 'You are a translation engine. Translate the user message into natural spoken French, as a colleague would say it in a meeting. Keep code identifiers, file paths, library names and numbers unchanged. Reply with ONLY the translation, nothing else.';
class TrWorker {
  constructor() { this.q = []; this.busy = false; this.n = 0; this.p = null; this.cur = null; this.buf = ''; }
  start() {
    const p = spawnClaude(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence', '--system-prompt', TR_SYS], { cwd: os.tmpdir() });
    if (!p) return;
    this.p = p; this.buf = ''; this.n = 0;
    p.stderr.on('data', (d) => { lastTrError = String(d).slice(-300); });
    p.stdout.on('data', (d) => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        try { const m = JSON.parse(l); if (m.type === 'result' && this.cur) { if (m.is_error) lastTrError = String(m.result || '').slice(0, 200); else lastTrError = ''; this.finish(m.is_error ? null : String(m.result || '').trim()); } } catch {}
      }
    });
    const dead = () => { if (this.p !== p) return; this.p = null; this.finish(null); };
    p.on('close', dead); p.on('error', dead);
  }
  finish(res) { const c = this.cur; this.cur = null; this.busy = false; if (c) { clearTimeout(c.timer); c.res(res); } this.pump(); }
  ask(text) { return new Promise((res) => { this.q.push({ text, res }); this.pump(); }); }
  kill() { clearTimeout(this.idle); if (this.p) { const p = this.p; this.p = null; try { p.kill(); } catch {} } }
  pump() {
    if (this.busy || !this.q.length) return;
    if (!this.p || this.n >= 30) { if (this.p) { const old = this.p; this.p = null; old.kill(); } this.start(); if (!this.p) { while (this.q.length) this.q.shift().res(null); return; } }   // restart now and then: the conversation context grows
    clearTimeout(this.idle); this.idle = setTimeout(() => { if (!this.busy && !this.q.length) this.kill(); }, 10 * 60 * 1000);   // free the process when nothing was translated for 10 min
    const job = this.q.shift(); this.busy = true; this.n++; this.cur = job;
    job.timer = setTimeout(() => { if (this.cur === job && this.p) this.p.kill(); }, 45000);
    this.p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: job.text } }) + '\n');
  }
}
const trWorkers = [new TrWorker(), new TrWorker()];
const shutdown = () => { trWorkers.forEach((w) => w.kill()); kokoro.shutdown(); };
process.on('exit', shutdown);
const pickWorker = () => trWorkers.reduce((a, b) => (a.q.length + a.busy <= b.q.length + b.busy ? a : b));
async function translateFast(texts) {
  const need = [...new Set(texts.filter((t) => !cache.has('fr|' + t)))];
  if (need.length && need.length <= 3 && !process.env.ANTHROPIC_API_KEY) {   // a few lines: warm workers in parallel; many lines: one batched call
    await Promise.all(need.map(async (t) => { const r = await pickWorker().ask(t); if (r) cache.set('fr|' + t, r); }));
    return { texts: texts.map((t) => cache.get('fr|' + t) || t), ok: texts.every((t) => cache.has('fr|' + t)) };
  }
  return claudeMap('fr', TR_INSTR, texts);
}
const quips = (texts, lang) => claudeMap('q' + lang, `Each string is a work report from a software agent. For each, write ONE short, deadpan, funny reaction (max 12 words) from a grumpy teammate in a South Park-style cartoon meeting, in ${lang === 'fr' ? 'French' : 'English'}. No emojis.`, texts);

// ---- text-to-speech, generated on the machine and cached as wav:
//      macOS → `say`, Windows → System.Speech (SAPI voices) through PowerShell, Linux → espeak-ng.
let sayVoices = null;
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
function listVoices() {
  if (sayVoices) return sayVoices;
  const voices = [];
  try {
    if (MAC) {
      const out = execFileSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 5000 });
      for (const line of out.split('\n')) { const m = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s+#/); if (m) voices.push({ name: m[1].trim(), locale: m[2] }); }
    } else if (WIN) {
      const out = execFileSync('powershell.exe', [...PS, "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }"], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      for (const line of out.split(/\r?\n/)) { const [name, loc] = line.trim().split('|'); if (name && loc) voices.push({ name, locale: loc.replace('-', '_') }); }
    } else {
      const out = execFileSync('espeak-ng', ['--voices'], { encoding: 'utf8', timeout: 5000 });
      for (const line of out.split('\n').slice(1)) { const c = line.trim().split(/\s+/); if (c[1] && /^(fr|en)/.test(c[1])) voices.push({ name: c[1], locale: c[1].replace('-', '_').replace(/^(\w{2})$/, (m) => m + '_' + m.toUpperCase()) }); }
    }
  } catch {}
  return (sayVoices = { available: voices.length > 0, voices, platform: process.platform });
}
function voicesFor(engine, dtype) {   // the voice list the page asks for: Kokoro when installed and alive, else the system voices
  if (engine === 'kokoro') { if (dtype) kokoro.setDtype(dtype); const st = kokoro.status(); if (st.installed && !st.gaveUp) kokoro.warm(); return { available: st.installed && !st.gaveUp, voices: kokoro.voices(), platform: process.platform, engine: 'kokoro', dtype: st.dtype }; }
  return { ...listVoices(), engine: 'system' };
}
const ttsDir = path.join(os.tmpdir(), 'agent-standup-tts');
const ttsJobs = new Map();
try { for (const f of fs.readdirSync(ttsDir)) { const p = path.join(ttsDir, f); if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.unlinkSync(p); } } catch {}   // drop cached audio older than a day
function synthesize(voice, wpm, text, out, engine) {
  if (engine === 'kokoro') return kokoro.synth(text, voice, kokoro.speedFor(wpm), out);
  return new Promise((resolve, reject) => {
    let p;
    if (MAC) p = spawn('say', ['-v', voice, '-r', String(wpm), '--data-format=LEI16@22050', '-o', out, '--', text]);
    else if (WIN) {
      const rate = Math.max(-6, Math.min(8, Math.round((wpm - 175) / 12)));   // SAPI rate: -10..10
      p = spawn('powershell.exe', [...PS, '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice($env:AS_VOICE); $s.Rate = [int]$env:AS_RATE; $s.SetOutputToWaveFile($env:AS_OUT); $s.Speak($env:AS_TEXT); $s.Dispose()'],
        { env: { ...process.env, AS_VOICE: voice, AS_RATE: String(rate), AS_OUT: out, AS_TEXT: text }, windowsHide: true });
    } else p = spawn('espeak-ng', ['-v', voice, '-s', String(wpm), '-w', out, '--', text]);
    p.on('error', reject); p.on('close', (code) => (code === 0 && fs.existsSync(out) ? resolve() : reject(new Error('tts failed'))));
  });
}
const ttsNorm = (text, rate) => [String(text).slice(0, 2500), Math.max(90, Math.min(360, Math.round(+rate || 180)))];   // 2500: the page's 'full' reading; keeps the GET URL well under Node's 16 KB header limit
const ttsKey = (engine, voice, rate, text) => crypto.createHash('sha1').update([engine, voice, rate, text].join('|')).digest('hex');
function tts(text, voice, rate, engine = 'system') {
  if (engine === 'kokoro') { if (!kokoro.hasVoice(voice)) return Promise.reject(new Error('unknown voice')); }
  else { const vs = listVoices(); if (!vs.available || !vs.voices.some((v) => v.name === voice)) return Promise.reject(new Error('unknown voice')); }
  [text, rate] = ttsNorm(text, rate);
  const key = ttsKey(engine === 'kokoro' ? 'kokoro:' + kokoro.dtype() : engine, voice, rate, text), file = path.join(ttsDir, key + '.wav');
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (ttsJobs.has(key)) return ttsJobs.get(key);
  fs.mkdirSync(ttsDir, { recursive: true });
  const tmp = file + '.part.wav';
  const job = synthesize(voice, rate, text, tmp, engine).then(() => { fs.renameSync(tmp, file); return file; }).finally(() => ttsJobs.delete(key));
  ttsJobs.set(key, job); return job;
}
// Streamed Kokoro: 16-bit PCM frames ([u32 length][samples]) as each sentence is synthesised, so the first words play
// before the rest exists. The whole line still lands in the cache, and a line already cached or in progress is sent whole.
async function ttsStream(text, voice, rate, res) {
  if (!kokoro.hasVoice(voice)) throw new Error('unknown voice');
  [text, rate] = ttsNorm(text, rate);
  const key = ttsKey('kokoro:' + kokoro.dtype(), voice, rate, text), file = path.join(ttsDir, key + '.wav');
  const head = () => res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-sample-rate': '24000', 'cache-control': 'no-store' });
  const frame = (pcm) => { if (res.destroyed) return; const h = Buffer.alloc(4); h.writeUInt32LE(pcm.length, 0); res.write(Buffer.concat([h, pcm])); };
  let job = ttsJobs.get(key);
  if (!job && !fs.existsSync(file)) {
    fs.mkdirSync(ttsDir, { recursive: true }); const tmp = file + '.part.wav'; head();
    job = kokoro.synth(text, voice, kokoro.speedFor(rate), tmp, frame).then(() => { fs.renameSync(tmp, file); return file; }).finally(() => ttsJobs.delete(key));
    ttsJobs.set(key, job); await job; return res.end();
  }
  const f = await (job || Promise.resolve(file)); if (!res.headersSent) head(); frame(fs.readFileSync(f).subarray(44)); res.end();
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
let audioOwner = { id: null, seen: 0 };
function start(port = PORT) {
  return http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // Only the local machine may talk to this server: blocks other websites (cross-site requests) and DNS-rebinding attempts.
  const local = (h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h || '');
  let originOk = true; try { originOk = !req.headers.origin || local(new URL(req.headers.origin).host); } catch { originOk = false; }
  if (!local(req.headers.host) || !originOk) { res.writeHead(403); return res.end('forbidden'); }
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  try {
    if (url.pathname === '/api/translate' && req.method === 'POST') {
      let body = ''; req.on('data', (d) => (body += d));
      return req.on('end', async () => { try { json(await translate(JSON.parse(body).texts || [])); } catch (e) { json({ error: String(e) }, 400); } });
    }
    if (url.pathname === '/api/quips' && req.method === 'POST') {
      let body = ''; req.on('data', (d) => (body += d));
      return req.on('end', async () => { try { const b = JSON.parse(body); json(await quips(b.texts || [], b.lang)); } catch (e) { json({ error: String(e) }, 400); } });
    }
    if (url.pathname === '/api/sessions') return json(listSessions());
    if (url.pathname === '/api/projects') {   // projects (working folders) ordered by latest activity — lets the live view follow one of them
      const m = new Map(); for (const r of listSessions()) { const p = m.get(r.proj) || { proj: r.proj, mtime: 0, sessions: 0 }; p.mtime = Math.max(p.mtime, r.mtime); p.sessions++; m.set(r.proj, p); }
      return json([...m.values()].sort((a, b) => b.mtime - a.mtime));
    }
    if (url.pathname === '/api/audio') {   // only one window at a time plays sound: the last one that claimed it (expires if that window stops answering)
      const cid = url.searchParams.get('cid') || '', ok = /^[\w-]{4,40}$/.test(cid);
      if (ok && url.searchParams.get('claim')) audioOwner = { id: cid, seen: Date.now() };
      else if (ok && audioOwner.id === cid) audioOwner.seen = Date.now();
      if (audioOwner.id && Date.now() - audioOwner.seen > 6000) audioOwner = { id: null, seen: 0 };
      return json({ owner: audioOwner.id });
    }
    if (url.pathname === '/api/prefs.js') { res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' }); return res.end('window.SAVED_PREFS = ' + JSON.stringify(readPrefs()) + ';'); }   // loaded by the page before its own script, so settings are there synchronously
    if (url.pathname === '/api/prefs' && (req.method === 'PUT' || req.method === 'POST')) {
      let body = ''; req.on('data', (d) => (body += d));
      return req.on('end', () => { try { const v = JSON.parse(body); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('prefs must be an object'); writePrefs(v); json({ ok: true }); } catch (e) { json({ error: String(e.message || e) }, 400); } });
    }
    if (url.pathname === '/api/prefs') return json(readPrefs() || {});
    if (url.pathname === '/api/health') return json({ claude: findClaude(), apiKey: !!process.env.ANTHROPIC_API_KEY, trError: lastTrError, platform: process.platform });
    if (url.pathname === '/api/warm') { trWorkers.forEach((w) => { if (!w.p) w.start(); }); return json({ ok: true }); }
    if (url.pathname === '/api/voices') return json(voicesFor(url.searchParams.get('engine') || 'system', url.searchParams.get('dtype')));
    if (url.pathname === '/api/tts') {
      if (url.searchParams.get('stream') && url.searchParams.get('engine') === 'kokoro') {
        return ttsStream(url.searchParams.get('text') || '', url.searchParams.get('voice'), url.searchParams.get('rate'), res)
          .catch((e) => { if (res.headersSent) res.destroy(); else json({ error: String(e.message) }, 400); });
      }
      return tts(url.searchParams.get('text') || '', url.searchParams.get('voice'), url.searchParams.get('rate'), url.searchParams.get('engine') === 'kokoro' ? 'kokoro' : 'system')
        .then((f) => { res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'max-age=86400' }); fs.createReadStream(f).pipe(res); })
        .catch((e) => json({ error: String(e.message) }, 400));
    }
    if (url.pathname === '/api/kokoro') return json(kokoro.status());
    if (url.pathname === '/api/kokoro/install' && req.method === 'POST') return json(kokoro.install());
    if (url.pathname === '/api/current') return json(currentSession(url.searchParams.get('proj') || '', url.searchParams.get('id') || '', { proj: url.searchParams.get('curproj') || '', id: url.searchParams.get('cur') || '' }));
    if (url.pathname === '/api/board') return json(boardRows());
    if (url.pathname === '/api/session') {
      const proj = url.searchParams.get('proj') || '', sid = url.searchParams.get('id') || '', SAFE = /^[\w.\-]+$/;
      if (!SAFE.test(proj) || !SAFE.test(sid) || proj === '..' || sid === '..') { res.writeHead(400); return res.end('bad request'); }
      const entry = proj === '_demo' ? { tl: require('./demo.js')() } : timelineEntry(proj, sid), tl = entry.tl;   // built-in fictional session
      const after = url.searchParams.get('after');
      if (after == null) {   // the whole timeline: serialize once per version, send gzip-compressed when the browser allows it (12 MB → ~1.5 MB)
        const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        if (!entry.json) entry.json = JSON.stringify(tl);
        if (gz && !entry.gz) entry.gz = zlib.gzipSync(entry.json, { level: 5 });
        res.writeHead(200, { 'content-type': 'application/json', ...(gz ? { 'content-encoding': 'gzip' } : {}), vary: 'accept-encoding' });
        return res.end(gz ? entry.gz : entry.json);
      }
      return json({ id: tl.id, agents: tl.agents, total: tl.events.length, events: tl.events.slice(+after) });
    }
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  } catch (e) { json({ error: String(e.message || e) }, 500); }
  }).listen(port, '127.0.0.1', () => console.log(`Agent Standup → http://localhost:${port}`));
}
module.exports = { start, currentSession, shutdown, findClaude, bundledClaude };
if (require.main === module) {
  start().on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (maybe Agent Standup is already running, e.g. inside VS Code). Try: PORT=4790 node server.js` : String(e));
    process.exit(1);
  });
}
