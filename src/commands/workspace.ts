import chalk from "chalk";
import { execFileSync } from "node:child_process";
import {
  loadWorkspaces,
  addWorkspace,
  removeWorkspace,
  findWorkspace,
  updateWorkspace,
  attachSessionToWorkspace,
  detachSessionFromWorkspace,
  type Workspace,
} from "../lib/workspaces.js";
import { loadSessions, findSession, type Session } from "../lib/sessions.js";
import { loadConfig } from "../lib/config.js";
import {
  createSession,
  killSession,
  sessionExists,
  paneExists,
  splitPaneAt,
  killPane,
  setPaneTitle,
  setSessionPaneBorderStatus,
  isInsideTmux,
} from "../lib/tmux.js";

function generateId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `ws_${slug}`;
}

function resolveSessionPaneId(session: Session): string | null {
  if (session.tmuxPane && paneExists(session.tmuxPane)) {
    return session.tmuxPane;
  }
  if (session.tmuxSession && sessionExists(session.tmuxSession)) {
    try {
      const output = execFileSync(
        "tmux",
        ["list-panes", "-t", session.tmuxSession, "-F", "#{pane_id}"],
        { encoding: "utf-8" },
      ).trim();
      const panes = output.split("\n").filter(Boolean);
      return panes[0] || null;
    } catch {
      return null;
    }
  }
  return null;
}

function getWorkspacePaneIds(tmuxSessionName: string): string[] {
  try {
    const output = execFileSync(
      "tmux",
      ["list-panes", "-t", tmuxSessionName, "-F", "#{pane_id}"],
      { encoding: "utf-8" },
    ).trim();
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function getWorkspacePaneCount(tmuxSessionName: string): number {
  return getWorkspacePaneIds(tmuxSessionName).length;
}

/**
 * Arrange session panes into the workspace tmux session using swap-pane.
 * Uses a smart layout: progressively fills a grid, then creates new windows.
 */
function arrangeWorkspacePanes(
  workspaceTmuxSession: string,
  sessions: Session[],
  maxPanes: number,
): void {
  const existingPanes = getWorkspacePaneIds(workspaceTmuxSession);
  if (existingPanes.length === 0 || sessions.length === 0) return;

  let currentPaneIndex = 0;

  for (const session of sessions) {
    const sessionPaneId = resolveSessionPaneId(session);
    if (!sessionPaneId) continue;

    let targetPaneId: string;

    if (currentPaneIndex === 0) {
      targetPaneId = existingPanes[0];
    } else {
      const paneCount = getWorkspacePaneCount(workspaceTmuxSession);

      if (paneCount >= maxPanes) {
        execFileSync(
          "tmux",
          ["new-window", "-t", workspaceTmuxSession, "-c", session.worktreePath],
          { stdio: "ignore" },
        );
        const newPanes = getWorkspacePaneIds(workspaceTmuxSession);
        targetPaneId = newPanes[newPanes.length - 1];
      } else {
        const panes = getWorkspacePaneIds(workspaceTmuxSession);
        let direction: "h" | "v";
        let splitTarget: string;

        switch (paneCount) {
          case 1:
            direction = "h";
            splitTarget = panes[0];
            break;
          case 2:
            direction = "v";
            splitTarget = panes[1];
            break;
          case 3:
            direction = "v";
            splitTarget = panes[0];
            break;
          default:
            direction = "h";
            splitTarget = panes[panes.length - 1];
            break;
        }

        targetPaneId = splitPaneAt(splitTarget, session.worktreePath, direction);
      }
    }

    try {
      execFileSync(
        "tmux",
        ["swap-pane", "-s", sessionPaneId, "-t", targetPaneId],
        { stdio: "ignore" },
      );
      setPaneTitle(sessionPaneId, session.id);
    } catch {
      // If swap fails, the target pane stays as-is
    }

    currentPaneIndex++;
  }
}

/**
 * Swap all session panes back from the workspace to their original tmux sessions.
 */
function restoreWorkspacePanes(
  workspaceTmuxSession: string,
  sessions: Session[],
): void {
  for (const session of sessions) {
    const sessionPaneId = resolveSessionPaneId(session);
    if (!sessionPaneId) continue;

    try {
      const output = execFileSync(
        "tmux",
        ["list-panes", "-t", workspaceTmuxSession, "-F", "#{pane_id}\t#{pane_title}"],
        { encoding: "utf-8" },
      ).trim();
      const lines = output.split("\n").filter(Boolean);
      for (const line of lines) {
        const [paneId, title] = line.split("\t");
        if (title === session.id && paneId) {
          const displacedId = resolveSessionPaneId(session);
          if (displacedId && displacedId !== paneId) {
            execFileSync(
              "tmux",
              ["swap-pane", "-s", paneId, "-t", displacedId],
              { stdio: "ignore" },
            );
          }
          break;
        }
      }
    } catch {
      // ignore
    }
  }
}

interface WorkspaceCreateOptions {
  maxPanes?: number;
}

export async function workspaceCreateCommand(
  name: string,
  options: WorkspaceCreateOptions,
): Promise<void> {
  const existing = findWorkspace(name);
  if (existing) {
    console.error(chalk.red(`Workspace '${name}' already exists.`));
    process.exit(1);
  }

  const config = loadConfig();
  const maxPanes = options.maxPanes ?? config.maxPanesPerWindow;

  const workspace: Workspace = {
    id: generateId(name),
    name,
    sessionIds: [],
    maxPanes,
  };

  addWorkspace(workspace);
  console.log(chalk.green("✔"), `Workspace '${name}' created (max ${maxPanes} panes).`);
}

export async function workspaceListCommand(): Promise<void> {
  const workspaces = loadWorkspaces();
  if (workspaces.length === 0) {
    console.log(chalk.blue("▸"), "No workspaces.");
    return;
  }

  for (const ws of workspaces) {
    const sessions = ws.sessionIds.length;
    const active = ws.tmuxSession && sessionExists(ws.tmuxSession) ? chalk.green(" (active)") : "";
    console.log(`  ${chalk.bold(ws.name)} — ${sessions} session(s), max ${ws.maxPanes}${active}`);
  }
}

export async function workspaceShowCommand(name: string): Promise<void> {
  const workspace = findWorkspace(name);
  if (!workspace) {
    console.error(chalk.red(`Workspace '${name}' not found.`));
    process.exit(1);
  }

  const allSessions = loadSessions();
  const validSessions = workspace.sessionIds
    .map((id) => allSessions.find((s) => s.id === id))
    .filter((s): s is Session => !!s && s.status === "running");

  if (validSessions.length === 0) {
    console.error(chalk.yellow("No running sessions in this workspace."));
    process.exit(1);
  }

  const tmuxName = `cr_${workspace.id}`;

  if (sessionExists(tmuxName)) {
    killSession(tmuxName);
  }

  const cwd = validSessions[0].worktreePath;
  createSession(tmuxName, cwd);
  setSessionPaneBorderStatus(tmuxName);
  updateWorkspace(workspace.id, { tmuxSession: tmuxName });

  arrangeWorkspacePanes(tmuxName, validSessions, workspace.maxPanes);

  if (isInsideTmux()) {
    console.log(chalk.green("✔"), `Switching to workspace '${name}'...`);
    execFileSync("tmux", ["switch-client", "-t", tmuxName], {
      stdio: "inherit",
    });
  } else {
    console.log(chalk.green("✔"), `Attaching to workspace '${name}'...`);
    execFileSync("tmux", ["attach-session", "-t", tmuxName], {
      stdio: "inherit",
    });
  }
}

export async function workspaceAttachCommand(
  name: string,
  sessionId: string,
): Promise<void> {
  const workspace = findWorkspace(name);
  if (!workspace) {
    console.error(chalk.red(`Workspace '${name}' not found.`));
    process.exit(1);
  }

  const session = findSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session '${sessionId}' not found.`));
    process.exit(1);
  }

  if (session.status !== "running") {
    console.error(chalk.red(`Session '${sessionId}' is not running.`));
    process.exit(1);
  }

  if (workspace.sessionIds.includes(sessionId)) {
    console.error(chalk.yellow(`Session '${sessionId}' is already in workspace '${name}'.`));
    return;
  }

  if (workspace.sessionIds.length >= workspace.maxPanes) {
    console.error(chalk.red(`Workspace '${name}' is full (${workspace.maxPanes} max panes).`));
    process.exit(1);
  }

  const allWorkspaces = loadWorkspaces();
  const otherWorkspace = allWorkspaces.find(
    (o) => o.id !== workspace.id && o.sessionIds.includes(sessionId),
  );
  if (otherWorkspace) {
    console.error(
      chalk.red(`Session '${sessionId}' is already in workspace '${otherWorkspace.name}'. Detach it first.`),
    );
    process.exit(1);
  }

  attachSessionToWorkspace(workspace.id, sessionId);
  console.log(chalk.green("✔"), `Session '${sessionId}' attached to workspace '${name}'.`);
}

export async function workspaceDetachCommand(
  name: string,
  sessionId: string,
): Promise<void> {
  const workspace = findWorkspace(name);
  if (!workspace) {
    console.error(chalk.red(`Workspace '${name}' not found.`));
    process.exit(1);
  }

  if (!workspace.sessionIds.includes(sessionId)) {
    console.error(chalk.yellow(`Session '${sessionId}' is not in workspace '${name}'.`));
    return;
  }

  detachSessionFromWorkspace(workspace.id, sessionId);
  console.log(chalk.green("✔"), `Session '${sessionId}' detached from workspace '${name}'.`);
}

export async function workspaceDeleteCommand(name: string): Promise<void> {
  const workspace = findWorkspace(name);
  if (!workspace) {
    console.error(chalk.red(`Workspace '${name}' not found.`));
    process.exit(1);
  }

  if (workspace.tmuxSession && sessionExists(workspace.tmuxSession)) {
    const allSessions = loadSessions();
    const validSessions = workspace.sessionIds
      .map((id) => allSessions.find((s) => s.id === id))
      .filter((s): s is Session => !!s);

    restoreWorkspacePanes(workspace.tmuxSession, validSessions);
    killSession(workspace.tmuxSession);
  }

  removeWorkspace(workspace.id);
  console.log(chalk.green("✔"), `Workspace '${name}' deleted.`);
}
