// Resolve the cwd of the currently FOCUSED terminal window, cross-platform.
//
// Strategy: ask the environment which window is focused (its PID), then walk
// that window's process tree to the foreground child (the shell or agent) and
// read its cwd. The window PID is usually the terminal emulator, whose own cwd
// is wherever it was launched ($HOME); the real project cwd lives on the
// foreground process inside it.
//
// Focus APIs by environment:
//   Hyprland   hyprctl activewindow -j        (.pid)
//   sway       swaymsg -t get_tree            (focused node .pid)
//   X11        xdotool getactivewindow        (also covers XWayland windows)
//   KDE/KWin   kdotool getactivewindow        (if installed)
//   GNOME Wl   org.gnome.Shell.Extensions.Windows.List  (needs the "Window
//              Calls Extended" extension; GNOME blocks this otherwise)
//   macOS      System Events frontmost process unix id
//   Windows    GetForegroundWindow via PowerShell
// Returns a cwd string, or null if focus can't be determined here.
import { spawnSync } from "node:child_process";
import { readFileSync, readlinkSync, readdirSync } from "node:fs";
import { platform } from "node:os";

function out(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    return r.status === 0 ? (r.stdout || "").trim() : null;
  } catch {
    return null;
  }
}
const num = (s) => (s && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

// ---- Linux: PID -> cwd of the deepest foreground descendant ----
function linuxCwdFromPid(rootPid) {
  let pids;
  try {
    pids = readdirSync("/proc").filter((p) => /^\d+$/.test(p));
  } catch {
    return null;
  }
  const proc = {}, children = {};
  for (const pid of pids) {
    let stat;
    try { stat = readFileSync(`/proc/${pid}/stat`, "utf8"); } catch { continue; }
    const rp = stat.lastIndexOf(")");
    if (rp < 0) continue;
    const f = stat.slice(rp + 2).split(" "); // fields after "(comm) state"
    const ppid = +f[1], ttyNr = +f[4], tpgid = +f[5];
    proc[+pid] = { pid: +pid, ttyNr, tpgid };
    (children[ppid] ||= []).push(+pid);
  }
  const cwdOf = (pid) => { try { return readlinkSync(`/proc/${pid}/cwd`); } catch { return null; } };

  // DFS descendants; prefer the foreground process-group leader on a tty
  // (the program you're actually interacting with), deepest wins.
  let fg = null, fgDepth = -1, deep = null, deepDepth = -1;
  const seen = new Set(), stack = [[rootPid, 0]];
  while (stack.length) {
    const [pid, depth] = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const p = proc[pid];
    if (p) {
      const cwd = cwdOf(pid);
      if (cwd) {
        if (p.ttyNr !== 0 && p.pid === p.tpgid && depth > fgDepth) { fg = cwd; fgDepth = depth; }
        if (depth > deepDepth) { deep = cwd; deepDepth = depth; }
      }
    }
    for (const c of children[pid] || []) stack.push([c, depth + 1]);
  }
  return fg || deep || cwdOf(rootPid);
}

// ---- macOS: PID -> cwd (lsof), walking children ----
function macCwdFromPid(rootPid) {
  const cwdOf = (pid) => {
    const o = out("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    const line = o && o.split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  };
  let best = cwdOf(rootPid), layer = [rootPid];
  for (let i = 0; i < 6 && layer.length; i++) {
    const next = [];
    for (const p of layer) {
      for (const c of (out("pgrep", ["-P", String(p)]) || "").split("\n").filter(Boolean).map(Number)) {
        const cc = cwdOf(c);
        if (cc) best = cc;
        next.push(c);
      }
    }
    layer = next;
  }
  return best;
}

// ---- focused-window PID per environment ----
function hyprlandPid() {
  const j = out("hyprctl", ["activewindow", "-j"]);
  try { return j ? JSON.parse(j).pid || null : null; } catch { return null; }
}
function swayPid() {
  const j = out("swaymsg", ["-t", "get_tree"]);
  if (!j) return null;
  try {
    const find = (n) => {
      if (n.focused && n.pid) return n.pid;
      for (const k of [...(n.nodes || []), ...(n.floating_nodes || [])]) { const r = find(k); if (r) return r; }
      return null;
    };
    return find(JSON.parse(j));
  } catch { return null; }
}
const x11Pid = () => num(out("xdotool", ["getactivewindow", "getwindowpid"]));
const kdePid = () => num(out("kdotool", ["getactivewindow", "getwindowpid"]));
function gnomeExtPid() {
  // "Window Calls Extended" exposes a List of windows incl. focus + pid.
  const j = out("gdbus", ["call", "--session", "--dest", "org.gnome.Shell.Extensions.Windows",
    "--object-path", "/org/gnome/Shell/Extensions/Windows", "--method", "org.gnome.Shell.Extensions.Windows.List"]);
  const m = j && j.match(/'(\[.*\])'/s);
  if (!m) return null;
  try {
    const win = JSON.parse(m[1]).find((w) => w.focus || w.has_focus);
    return win ? win.pid || null : null;
  } catch { return null; }
}
function macPid() {
  return num(out("osascript", ["-e", 'tell application "System Events" to get unix id of first process whose frontmost is true']));
}

export function focusedCwd() {
  const os = platform();
  if (os === "darwin") { const pid = macPid(); return pid ? macCwdFromPid(pid) : null; }
  if (os === "win32") { return null; } // resolved by the PowerShell launcher snippet instead

  let pid = null;
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) pid = hyprlandPid();
  if (!pid && process.env.SWAYSOCK) pid = swayPid();
  if (!pid && process.env.WAYLAND_DISPLAY) pid = kdePid() || gnomeExtPid();
  if (!pid && process.env.DISPLAY) pid = x11Pid(); // X11 or XWayland
  return pid ? linuxCwdFromPid(pid) : null;
}
