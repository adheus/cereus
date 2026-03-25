import chalk from "chalk";
import {
  findSession,
  addSubPane,
  removeSubPane,
  type SubPane,
} from "../lib/sessions.js";
import {
  sendKeys,
  killPane,
  paneExists,
  setPaneTitle,
  sessionExists,
  smartSplitAt,
  getFirstPane,
} from "../lib/tmux.js";

interface PaneAddOptions {
  type?: string;
}

export async function paneAddCommand(
  sessionId: string,
  options: PaneAddOptions,
): Promise<void> {
  const session = findSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session '${sessionId}' not found.`));
    process.exit(1);
  }

  if (!sessionExists(session.tmuxSession)) {
    console.error(chalk.red(`Session '${sessionId}' is not running.`));
    process.exit(1);
  }

  const type = (options.type || "terminal") as SubPane["type"];
  if (type !== "editor" && type !== "terminal") {
    console.error(chalk.red("Type must be 'editor' or 'terminal'."));
    process.exit(1);
  }

  if (session.mountedIn) {
    console.log(chalk.yellow(`Note: Agent pane is mounted in workspace '${session.mountedIn}'. Adding pane to home session.`));
  }

  // Always target the session's home tmux session
  const targetPaneId = getFirstPane(session.tmuxSession);
  if (!targetPaneId) {
    console.error(chalk.red("Could not find a live pane for this session."));
    process.exit(1);
  }

  const newPaneId = smartSplitAt(targetPaneId, session.worktreePath);
  const title = `${session.id} [${type}]`;
  setPaneTitle(newPaneId, title);

  if (type === "editor") {
    sendKeys(newPaneId, "nvim .");
  }

  addSubPane(sessionId, { paneId: newPaneId, type });
  console.log(chalk.green("✔"), `Added ${type} pane ${newPaneId} to '${sessionId}'`);
}

export async function paneListCommand(sessionId: string): Promise<void> {
  const session = findSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session '${sessionId}' not found.`));
    process.exit(1);
  }

  const panes = session.panes || [];
  if (panes.length === 0) {
    console.log(chalk.blue("▸"), "No tracked sub-panes.");
    return;
  }

  console.log(chalk.blue(`Sub-panes for '${sessionId}':`));
  for (const p of panes) {
    const alive = paneExists(p.paneId);
    const status = alive ? chalk.green("●") : chalk.red("○");
    console.log(`  ${status} ${p.paneId} [${p.type}]`);
  }
}

export async function paneRemoveCommand(
  sessionId: string,
  paneId: string,
): Promise<void> {
  const session = findSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session '${sessionId}' not found.`));
    process.exit(1);
  }

  const pane = session.panes?.find((p) => p.paneId === paneId);
  if (!pane) {
    console.error(chalk.red(`Pane '${paneId}' not found in session '${sessionId}'.`));
    process.exit(1);
  }

  if (pane.type === "agent") {
    console.error(chalk.red("Cannot remove the agent pane. Use 'cereus kill' to kill the session."));
    process.exit(1);
  }

  killPane(paneId);
  removeSubPane(sessionId, paneId);
  console.log(chalk.green("✔"), `Removed pane ${paneId} from '${sessionId}'.`);
}
