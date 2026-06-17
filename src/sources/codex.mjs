// Codex CLI rollout reader.
// ~/.codex/sessions/<Y>/<M>/<D>/rollout-<iso>-<uuid>.jsonl  (append-only JSONL)
// cwd lives in line 1: session_meta.payload.cwd. arguments/input are
// JSON-encoded strings (double-parse).
import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { HOME, dirExists, readJsonl, firstJsonLine, headCwd } from "../util.mjs";
import { urlsFrom, pathsFrom, commandsFromText } from "../extract.mjs";

const EXEC_NAMES = new Set(["exec_command", "shell", "local_shell", "container.exec"]);

// Collect rollout files, newest-first by MTIME (a resumed session keeps an old
// filename datetime but a fresh mtime — sort by mtime so it ranks correctly).
function rolloutFiles(limit = 150) {
  const root = join(HOME, ".codex", "sessions");
  if (!dirExists(root)) return [];
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        try { out.push({ p, mtime: statSync(p).mtimeMs }); } catch { /* ignore */ }
      }
    }
  };
  walk(root);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((x) => x.p);
}

// Up to `n` newest rollout files whose session cwd matches (cheap line-1 probe).
export function codexSessions(cwd, n = 5) {
  const out = [];
  for (const f of rolloutFiles()) {
    const meta = firstJsonLine(f);
    if (meta?.payload?.cwd === cwd) {
      out.push(f);
      if (out.length >= n) break;
    }
  }
  return out;
}

// Newest `n` rollouts across all sessions (for resolving the active chat's cwd).
export function recentCodexSessions(n = 1) {
  return rolloutFiles().slice(0, n).map((f) => ({ file: f, cwd: headCwd(f) || firstJsonLine(f)?.payload?.cwd || HOME }));
}

function parseArgs(s) {
  if (typeof s !== "string") return s && typeof s === "object" ? s : {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function patchFiles(patch, cwd) {
  // "*** Update File: path" / "Add File:" / "Delete File:" headers
  const out = [];
  for (const m of String(patch).matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) {
    const f = m[1].trim();
    for (const p of pathsFrom(f, cwd)) out.push(p);
  }
  return out;
}

export function readCodex(cwd, limit = 5) {
  const files = codexSessions(cwd, limit);
  const cmds = [], paths = [], urls = [], plans = [];
  const ts = (l) => Date.parse(l.timestamp || "") || 0;

  // Skip the heavy lines we never use (command output, encrypted reasoning,
  // token counters) before paying their JSON.parse cost. Match the payload
  // type field precisely so a plan/message mentioning these words isn't dropped.
  const skip = (l) =>
    l.includes('"type":"function_call_output"') ||
    l.includes('"type":"reasoning"') ||
    l.includes('"type":"token_count"');

  for (const file of files) {
    for (const line of readJsonl(file, skip)) {
      const p = line?.payload;
      if (!p) continue;
      const t = ts(line);
      const pt = p.type;

      if (pt === "function_call") {
        // commands the session RAN — mine paths/urls, but don't list the command.
        // (`update_plan` is Codex's to-do checklist, not a plan — intentionally ignored.)
        if (EXEC_NAMES.has(p.name)) {
          const args = parseArgs(p.arguments);
          const cmd = args.cmd || args.command;
          if (cmd) {
            for (const u of urlsFrom(cmd)) urls.push({ type: "url", text: u, agent: "codex", ts: t });
            for (const pp of pathsFrom(cmd, cwd)) paths.push({ type: "path", text: pp.line ? `${pp.file}:${pp.line}` : pp.file, file: pp.file, line: pp.line, agent: "codex", ts: t });
          }
        }
      } else if (pt === "item_completed" && p.item?.type === "Plan" && p.item.text?.trim()) {
        // Codex plan-mode: a finalized PlanItem (the "Implement this plan?" view),
        // distinct from the update_plan todo list. This is the real plan.
        plans.push({ text: p.item.text, ts: t });
      } else if (pt === "custom_tool_call" && p.name === "apply_patch") {
        for (const pp of patchFiles(p.input, cwd)) {
          paths.push({ type: "path", text: pp.line ? `${pp.file}:${pp.line}` : pp.file, file: pp.file, line: pp.line, agent: "codex", ts: t });
        }
      } else if (pt === "message" && Array.isArray(p.content)) {
        for (const b of p.content) {
          for (const u of urlsFrom(b?.text)) urls.push({ type: "url", text: u, agent: "codex", ts: t });
          for (const c of commandsFromText(b?.text)) cmds.push({ type: "cmd", text: c, agent: "codex", ts: t });
        }
      } else if (pt === "agent_message" && typeof p.message === "string") {
        for (const u of urlsFrom(p.message)) urls.push({ type: "url", text: u, agent: "codex", ts: t });
        for (const c of commandsFromText(p.message)) cmds.push({ type: "cmd", text: c, agent: "codex", ts: t });
      }
    }
  }

  return { agent: "codex", session: files[0] || null, cmds, paths, urls, plans: plans.sort((a, b) => b.ts - a.ts) };
}
