import chalk from "chalk";
import { findSession } from "../lib/sessions.js";
import {
  sessionExists,
  attachSession,
  switchClient,
  isInsideTmux,
} from "../lib/tmux.js";

interface AttachOptions {
  split?: boolean;
  window?: boolean;
}

export function attachCommand(identifier: string, options: AttachOptions): void {
  const session = findSession(identifier);
  if (!session) {
    console.error(chalk.red(`Session '${identifier}' not found.`));
    console.log("Run 'cereus list' to see available sessions.");
    process.exit(1);
  }

  if (!sessionExists(session.tmuxSession)) {
    console.error(
      chalk.red(`Session '${identifier}' tmux session is not running.`),
    );
    process.exit(1);
  }

  if (options.split) {
    if (!isInsideTmux()) {
      console.error(chalk.red("--split requires running inside a tmux session"));
      process.exit(1);
    }
    const { execFileSync } = require("node:child_process");
    execFileSync(
      "tmux",
      ["join-pane", "-h", "-s", session.tmuxSession],
      { stdio: "inherit" },
    );
    return;
  }

  if (isInsideTmux()) {
    switchClient(session.tmuxSession);
  } else {
    attachSession(session.tmuxSession);
  }
}
