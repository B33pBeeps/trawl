// Aggregate catches across agents for a cwd: merge, recency-sort, dedupe.
import { readClaude } from "./sources/claude.mjs";
import { readCodex } from "./sources/codex.mjs";
import { dedupe } from "./extract.mjs";

const byTsDesc = (a, b) => (b.ts || 0) - (a.ts || 0);

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
