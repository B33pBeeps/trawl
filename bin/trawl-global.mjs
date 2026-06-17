#!/usr/bin/env node
// trawl-global - pop the trawl menu in a floating window over any app, even a
// running Codex/Claude chat. Bind a desktop hotkey to it. It renders in whatever
// terminal you already have open (or any installed one), scoped to your
// most-recently-active chat - a desktop hotkey can't read the focused terminal's
// cwd (Wayland blocks it), so the active chat is the one you're in.
// Override the terminal with TRAWL_TERMINAL (e.g. TRAWL_TERMINAL=foot).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import { homedir } from "node:os";
import { focusedCwd } from "../src/focus.mjs";

// Find a binary on PATH plus the common dirs a minimal hotkey env may miss.
function which(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  const extra = ["/usr/bin", "/usr/local/bin", "/bin", "/snap/bin",
    `${process.env.HOME}/.local/bin`, "/home/linuxbrew/.linuxbrew/bin", "/opt/homebrew/bin"];
  for (const d of [...(process.env.PATH || "").split(delimiter), ...extra]) {
    if (d && existsSync(join(d, bin))) return join(d, bin);
  }
  return null;
}

// Exact process-name match (comm), so we detect a *running* terminal without
// false positives from command lines.
function isRunning(comm) {
  try {
    return spawnSync("pgrep", ["-x", comm], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

// Open the menu for the chat you're in. Run through an INTERACTIVE shell (-i) so
// it inherits the same PATH your terminal has (fzf etc. often live on a PATH set
// in .zshrc/.bashrc, not just .zshenv/.profile).
// Which directory's chat to show. If launched from a terminal, process.cwd() is
// already the project. If launched from a desktop hotkey (cwd is $HOME), ask the
// compositor which terminal is focused and read ITS cwd.
const SHELL = process.env.SHELL || "/bin/bash";
let dir = process.cwd();
if (dir === homedir()) dir = focusedCwd() || dir;
const CWD = dir.replace(/'/g, "'\\''");
const run = [SHELL, "-ic", `exec trawl --cwd '${CWD}'`];

// Any terminal works. comm = the process name to test for "is it running".
const W = 900, H = 520;
const TERMINALS = [
  { bin: "alacritty", comm: "alacritty", build: () => ["alacritty", "--class", "trawl", "-e", ...run] },
  { bin: "foot", comm: "foot", build: () => ["foot", "--app-id=trawl", ...run] },
  { bin: "kitty", comm: "kitty", build: () => ["kitty", "--class", "trawl", "-o", "remember_window_size=no", "-o", `initial_window_width=${W}`, "-o", `initial_window_height=${H}`, ...run] },
  { bin: "ghostty", comm: "ghostty", build: () => ["ghostty", "--class=com.trawl.Popup", "-e", ...run] },
  { bin: "wezterm", comm: "wezterm-gui", build: () => ["wezterm", "start", "--class", "trawl", "--", ...run] },
  { bin: "konsole", comm: "konsole", build: () => ["konsole", "-e", ...run] },
  { bin: "gnome-terminal", comm: "gnome-terminal-", build: () => ["gnome-terminal", "--class=trawl", "--", ...run] },
  { bin: "xterm", comm: "xterm", build: () => ["xterm", "-class", "trawl", "-e", ...run] },
  { bin: "wt", comm: "WindowsTerminal", build: () => ["wt", ...run] },
];

const installed = TERMINALS.filter((t) => which(t.bin));
const override = process.env.TRAWL_TERMINAL;
const chosen =
  (override && installed.find((t) => t.bin === override)) ||
  installed.find((t) => isRunning(t.comm)) || // a terminal you've got open
  installed[0]; // else any installed one

if (!chosen) {
  process.stderr.write("trawl-global: no terminal found. Install one (or set TRAWL_TERMINAL).\n");
  process.exit(1);
}

const argv = chosen.build();
try {
  const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: "ignore" });
  child.unref();
} catch (e) {
  process.stderr.write(`trawl-global: failed to launch terminal: ${e.message}\n`);
  process.exit(1);
}
