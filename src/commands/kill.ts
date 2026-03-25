import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { findSession, removeSession, loadSessions, saveSessions } from "../lib/sessions.js";
import { killSession, killPane } from "../lib/tmux.js";
import { removeWorktree } from "../lib/git.js";
import { removeContextFile } from "../lib/context.js";
import { stopContainer } from "../lib/container.js";

interface KillOptions {
  all?: boolean;
  clean?: boolean;
  force?: boolean;
}

export async function killCommand(
  identifier: string | undefined,
  options: KillOptions,
): Promise<void> {
  if (options.all) {
    await killAll(options);
    return;
  }

  if (!identifier) {
    console.error(chalk.red("Provide a session identifier or use --all."));
    process.exit(1);
  }

  const session = findSession(identifier);
  if (!session) {
    console.error(chalk.red(`Session '${identifier}' not found.`));
    process.exit(1);
  }

  if (!options.force) {
    const yes = await confirm({
      message: `Kill session '${identifier}'?`,
      default: true,
    });
    if (!yes) return;
  }

  // Kill sub-panes first
  if (session.panes) {
    for (const sub of session.panes) {
      if (sub.type !== "agent") {
        killPane(sub.paneId);
      }
    }
  }

  killSession(session.tmuxSession);
  console.log(chalk.green("✔"), `Tmux session '${identifier}' killed.`);

  if (session.container) {
    console.log(chalk.blue("▸"), "Stopping devcontainer...");
    stopContainer(session.worktreePath);
    console.log(chalk.green("✔"), "Devcontainer stopped.");
  }

  let shouldClean = options.clean;
  if (!shouldClean && !options.force) {
    shouldClean = await confirm({
      message: `Also remove the worktree at ${session.worktreePath}?`,
      default: false,
    });
  }

  if (shouldClean) {
    removeContextFile(session.worktreePath);
    removeWorktree(session.repoPath, session.worktreePath);
    console.log(chalk.green("✔"), "Worktree removed.");
  }

  removeSession(identifier);
  console.log(chalk.green("✔"), `Session '${identifier}' cleaned up.`);
}

async function killAll(options: KillOptions): Promise<void> {
  const sessions = loadSessions();
  if (sessions.length === 0) {
    console.log(chalk.blue("▸"), "No sessions to kill.");
    return;
  }

  if (!options.force) {
    const yes = await confirm({
      message: `Kill all ${sessions.length} session(s)?`,
      default: false,
    });
    if (!yes) return;
  }

  let shouldClean = options.clean;
  if (!shouldClean && !options.force) {
    shouldClean = await confirm({
      message: "Also remove all worktrees?",
      default: false,
    });
  }

  for (const session of sessions) {
    if (session.panes) {
      for (const sub of session.panes) {
        if (sub.type !== "agent") killPane(sub.paneId);
      }
    }
    killSession(session.tmuxSession);
    if (session.container) {
      stopContainer(session.worktreePath);
    }
    if (shouldClean) {
      removeContextFile(session.worktreePath);
      removeWorktree(session.repoPath, session.worktreePath);
    }
    console.log(chalk.green("✔"), `Killed '${session.id}'`);
  }

  saveSessions([]);
  console.log(chalk.green("✔"), "All sessions cleaned up.");
}
