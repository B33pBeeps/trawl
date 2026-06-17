// Thin fzf wrapper. fzf draws on /dev/tty; we feed rows and read the selected
// row from stdout. Returns the selected row string, or null if cancelled.
import { spawnSync } from "node:child_process";
import { which } from "./util.mjs";

export function fzfAvailable() {
  return which("fzf") !== null;
}

export function runFzf(args, input = "") {
  const r = spawnSync("fzf", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
  if (r.status !== 0 && r.status !== 1) return null; // 130 = cancelled
  const row = (r.stdout || "").split("\n").find((l) => l.length > 0);
  return row || null;
}
