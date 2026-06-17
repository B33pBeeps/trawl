// Aggregate catches across agents for a cwd: merge, recency-sort, dedupe.
import { statSync } from "node:fs";
import { readClaude, recentClaudeSessions } from "./sources/claude.mjs";
import { readCodex, recentCodexSessions } from "./sources/codex.mjs";
import { dedupe } from "./extract.mjs";

const byTsDesc = (a, b) => (b.ts || 0) - (a.ts || 0);

// The cwd of the most recently active chat (Claude or Codex). A desktop hotkey
// can't read the focused terminal's cwd (Wayland blocks it), so trawl-global
// uses this: the session written most recently is the chat you're working in,
// and it follows you when you switch chats.
export function activeCwd() {
  const mt = (f) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
  const cands = [...recentClaudeSessions(1), ...recentCodexSessions(1)]
    .map((s) => ({ cwd: s.cwd, mtime: mt(s.file) }))
    .sort((a, b) => b.mtime - a.mtime);
  return cands[0]?.cwd || null;
}

// Exactly the current directory — no walking up or down.
export function gather(cwd = process.cwd()) {
  const sources = [readClaude(cwd, 3), readCodex(cwd, 3)];
  // newest-first, deduped, capped so 5 merged sessions stay scannable
  const merge = (key, cap) => dedupe(sources.flatMap((s) => s[key]).sort(byTsDesc)).slice(0, cap);
  // plans: Claude ExitPlanMode only (Codex has no structured plan output).
  // Dedupe by title so re-plans of the same thing don't flood the list.
  const titleOf = (t) => (t.split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").trim().toLowerCase();
  const seen = new Set();
  const plans = [];
  for (const p of sources.flatMap((s) => s.plans.map((x) => ({ type: "plan", text: x.text, agent: s.agent, ts: x.ts }))).sort(byTsDesc)) {
    const k = titleOf(p.text);
    if (k && seen.has(k)) continue;
    seen.add(k);
    plans.push(p);
    if (plans.length >= 25) break;
  }

  return {
    cmds: merge("cmds", 60),
    paths: merge("paths", 60),
    urls: merge("urls", 40),
    plans,
    inChat: sources.some((s) => s.session), // is there an agent session for this cwd?
  };
}
