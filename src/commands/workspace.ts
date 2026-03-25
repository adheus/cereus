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
import { loadSessions, findSession, updateSession, type Session } from "../lib/sessions.js";
import { loadConfig } from "../lib/config.js";
import {
  createSession,
  killSession,
  sessionExists,
  splitPaneAt,
  killPane,
  setPaneTitle,
  isInsideTmux,
  switchClient,
  attachSession,
  getFirstPane,
  listSessionPanes,
} from "../lib/tmux.js";

function generateId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `ws_${slug}`;
}

/**
 * Arrange session agent panes into the workspace tmux session.
 * Only the agent pane is borrowed — editor/terminal sub-panes stay at home.
 */
function mountSessionsIntoWorkspace(
  workspaceTmuxSession: string,
  sessions: Session[],
  workspace: Workspace,
  maxPanes: number,
): void {
  let currentPaneIndex = 0;

  for (const session of sessions) {
    // Skip if already mounted
    if (session.mountedIn === workspace.id) {
      currentPaneIndex++;
      continue;
    }

    // Skip if mounted in another workspace
    if (session.mountedIn) continue;

    // Get the agent pane from the session's home
    const agentPaneId = getFirstPane(session.tmuxSession);
    if (!agentPaneId) continue;

    let targetPaneId: string;

    if (currentPaneIndex === 0) {
      // Use the initial pane of the workspace session
      const existingPanes = listSessionPanes(workspaceTmuxSession);
      if (existingPanes.length === 0) continue;
      targetPaneId = existingPanes[0];
    } else {
      // Create a new pane using smart layout logic
      const wsPanes = listSessionPanes(workspaceTmuxSession);
      const paneCount = wsPanes.length;

      if (paneCount >= maxPanes) {
        // Create a new window within the workspace
        execFileSync(
          "tmux",
          ["new-window", "-t", workspaceTmuxSession, "-c", session.worktreePath],
          { stdio: "ignore" },
        );
        const newPanes = listSessionPanes(workspaceTmuxSession);
        targetPaneId = newPanes[newPanes.length - 1];
      } else {
        let direction: "h" | "v";
        let splitTarget: string;

        switch (paneCount) {
          case 1:
            direction = "h";
            splitTarget = wsPanes[0];
            break;
          case 2:
            direction = "v";
            splitTarget = wsPanes[1];
            break;
          case 3:
            direction = "v";
            splitTarget = wsPanes[0];
            break;
          default:
            direction = "h";
            splitTarget = wsPanes[wsPanes.length - 1];
            break;
        }

        targetPaneId = splitPaneAt(splitTarget, session.worktreePath, direction);
      }
    }

    // Swap the session's agent pane into the workspace layout
    try {
      execFileSync(
        "tmux",
        ["swap-pane", "-s", agentPaneId, "-t", targetPaneId],
        { stdio: "ignore" },
      );
      setPaneTitle(agentPaneId, session.id);
      updateSession(session.id, { mountedIn: workspace.id });
    } catch {
      // If swap fails, skip this session
    }

    currentPaneIndex++;
  }
}

/**
 * Unmount a single session from a workspace — swap its agent pane back home.
 */
function unmountSessionFromWorkspace(
  workspaceTmuxSession: string,
  session: Session,
): void {
  if (!session.mountedIn) return;

  try {
    // Find the session's pane in the workspace by title
    const output = execFileSync(
      "tmux",
      ["list-panes", "-t", workspaceTmuxSession, "-F", "#{pane_id}\t#{pane_title}"],
      { encoding: "utf-8" },
    ).trim();
    const lines = output.split("\n").filter(Boolean);

    for (const line of lines) {
      const [paneId, title] = line.split("\t");
      if (title === session.id && paneId) {
        // The displaced pane from the swap is in the session's home tmux session
        const homePanes = listSessionPanes(session.tmuxSession);
        if (homePanes.length > 0) {
          // Swap back: workspace pane → home
          execFileSync(
            "tmux",
            ["swap-pane", "-s", paneId, "-t", homePanes[0]],
            { stdio: "ignore" },
          );
        }
        // Kill the now-empty pane in the workspace
        killPane(paneId);
        break;
      }
    }
  } catch {
    // ignore
  }

  updateSession(session.id, { mountedIn: undefined });
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

  // Create workspace tmux session if it doesn't exist
  if (!sessionExists(tmuxName)) {
    const cwd = validSessions[0].worktreePath;
    createSession(tmuxName, cwd);
  }

  updateWorkspace(workspace.id, { tmuxSession: tmuxName });

  // Mount sessions into the workspace
  mountSessionsIntoWorkspace(tmuxName, validSessions, workspace, workspace.maxPanes);

  // Switch or attach
  if (isInsideTmux()) {
    console.log(chalk.green("✔"), `Switching to workspace '${name}'...`);
    switchClient(tmuxName);
  } else {
    console.log(chalk.green("✔"), `Attaching to workspace '${name}'...`);
    attachSession(tmuxName);
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

  if (session.mountedIn) {
    console.error(
      chalk.red(`Session '${sessionId}' is mounted in workspace '${session.mountedIn}'. Detach it first.`),
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

  // If workspace is active and session is mounted, unmount first
  const session = findSession(sessionId);
  if (session?.mountedIn === workspace.id && workspace.tmuxSession && sessionExists(workspace.tmuxSession)) {
    unmountSessionFromWorkspace(workspace.tmuxSession, session);
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

  // Unmount all sessions and kill workspace tmux session
  if (workspace.tmuxSession && sessionExists(workspace.tmuxSession)) {
    const allSessions = loadSessions();
    for (const sid of workspace.sessionIds) {
      const session = allSessions.find((s) => s.id === sid);
      if (session?.mountedIn === workspace.id) {
        unmountSessionFromWorkspace(workspace.tmuxSession, session);
      }
    }
    killSession(workspace.tmuxSession);
  } else {
    // Clear mountedIn even if tmux session is gone
    for (const sid of workspace.sessionIds) {
      updateSession(sid, { mountedIn: undefined });
    }
  }

  removeWorkspace(workspace.id);
  console.log(chalk.green("✔"), `Workspace '${name}' deleted.`);
}
