// Claude Code transcript reader.
// ~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl  (append-only JSONL)
import { join } from "node:path";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { HOME, dirExists, filesByMtimeDesc, readJsonl, isFile, headCwd } from "../util.mjs";
import { urlsFrom, pathsFrom, commandsFromText } from "../extract.mjs";

const PATH_TOOLS = new Set(["Read", "Write", "Edit", "NotebookEdit"]);

// Claude slugs the cwd by replacing /, . and _ with - (lossy, forward-only).
const slugForCwd = (cwd) => cwd.replace(/[/._]/g, "-");

export function claudeSessions(cwd, n = 5) {
  const dir = join(HOME, ".claude", "projects", slugForCwd(cwd));
  if (!dirExists(dir)) return [];
  return filesByMtimeDesc(dir, (name) => name.endsWith(".jsonl")).slice(0, n);
}

// Newest `n` sessions across ALL projects (for the global popup, where there's
// no useful cwd — this surfaces the chat you're actively in). cwd per session
// is read from the transcript's own `cwd` field.
export function recentClaudeSessions(n = 3) {
  const root = join(HOME, ".claude", "projects");
  let dirs;
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
  const all = [];
  for (const d of dirs) {
    const dir = join(root, d.name);
    for (const f of filesByMtimeDesc(dir, (name) => name.endsWith(".jsonl"))) {
      try { all.push({ file: f, mtime: statSync(f).mtimeMs }); } catch { /* ignore */ }
    }
  }
  return all
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, n)
    .map(({ file }) => ({ file, cwd: headCwd(file) || HOME }));
}

// Parse one session file into the accumulator arrays.
function accumClaude(file, cwd, acc) {
  const ts = (l) => Date.parse(l.timestamp || "") || 0;
  for (const line of readJsonl(file)) {
    const t = ts(line);

    // Plan-mode signal: an `attachment` line carries planFilePath when a plan
    // exists — present even if ExitPlanMode wasn't called with an inline plan.
    if (line.type === "attachment") {
      const pf = line.attachment?.planFilePath; // planExists flag can be stale; trust the file
      if (pf && isFile(pf)) {
        try {
          const text = readFileSync(pf, "utf8");
          if (text.trim()) acc.plans.push({ text, ts: t || statSync(pf).mtimeMs });
        } catch { /* ignore */ }
      }
      continue;
    }

    const content = line?.message?.content;
    if (typeof content === "string") {
      for (const u of urlsFrom(content)) acc.urls.push({ type: "url", text: u, agent: "claude", ts: t });
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const b of content) {
      if (b?.type === "text") {
        for (const u of urlsFrom(b.text)) acc.urls.push({ type: "url", text: u, agent: "claude", ts: t });
        for (const c of commandsFromText(b.text)) acc.cmds.push({ type: "cmd", text: c, agent: "claude", ts: t });
      } else if (b?.type === "tool_use") {
        const inp = b.input || {};
        if (b.name === "Bash" && inp.command) {
          for (const u of urlsFrom(inp.command)) acc.urls.push({ type: "url", text: u, agent: "claude", ts: t });
          for (const p of pathsFrom(inp.command, cwd)) acc.paths.push({ type: "path", text: p.line ? `${p.file}:${p.line}` : p.file, file: p.file, line: p.line, agent: "claude", ts: t });
        } else if (PATH_TOOLS.has(b.name) && inp.file_path && isFile(inp.file_path)) {
          acc.paths.push({ type: "path", text: inp.file_path, file: inp.file_path, line: "", agent: "claude", ts: t });
        } else if ((b.name === "WebFetch" || b.name === "WebSearch") && inp.url) {
          for (const u of urlsFrom(inp.url)) acc.urls.push({ type: "url", text: u, agent: "claude", ts: t });
        } else if (b.name === "ExitPlanMode") {
          let text = typeof inp.plan === "string" && inp.plan.trim() ? inp.plan : "";
          if (!text && inp.planFilePath) {
            try { text = readFileSync(inp.planFilePath, "utf8"); } catch { /* ignore */ }
          }
          if (text) acc.plans.push({ text, ts: t });
        }
      }
    }
  }
}

function finish(agent, session, acc) {
  return { agent, session, cmds: acc.cmds, paths: acc.paths, urls: acc.urls, plans: acc.plans.sort((a, b) => b.ts - a.ts) };
}

// newest `limit` sessions for the exact cwd.
export function readClaude(cwd, limit = 3) {
  const sessions = claudeSessions(cwd, limit);
  const acc = { cmds: [], paths: [], urls: [], plans: [] };
  for (const file of sessions) accumClaude(file, cwd, acc);
  return finish("claude", sessions[0] || null, acc);
}
