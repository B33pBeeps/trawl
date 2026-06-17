// Open a URL in the default browser (detached).
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { readFileSync } from "node:fs";

function isWSL() {
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function opener() {
  if (platform() === "darwin") return "open";
  if (isWSL()) return "explorer.exe";
  return "xdg-open";
}

export function openUrl(url) {
  try {
    const child = spawn(opener(), [url], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
