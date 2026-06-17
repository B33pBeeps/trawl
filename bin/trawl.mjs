#!/usr/bin/env node
// trawl - one fzf menu of a Claude/Codex chat's urls, paths, commands and plans.
// Enter opens urls, copies everything else. Run it in a terminal, or bind a key
// to `trawl`. (The OS-level popup that works over a running chat is a separate
// tool, `trawl-global`, which runs this one.)
//
//   trawl              menu for the current directory
//   trawl --cwd <dir>  menu for a specific directory
import { menu } from "../src/menu.mjs";

const args = process.argv.slice(2);

if (args[0] === "-h" || args[0] === "--help") {
  process.stdout.write(`trawl - grab urls / paths / commands / plans from your Claude or Codex chat.

  trawl                 menu for the current directory
  trawl --cwd <dir>     menu for a specific directory

In the menu: Enter opens a url / copies a command, plan or path · ctrl-y copies.
alt-u/p/c/l filter by type · alt-a all · type to fuzzy-filter.

To pop this over a running Codex/Claude chat via a global hotkey, install the
separate launcher (trawl-global) and bind your desktop to run it.
`);
  process.exit(0);
}

const i = args.indexOf("--cwd");
const cwd = i !== -1 && args[i + 1] ? args[i + 1] : process.cwd();
menu(cwd);
