#!/usr/bin/env node
// trawl-global - open the trawl menu in a floating terminal window, scoped to
// the directory it's launched in. Bind a desktop or terminal global hotkey to
// this so it pops over a running Codex/Claude TUI (the key is caught above the
// app). Needs `trawl` and a terminal on PATH.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";

// Find a binary on PATH, plus the common dirs a minimal hotkey env may miss.
function which(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  const extra = ["/usr/bin", "/usr/local/bin", "/bin", "/snap/bin",
    `${process.env.HOME}/.local/bin`, "/home/linuxbrew/.linuxbrew/bin", "/opt/homebrew/bin"];
  for (const d of [...(process.env.PATH || "").split(delimiter), ...extra]) {
    if (d && existsSync(join(d, bin))) return join(d, bin);
  }
  return null;
}

// Open the menu for the directory trawl-global was launched in. Run through an
// INTERACTIVE shell (-i) so it gets the same PATH your terminal has — a desktop
// hotkey launches with a minimal environment, and tools like fzf often live on a
// PATH set up in .zshrc/.bashrc (interactive), not just .zshenv/.profile (login).
const SHELL = process.env.SHELL || "/bin/bash";
const CWD = process.cwd().replace(/'/g, "'\\''");
const INNER = `exec trawl --cwd '${CWD}'`;
const run = [SHELL, "-ic", INNER];

const W = 900, H = 520; // window size hint where supported
const TERMINALS = [
  ["ghostty", () => ["ghostty", "--class=com.trawl.Popup", "-e", ...run]],
  ["kitty", () => ["kitty", "--class", "trawl", "-o", "remember_window_size=no", "-o", `initial_window_width=${W}`, "-o", `initial_window_height=${H}`, ...run]],
  ["alacritty", () => ["alacritty", "--class", "trawl", "-e", ...run]],
  ["wezterm", () => ["wezterm", "start", "--class", "trawl", "--", ...run]],
  ["foot", () => ["foot", "--app-id=trawl", ...run]],
  ["kgx", () => ["kgx", "--", ...run]],
  ["gnome-terminal", () => ["gnome-terminal", "--class=trawl", "--", ...run]],
  ["wt", () => ["wt", ...run]], // Windows Terminal
];

let argv = null;
for (const [bin, build] of TERMINALS) {
  if (which(bin)) { argv = build(); break; }
}
if (!argv) {
  process.stderr.write("trawl-global: no supported terminal found (kitty, alacritty, foot, ghostty, wezterm, gnome-terminal, wt).\n");
  process.exit(1);
}

try {
  const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: "ignore" });
  child.unref();
} catch (e) {
  process.stderr.write(`trawl-global: failed to launch terminal: ${e.message}\n`);
  process.exit(1);
}
