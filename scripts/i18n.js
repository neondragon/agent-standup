// Translation catalogue tooling. The English text is the key (gettext style): public/locales/<code>.json maps each English string to its translation.
//   node scripts/i18n.js extract            → rewrites public/locales/en.json (the template to copy when adding a language)
//   node scripts/i18n.js check [code ...]   → for every locale (or the given ones): missing / unused / empty / placeholder-or-emoji mismatches. Exit code 1 on problems.
//   node scripts/i18n.js stub <code>        → creates public/locales/<code>.json with every key empty, ready to translate
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), dir = path.join(root, 'public/locales'), html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const unesc = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|['"\\nrt])/g, (m, c) => (c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : { n: '\n', r: '\r', t: '\t' }[c] || c));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function keys() {
  const set = new Set(), lit = "'((?:[^'\\\\]|\\\\.)*)'";
  for (const m of html.matchAll(new RegExp('\\bL\\(\\s*' + lit + '\\s*,\\s*' + lit + '\\s*\\)', 'gs'))) set.add(unesc(m[2]));   // L('fr', 'en')
  for (const m of html.matchAll(/data-en="([^"]*)"/g)) set.add(decode(m[1]));                                                    // data-fr / data-en attributes
  const bs = html.match(/const BSTATE = \{([\s\S]*?)\};/);                                                                         // board states: [icon, en, fr]
  if (bs) for (const m of bs[1].matchAll(new RegExp("\\[\\s*'[^']*'\\s*,\\s*" + lit + '\\s*,\\s*' + lit + '\\s*\\]', 'g'))) set.add(unesc(m[1]));
  const vs = html.match(/\[\['kokoro'[\s\S]*?\]\].map/);                                                                         // voice style options: [value, fr, en]
  if (vs) for (const m of vs[0].matchAll(new RegExp("\\[\\s*'[a-z]+'\\s*,\\s*" + lit + '\\s*,\\s*' + lit + '\\s*\\]', 'g'))) set.add(unesc(m[2]));
  return [...set].filter((k) => k.trim() && !k.includes('${')).sort((a, b) => a.localeCompare(b));
}
const tokens = (s) => (s.match(/\$\{[^}]*\}|\{[0-9a-z]+\}|%[sd]/gi) || []).sort().join('|');
const emoji = (s) => (s.match(/\p{Extended_Pictographic}/gu) || []).join('');

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'extract') {
  const ks = keys(); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify(Object.fromEntries(ks.map((k) => [k, k])), null, 1) + '\n');
  console.log(`${ks.length} strings → public/locales/en.json`);
} else if (cmd === 'stub') {
  const code = args[0]; if (!code) { console.error('usage: i18n.js stub <code>'); process.exit(2); }
  const f = path.join(dir, code + '.json'); if (fs.existsSync(f)) { console.error(f + ' already exists'); process.exit(2); }
  fs.writeFileSync(f, JSON.stringify({ _meta: { language: code, reviewed: false }, ...Object.fromEntries(keys().map((k) => [k, ''])) }, null, 1) + '\n'); console.log('created ' + f);
} else if (cmd === 'check') {
  const ks = keys(), files = (args.length ? args.map((c) => c + '.json') : fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json')); let bad = 0;
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { console.log(`${f}: invalid JSON (${e.message})`); bad++; continue; }
    const have = Object.keys(d).filter((k) => k !== '_meta'), missing = ks.filter((k) => !(k in d) || !String(d[k]).trim()), unused = have.filter((k) => !ks.includes(k));
    const mism = ks.filter((k) => d[k] && (tokens(k) !== tokens(d[k]) || emoji(k) !== emoji(d[k])));
    const edge = ks.filter((k) => d[k] && (/^\s/.test(k) !== /^\s/.test(d[k]) || /\s$/.test(k) !== /\s$/.test(d[k])));   // fragments glued to other text keep their leading/trailing space
    console.log(`${f}: ${ks.length - missing.length}/${ks.length} translated${d._meta && d._meta.reviewed === false ? ' (not reviewed by a native speaker)' : ''}`);
    if (missing.length) console.log('  missing: ' + missing.slice(0, 8).map((k) => JSON.stringify(k)).join(', ') + (missing.length > 8 ? ` … +${missing.length - 8}` : ''));
    if (unused.length) console.log('  unused: ' + unused.slice(0, 5).map((k) => JSON.stringify(k)).join(', ') + (unused.length > 5 ? ` … +${unused.length - 5}` : ''));
    if (mism.length) console.log('  emoji/placeholder mismatch: ' + mism.slice(0, 5).map((k) => JSON.stringify(k)).join(', '));
    if (edge.length) console.log('  leading/trailing space differs: ' + edge.slice(0, 5).map((k) => JSON.stringify(k)).join(', '));
    bad += missing.length + unused.length + mism.length + edge.length;
  }
  process.exit(bad ? 1 : 0);
} else { console.log('usage: node scripts/i18n.js extract | check [code...] | stub <code>'); process.exit(2); }
