# Translating Agent Standup

The interface is translated with one small JSON file per language. French and English are written in the code; **every other language is a file in this folder**.

## How it works
- `en.json` lists every English string of the interface (generated, do not edit by hand).
- `xx.json` (for example `zh-TW.json`) maps each **English string** to its translation. A string that is missing falls back to English, so a half-finished translation already works.
- Languages are listed in `public/index.html` (the `LANGS` array: code, name in its own language, HTML `lang`).

## Add or improve a language
1. `npm run i18n:extract` regenerates `en.json` from the code.
2. New language: `node scripts/i18n.js stub fr-CA` creates `public/locales/fr-CA.json` with every key empty. Improving an existing one: just edit its file.
3. Translate the values. Rules:
   - Keep emojis and symbols where they are.
   - Some keys are **fragments** glued to other text at runtime (`"Reading "` + a file name, `"context "` + a number + `" full — compaction soon"`). Keep the same leading and trailing spaces and make the glued result read naturally.
   - Do not translate product names: Agent Standup, Claude, Claude Code, VS Code, FIP, Markdown.
   - Keep labels about as short as the English: they sit in small chips.
4. Add the language to `LANGS` in `public/index.html`.
5. `npm run i18n` checks every file: missing or empty strings, unused keys, lost emojis, changed leading/trailing spaces. It must pass.
6. Set `"reviewed": true` in the file's `_meta` once a native speaker has read it.

## The VS Code side
Command titles and setting descriptions use VS Code's own mechanism: `package.nls.<lang>.json` at the repository root (keys like `command.open.title`). The status bar texts are in `l10n/bundle.l10n.<lang>.json` (the English text is the key; keep `{0}`). The language codes are lowercase there (`zh-tw`, `pt-br`).

## What is *not* translated
The words agents say come from your session (their own language). The built-in demo and the little banter lines (answers to orders, goodbyes) exist in English and French only.
