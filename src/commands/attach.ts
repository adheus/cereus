import chalk from "chalk";
import { findSession } from "../lib/sessions.js";
import {
  sessionExists,
  attachSession,
  switchClient,
  isInsideTmux,
} from "../lib/tmux.js";

export function attachCommand(identifier: string): void {
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

  if (isInsideTmux()) {
    switchClient(session.tmuxSession);
  } else {
    attachSession(session.tmuxSession);
  }
}
