// Clipboard. trawl always runs in a real terminal, so OSC52 (an escape written
// to the tty) is the default: it sets the system clipboard with NO background
// process. wl-copy/xclip fork a daemon that holds the terminal's fds open —
// which keeps a popup window from closing and blocks input after a copy — so
// native tools are only a fallback. TRAWL_CLIP=native forces them.
import { spawnSync } from "node:child_process";
import { openSync, writeSync, closeSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { which } from "./util.mjs";

const have = (bin) => which(bin) !== null;

function isWSL() {
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function nativeCopy(text) {
  const tries = [];
  if (platform() === "darwin") tries.push(["pbcopy", []]);
  else if (isWSL()) tries.push(["clip.exe", []]);
  if (process.env.WAYLAND_DISPLAY) tries.push(["wl-copy", []]);
  tries.push(["xclip", ["-selection", "clipboard"]], ["xsel", ["-ib"]]);

  for (const [bin, args] of tries) {
    if (!have(bin)) continue;
    const r = spawnSync(bin, args, { input: text });
    if (r.status === 0) return true;
  }
  return false;
}

// OSC52: write base64 of the text wrapped in the clipboard escape to the tty.
// Only counts as success if a real tty took it (writing to a non-tty stderr
// would be a no-op the user can't see).
function osc52Copy(text) {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const seq = `\x1b]52;c;${b64}\x07`;
  try {
    const fd = openSync("/dev/tty", "w");
    writeSync(fd, seq);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function copy(text) {
  if (process.env.TRAWL_CLIP === "native") return nativeCopy(text) || osc52Copy(text);
  // OSC52 first (no daemon → popup closes cleanly, input not blocked); fall
  // back to a native tool only if there's no tty to write the escape to.
  return osc52Copy(text) || nativeCopy(text);
}
