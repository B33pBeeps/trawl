// One menu. Tagged rows, simple type filters. Enter: open urls, copy the rest.
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gather } from "./catches.mjs";
import { flat } from "./extract.mjs";
import { fzfAvailable, runFzf } from "./fzf.mjs";
import { copy } from "./clipboard.mjs";
import { openUrl } from "./open.mjs";

const TAG = {
  url: "\x1b[36m[url] \x1b[0m",
  cmd: "\x1b[32m[cmd] \x1b[0m",
  path: "\x1b[33m[path]\x1b[0m",
  plan: "\x1b[35m[plan]\x1b[0m",
};

function rows(c) {
  const out = [];
  const add = (type, display, payload) =>
    out.push(`${TAG[type]} ${flat(display)}\t${type}\t${flat(payload)}`);
  for (const x of c.cmds) add("cmd", x.text, x.text);
  for (const x of c.paths) add("path", x.text, x.text);
  for (const x of c.urls) add("url", x.text, x.text);
  c.plans.forEach((pl, i) => {
    const title = (pl.text.split("\n").find((l) => l.trim()) || "plan").replace(/^#+\s*/, "");
    add("plan", `(${pl.agent}) ${title}`, String(i)); // payload = plan index
  });
  return out;
}

function act(row, c) {
  const [, type, payload] = row.split("\t");
  if (type === "url") openUrl(payload);
  else if (type === "plan") copy(c.plans[Number(payload)]?.text || "");
  else copy(payload); // cmd, path
}

const quote = (s) => `'${s.replace(/'/g, "'\\''")}'`;

export function menu(cwd = process.cwd()) {
  if (!fzfAvailable()) {
    process.stderr.write("trawl: needs fzf on PATH.\n");
    process.exitCode = 127;
    return;
  }
  const c = gather(cwd);
  const list = rows(c);

  if (list.length === 0) {
    const msg = c.inChat ? "nothing to trawl yet" : "not in a chat";
    runFzf(["--reverse", "--no-info", "--no-preview", "--header", `  ${msg}`, "--prompt", "trawl> "]);
    return;
  }

  const file = join(tmpdir(), `trawl-${process.pid}-${Date.now()}.rows`);
  writeFileSync(file, list.join("\n") + "\n");
  const F = quote(file);
  const args = [
    "--ansi", "--reverse", "--tiebreak=index",
    "--delimiter", "\t", "--with-nth", "1",
    "--pointer", "▸", "--no-preview", "--color", "header:8",
    "--header", "alt-u urls · alt-p paths · alt-c cmds · alt-l plans · alt-a all",
    "--bind", `start:reload:cat ${F}`,
    "--bind", `alt-a:reload:cat ${F}`,
    "--bind", `alt-u:reload:awk -F'\\t' '$2=="url"' ${F}`,
    "--bind", `alt-p:reload:awk -F'\\t' '$2=="path"' ${F}`,
    "--bind", `alt-c:reload:awk -F'\\t' '$2=="cmd"' ${F}`,
    "--bind", `alt-l:reload:awk -F'\\t' '$2=="plan"' ${F}`,
  ];
  try {
    const row = runFzf(args);
    if (row) act(row, c);
  } finally {
    try { unlinkSync(file); } catch { /* ignore */ }
  }
}
