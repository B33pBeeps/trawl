// Text → catches. Regexes ported from the tmux scrollback pickers.
import { isFile, HOME } from "./util.mjs";
import { resolve, isAbsolute } from "node:path";

// URL: http(s)/file scheme, stop at whitespace/quote/bracket/backtick/backslash.
const URL_RE = /(?:https?|file):\/\/[^\s"'<>)\]`\\]+/g;
// path[:line[:col]] — a slash path OR a bare filename.ext, optional line/col.
const PATH_RE =
  /(?:~|\.{0,2}\/)?[A-Za-z0-9_@.\-]*(?:\/[A-Za-z0-9_@.\-]+)+(?::\d+){0,2}|[A-Za-z0-9_@\-]+\.[A-Za-z0-9]{1,8}(?::\d+){0,2}/g;

export function urlsFrom(text) {
  if (!text) return [];
  const out = [];
  for (const m of String(text).matchAll(URL_RE)) {
    out.push(m[0].replace(/[.,;:!?'"`]+$/, ""));
  }
  return out;
}

// Returns {file, line} candidates that exist on disk (resolved against cwd).
export function pathsFrom(text, cwd) {
  if (!text) return [];
  const out = [];
  for (const m of String(text).matchAll(PATH_RE)) {
    let tok = m[0].replace(/[.,;:)>"]+$/, "");
    let line = "";
    const mm = tok.match(/^(.+?):(\d+)(?::\d+)?$/);
    if (mm) {
      tok = mm[1];
      line = mm[2];
    }
    let file = tok.startsWith("~") ? tok.replace(/^~/, HOME) : tok;
    if (!isAbsolute(file)) file = resolve(cwd || process.cwd(), file);
    if (isFile(file)) out.push({ file, line: line || "" });
  }
  return out;
}

// Commands the agent PRESENTED FOR THE USER TO RUN — from its prose, not from
// the tool calls it executed itself. Sources: shell-tagged fenced code blocks
// (```bash/sh/zsh/console…) and any `$ `-prefixed line (in or out of a block).
const SHELL_TAGS = new Set(["sh", "bash", "shell", "zsh", "console", "shellscript", "shell-session"]);

export function commandsFromText(text) {
  if (!text) return [];
  const out = [];
  const src = String(text);
  const fence = /```([\w.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let m;
  const seenSpans = [];
  while ((m = fence.exec(src))) {
    seenSpans.push([m.index, fence.lastIndex]);
    const shellTag = SHELL_TAGS.has(m[1].toLowerCase());
    let cont = "";
    for (const raw of m[2].split("\n")) {
      const dollar = /^\s*\$\s+(.+)$/.exec(raw);
      if (dollar) {
        out.push(dollar[1].trim());
        continue;
      }
      if (!shellTag) continue; // untagged block: only explicit `$ ` lines count
      let line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (cont) {
        line = `${cont} ${line}`;
        cont = "";
      }
      if (line.endsWith("\\")) {
        cont = line.slice(0, -1).trim();
        continue;
      }
      out.push(line);
    }
  }
  // `$ ` lines in prose (outside any fenced block)
  for (const lm of src.matchAll(/^[ \t]*\$[ \t]+(.+)$/gm)) {
    const at = lm.index;
    if (seenSpans.some(([a, b]) => at >= a && at < b)) continue;
    out.push(lm[1].trim());
  }
  return out;
}

// Dedupe an array of catches by their `text`, keeping first (= most recent
// when the input is recency-ordered).
export function dedupe(catches) {
  const seen = new Set();
  const out = [];
  for (const c of catches) {
    if (!c || !c.text) continue;
    const key = c.type + "\0" + c.text;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Flatten newlines so every catch is a single fzf row.
export function flat(s) {
  return String(s).replace(/\s*\n\s*/g, " ").trim();
}
