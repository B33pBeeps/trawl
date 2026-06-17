// Small shared helpers — no external deps.
import { homedir } from "node:os";
import { readFileSync, existsSync, statSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { join, delimiter } from "node:path";

export const HOME = homedir();

// Locate a binary on PATH without spawning a shell (avoids Node's DEP0190).
export function which(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    const f = join(dir, bin);
    try {
      if (existsSync(f)) return f;
    } catch {
      /* ignore */
    }
  }
  return null;
}

// Read a JSONL file into parsed objects, skipping blank/unparseable lines
// (forward-compatible: a malformed line never aborts the read).
// `skip(rawLine)` lets callers drop heavy lines before the JSON.parse cost.
export function readJsonl(file, skip) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    if (skip && skip(s)) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      /* ignore partial / non-JSON lines */
    }
  }
  return out;
}

// Newest-first list of files matching a predicate under a dir (non-recursive).
export function filesByMtimeDesc(dir, filter = () => true) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(filter)
    .map((n) => join(dir, n))
    .map((p) => {
      try {
        return { path: p, mtime: statSync(p).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .map((x) => x.path);
}

// Parse only the FIRST JSON line of a file (cheap cwd probe for big rollouts).
export function firstJsonLine(file) {
  let fd;
  try {
    fd = openSync(file, "r");
  } catch {
    return null;
  }
  const buf = Buffer.alloc(65536);
  let data = "";
  try {
    let n;
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) {
      data += buf.toString("utf8", 0, n);
      const i = data.indexOf("\n");
      if (i >= 0) {
        data = data.slice(0, i);
        break;
      }
      if (data.length > 1_000_000) break;
    }
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Find the session's recorded cwd by scanning the file head (claude stores it
// top-level per line; codex in session_meta.payload). Cheap: one chunk read.
export function headCwd(file) {
  let fd;
  try {
    fd = openSync(file, "r");
  } catch {
    return null;
  }
  const buf = Buffer.alloc(65536);
  let data = "";
  try {
    const n = readSync(fd, buf, 0, buf.length, null);
    if (n > 0) data = buf.toString("utf8", 0, n);
  } catch {
    /* ignore */
  } finally {
    closeSync(fd);
  }
  const m = data.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

export function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function dirExists(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export { existsSync, join };
