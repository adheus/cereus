import fs from "node:fs";
import path from "node:path";
import {
  loadSessions,
  addSession,
  removeSession,
  addSubPane,
  updateSession,
  type Session,
  type SubPane,
} from "../lib/sessions.js";
import {
  isInsideTmux,
  paneExists,
  sessionExists,
  killPane,
  killSession,
  sendKeys,
  capturePaneOutput,
  setSessionPaneBorderStatus,
  setPaneTitle,
  smartSplitAt,
  switchClient,
  getFirstPane,
  listSessionPanes,
  splitPaneAt,
  getWindowPaneIds,
} from "../lib/tmux.js";
import {
  loadConfig,
  configExists,
  resolveWorkspacePath,
} from "../lib/config.js";
import { resolveRepo } from "../lib/repo.js";
import { createWorktree, isGitRepo, removeWorktree } from "../lib/git.js";
import { writeContextFile, removeContextFile } from "../lib/context.js";
import {
  devcontainerAvailable,
  hasDevcontainerConfig,
  buildContainerAgentCommand,
  stopContainer,
} from "../lib/container.js";
import {
  loadWorkspaces,
  addWorkspace,
  findWorkspace,
  attachSessionToWorkspace,
  detachSessionFromWorkspace,
  removeWorkspace,
  type Workspace,
} from "../lib/workspaces.js";
import { execFileSync } from "node:child_process";

function getCurrentPaneId(): string {
  try {
    return execFileSync("tmux", ["display-message", "-p", "#{pane_id}"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

const VERSION = "0.2.0";

interface RepoGroup {
  repo: string;
  sessions: Session[];
}

// A navigable row is a repo header, session, workspace header, workspace, or workspace member
type NavRow =
  | { type: "repo"; repo: string }
  | { type: "session"; session: Session }
  | { type: "workspace-header" }
  | { type: "workspace"; workspace: Workspace }
  | { type: "workspace-member"; workspace: Workspace; session: Session };

function groupByRepo(sessions: Session[]): RepoGroup[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = map.get(s.repo) || [];
    list.push(s);
    map.set(s.repo, list);
  }
  return Array.from(map.entries()).map(([repo, sessions]) => ({
    repo,
    sessions,
  }));
}

function refreshSessions(): { groups: RepoGroup[]; allSessions: Session[] } {
  const sessions = loadSessions();
  for (const s of sessions) {
    const alive = sessionExists(s.tmuxSession);
    s.status = alive ? "running" : "stopped";
  }
  return { groups: groupByRepo(sessions), allSessions: sessions };
}

/** Build the flat navigable list from groups, respecting collapsed repos */
function buildNavRows(
  groups: RepoGroup[],
  collapsedRepos: Set<string>,
  expandedWorkspaces: Set<string>,
  allSessions: Session[],
): NavRow[] {
  const rows: NavRow[] = [];
  for (const group of groups) {
    rows.push({ type: "repo", repo: group.repo });
    if (!collapsedRepos.has(group.repo)) {
      for (const session of group.sessions) {
        rows.push({ type: "session", session });
      }
    }
  }

  const workspaces = loadWorkspaces();
  if (workspaces.length > 0) {
    rows.push({ type: "workspace-header" });
    for (const ws of workspaces) {
      rows.push({ type: "workspace", workspace: ws });
      if (expandedWorkspaces.has(ws.id)) {
        for (const sid of ws.sessionIds) {
          const session = allSessions.find((s) => s.id === sid);
          if (session) {
            rows.push({ type: "workspace-member", workspace: ws, session });
          }
        }
      }
    }
  }

  return rows;
}

function listWorkspaceRepos(workspacePath: string, maxDepth = 3): string[] {
  const repos: string[] = [];

  function scan(dir: string, depth: number) {
    if (depth >= maxDepth || !fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (isGitRepo(fullPath)) {
        repos.push(entry.name);
      } else {
        scan(fullPath, depth + 1);
      }
    }
  }

  scan(workspacePath, 0);
  return repos.sort();
}

export async function dashboardCommand(): Promise<void> {
  if (!isInsideTmux()) {
    console.error("Dashboard requires running inside a tmux session.");
    process.exit(1);
  }

  const { createCliRenderer, Box, Text } = await import("@opentui/core");
  type KeyEvent = import("@opentui/core").KeyEvent;

  const dashboardPaneId = getCurrentPaneId();

  let selectedIndex = 0;
  const expandedSessions = new Set<string>();
  const collapsedRepos = new Set<string>();
  const expandedWorkspaces = new Set<string>();

  // Active workspace: panes mounted in the dashboard window alongside the dashboard pane
  let activeWorkspaceId: string | null = null;
  const mountedPaneIds: string[] = []; // pane IDs created in the dashboard window for workspace sessions

  // Navigation list (rebuilt on each render)
  let groups: RepoGroup[] = [];
  let allSessions: Session[] = [];
  let navRows: NavRow[] = [];

  // Kill confirmation state
  let killConfirmSessionId: string | null = null;

  // New session creation state
  let newSessionStep: "repo" | "identifier" | null = null;
  let newSessionRepoChoices: { label: string; value: string }[] = [];
  let newSessionRepoIndex = 0;
  let newSessionRepo: string | null = null;
  let newSessionInput = "";
  let newSessionContainer = false;

  // Workspace creation state
  let workspaceStep: "name" | "attach-pick" | null = null;
  let workspaceInput = "";
  let workspaceAttachTarget: Workspace | null = null;
  let workspaceAttachChoices: { label: string; session: Session }[] = [];
  let workspaceAttachIndex = 0;

  // Activity detection state
  const POLL_INTERVAL_MS = 3000;
  const IDLE_THRESHOLD_MS = 10000;
  const activityMap = new Map<string, { lastLine: string; lastChangeTime: number }>();

  function getActivityStatus(session: Session): "active" | "idle" | "stopped" {
    if (session.status !== "running") return "stopped";
    const entry = activityMap.get(session.id);
    if (!entry) return "active";
    return Date.now() - entry.lastChangeTime >= IDLE_THRESHOLD_MS ? "idle" : "active";
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: false,
    enableMouseMovement: false,
  });

  /** Unmount all workspace panes from the dashboard window */
  function unmountWorkspace() {
    if (!activeWorkspaceId) return;

    // Swap agent panes back to their home sessions
    const ws = findWorkspace(activeWorkspaceId);
    if (ws) {
      for (const sid of ws.sessionIds) {
        const session = loadSessions().find((s) => s.id === sid);
        if (session?.mountedIn === ws.id) {
          // Find the session's pane in our window by title
          const windowPanes = getWindowPaneIds(dashboardPaneId);
          for (const pid of windowPanes) {
            if (pid === dashboardPaneId) continue;
            try {
              const title = execFileSync(
                "tmux",
                ["display-message", "-t", pid, "-p", "#{pane_title}"],
                { encoding: "utf-8" },
              ).trim();
              if (title === session.id) {
                // Swap back to session's home
                const homePanes = listSessionPanes(session.tmuxSession);
                if (homePanes.length > 0) {
                  execFileSync(
                    "tmux",
                    ["swap-pane", "-s", pid, "-t", homePanes[0]],
                    { stdio: "ignore" },
                  );
                }
                break;
              }
            } catch { /* ignore */ }
          }
          updateSession(session.id, { mountedIn: undefined });
        }
      }
    }

    // Kill all extra panes in dashboard window (keep only dashboard pane)
    const remainingPanes = getWindowPaneIds(dashboardPaneId);
    for (const pid of remainingPanes) {
      if (pid !== dashboardPaneId) {
        killPane(pid);
      }
    }

    mountedPaneIds.length = 0;
    activeWorkspaceId = null;
  }

  /** Mount workspace sessions as panes next to the dashboard */
  function mountWorkspace(workspace: Workspace) {
    // Unmount any previously active workspace
    unmountWorkspace();

    const sessions = loadSessions();
    const validSessions = workspace.sessionIds
      .map((id) => sessions.find((s) => s.id === id))
      .filter((s): s is Session => !!s && sessionExists(s.tmuxSession));

    if (validSessions.length === 0) return;

    activeWorkspaceId = workspace.id;

    for (const session of validSessions) {
      if (session.mountedIn) continue; // already mounted elsewhere

      const agentPaneId = getFirstPane(session.tmuxSession);
      if (!agentPaneId) continue;

      // Get panes in the dashboard window, excluding the dashboard pane itself
      const windowPanes = getWindowPaneIds(dashboardPaneId);
      const contentPanes = windowPanes.filter((p) => p !== dashboardPaneId);
      const contentCount = contentPanes.length;

      // Create a new pane using smart layout (relative to content panes only)
      let targetPaneId: string;

      if (contentCount === 0) {
        // First content pane: split the dashboard pane horizontally
        targetPaneId = splitPaneAt(dashboardPaneId, session.worktreePath, "h");
      } else {
        // Subsequent panes: smart layout among content panes
        let direction: "h" | "v";
        let splitTarget: string;

        switch (contentCount) {
          case 1:
            direction = "v";
            splitTarget = contentPanes[0];
            break;
          case 2:
            direction = "v";
            splitTarget = contentPanes[0];
            break;
          default:
            direction = "h";
            splitTarget = contentPanes[contentPanes.length - 1];
            break;
        }

        targetPaneId = splitPaneAt(splitTarget, session.worktreePath, direction);
      }

      // Swap agent pane into the new slot
      try {
        execFileSync(
          "tmux",
          ["swap-pane", "-s", agentPaneId, "-t", targetPaneId],
          { stdio: "ignore" },
        );
        // After swap: agentPaneId is now in dashboard window, targetPaneId went to session's home
        setPaneTitle(agentPaneId, session.id);
        mountedPaneIds.push(agentPaneId);
        updateSession(session.id, { mountedIn: workspace.id });
      } catch { /* ignore */ }
    }

    // Focus back on dashboard pane
    try {
      execFileSync("tmux", ["select-pane", "-t", dashboardPaneId]);
    } catch { /* ignore */ }
  }

  function cleanup() {
    unmountWorkspace();
    clearInterval(pollInterval);
    renderer.destroy();
  }

  const CONTAINER_ID = "dashboard-root";

  function render() {
    try {
      renderer.root.remove(CONTAINER_ID);
    } catch { /* first render */ }

    const refreshed = refreshSessions();
    groups = refreshed.groups;
    allSessions = refreshed.allSessions;
    navRows = buildNavRows(groups, collapsedRepos, expandedWorkspaces, allSessions);

    if (selectedIndex >= navRows.length) selectedIndex = navRows.length - 1;
    if (selectedIndex < 0) selectedIndex = 0;

    const children: any[] = [
      Text({ content: "  _  _", fg: "#33aa33" }),
      Text({ content: " | || | _", fg: "#33aa33" }),
      Text({ content: " | || || |   cereus", fg: "#33aa33" }),
      Text({ content: " | || || |-", fg: "#33aa33" }),
      Text({ content: `  \\_  || |   v${VERSION}`, fg: "#33aa33" }),
      Text({ content: "    |  _/", fg: "#33aa33" }),
      Text({ content: "   -| | \\", fg: "#33aa33" }),
      Text({ content: "    |_|-", fg: "#33aa33" }),
      Text({ content: "" }),
    ];

    if (workspaceStep) {
      // --- Workspace creation / attach UI ---
      if (workspaceStep === "name") {
        children.push(Text({ content: " NEW WORKSPACE", fg: "#00ff00" }));
        children.push(Text({ content: "" }));
        children.push(Text({ content: " Workspace name:", fg: "#cccccc" }));
        children.push(
          Text({ content: ` > ${workspaceInput}_`, fg: "#ffffff" }),
        );
        children.push(Box({ flexGrow: 1 }));
        children.push(Text({ content: " Enter confirm", fg: "#555555" }));
        children.push(Text({ content: " Esc cancel", fg: "#555555" }));
      } else if (workspaceStep === "attach-pick") {
        children.push(Text({ content: ` ATTACH TO WORKSPACE '${workspaceAttachTarget?.name}'`, fg: "#00ff00" }));
        children.push(Text({ content: "" }));
        children.push(Text({ content: " Select session:", fg: "#cccccc" }));
        children.push(Text({ content: "" }));
        for (let i = 0; i < workspaceAttachChoices.length; i++) {
          const isSel = i === workspaceAttachIndex;
          children.push(
            Text({
              content: `${isSel ? " ▸" : "  "} ${workspaceAttachChoices[i].label}`,
              fg: isSel ? "#ffffff" : "#888888",
              bg: isSel ? "#333366" : undefined,
            }),
          );
        }
        if (workspaceAttachChoices.length === 0) {
          children.push(Text({ content: "  No available sessions", fg: "#555555" }));
        }
        children.push(Box({ flexGrow: 1 }));
        children.push(Text({ content: " j/k navigate", fg: "#555555" }));
        children.push(Text({ content: " Enter confirm", fg: "#555555" }));
        children.push(Text({ content: " Esc cancel", fg: "#555555" }));
      }
    } else if (newSessionStep) {
      // --- New session creation UI ---
      const sessionTypeLabel = newSessionContainer ? " NEW CONTAINER SESSION" : " NEW SESSION";
      children.push(Text({ content: sessionTypeLabel, fg: "#00ff00" }));
      children.push(Text({ content: "" }));

      if (newSessionStep === "repo") {
        children.push(Text({ content: " Select repo:", fg: "#cccccc" }));
        children.push(Text({ content: "" }));
        for (let i = 0; i < newSessionRepoChoices.length; i++) {
          const isSel = i === newSessionRepoIndex;
          children.push(
            Text({
              content: `${isSel ? " ▸" : "  "} ${newSessionRepoChoices[i].label}`,
              fg: isSel ? "#ffffff" : "#888888",
              bg: isSel ? "#333366" : undefined,
            }),
          );
        }
      } else if (newSessionStep === "identifier") {
        children.push(
          Text({ content: ` Repo: ${newSessionRepo}`, fg: "#ffaa00" }),
        );
        children.push(Text({ content: "" }));
        children.push(Text({ content: " Session name:", fg: "#cccccc" }));
        children.push(
          Text({ content: ` > ${newSessionInput}_`, fg: "#ffffff" }),
        );
      }

      children.push(Box({ flexGrow: 1 }));
      children.push(Text({ content: " j/k navigate", fg: "#555555" }));
      children.push(Text({ content: " Enter confirm", fg: "#555555" }));
      children.push(Text({ content: " Esc cancel", fg: "#555555" }));
    } else {
      // --- Session list ---
      children.push(Text({ content: " SESSIONS", fg: "#8888ff" }));
      children.push(Text({ content: "" }));

      if (navRows.length === 0) {
        children.push(Text({ content: " No sessions", fg: "#555555" }));
        children.push(Text({ content: " Press n to create", fg: "#555555" }));
      } else {
        for (let i = 0; i < navRows.length; i++) {
          const row = navRows[i];
          const isSelected = i === selectedIndex;

          if (row.type === "repo") {
            const isCollapsed = collapsedRepos.has(row.repo);
            const arrow = isCollapsed ? "▸" : "▾";
            children.push(
              Text({
                content: `${isSelected ? " " : " "}${arrow} ${row.repo}`,
                fg: isSelected ? "#ffffff" : "#ffaa00",
                bg: isSelected ? "#333366" : undefined,
              }),
            );
          } else if (row.type === "session") {
            const session = row.session;
            const isExpanded = expandedSessions.has(session.id);
            const activity = getActivityStatus(session);
            const statusColor =
              activity === "idle" ? "#e0e040" : session.status === "running" ? "#00ff00" : "#ff4444";
            const statusIcon = activity === "idle" ? "◆" : "●";
            const label = activity === "idle" ? `${session.id} Zz` : session.id;
            const arrow = isExpanded ? "▾" : "▸";

            children.push(
              Text({
                content: `  ${isSelected ? arrow : " "} ${statusIcon} ${label}`,
                fg: isSelected ? "#ffffff" : statusColor,
                bg: isSelected ? "#333366" : undefined,
              }),
            );

            if (isExpanded) {
              const dim = "#888888";
              const statusLabel = activity === "idle" ? "idle" : session.status;
              children.push(
                Text({ content: `       Status:    ${statusLabel}`, fg: statusColor }),
              );
              children.push(
                Text({ content: `       Branch:    ${session.branch}`, fg: dim }),
              );
              children.push(
                Text({ content: `       Agent:     ${session.agent}`, fg: dim }),
              );
              children.push(
                Text({ content: `       Mode:      ${session.mode}`, fg: dim }),
              );
              if (session.container) {
                children.push(
                  Text({ content: `       Container: yes`, fg: "#00aaff" }),
                );
              }
              if (session.mountedIn) {
                children.push(
                  Text({ content: `       Mounted:   ${session.mountedIn}`, fg: "#aa88ff" }),
                );
              }
              children.push(
                Text({ content: `       Worktree:  ${session.worktreePath}`, fg: "#666666" }),
              );
              if (session.prompt) {
                children.push(
                  Text({ content: `       Prompt:    ${session.prompt}`, fg: dim }),
                );
              }
              if (session.panes && session.panes.length > 0) {
                children.push(
                  Text({ content: `       Panes:`, fg: dim }),
                );
                for (const p of session.panes) {
                  const alive = paneExists(p.paneId);
                  const icon = alive ? "●" : "○";
                  const color = alive ? "#00ff00" : "#ff4444";
                  children.push(
                    Text({
                      content: `         ${icon} ${p.paneId} [${p.type}]`,
                      fg: color,
                    }),
                  );
                }
              }
            }
          } else if (row.type === "workspace-header") {
            children.push(Text({ content: "" }));
            children.push(
              Text({ content: " WORKSPACES", fg: "#8888ff" }),
            );
            children.push(Text({ content: "" }));
          } else if (row.type === "workspace") {
            const ws = row.workspace;
            const isExpanded = expandedWorkspaces.has(ws.id);
            const isActive = activeWorkspaceId === ws.id;
            const arrow = isExpanded ? "▾" : "▸";
            const count = ws.sessionIds.length;
            const activeLabel = isActive ? " ▶" : "";
            children.push(
              Text({
                content: `  ${isSelected ? arrow : " "} ${ws.name} (${count} session${count !== 1 ? "s" : ""})${activeLabel}`,
                fg: isSelected ? "#ffffff" : isActive ? "#00ff00" : "#aa88ff",
                bg: isSelected ? "#333366" : undefined,
              }),
            );
          } else if (row.type === "workspace-member") {
            const session = row.session;
            const statusColor = session.status === "running" ? "#00ff00" : "#ff4444";
            const icon = session.status === "running" ? "●" : "○";
            children.push(
              Text({
                content: `      ${icon} ${session.id}`,
                fg: isSelected ? "#ffffff" : statusColor,
                bg: isSelected ? "#333366" : undefined,
              }),
            );
          }
        }
      }

      children.push(Text({ content: "" }));
      children.push(Box({ flexGrow: 1 }));
      if (killConfirmSessionId) {
        children.push(Text({ content: ` Kill '${killConfirmSessionId}'?`, fg: "#ff8800" }));
        children.push(Text({ content: " x confirm (keep worktree)", fg: "#ffaa00" }));
        children.push(Text({ content: " X confirm (remove worktree)", fg: "#ff5555" }));
        children.push(Text({ content: " Esc cancel", fg: "#555555" }));
      } else {
        children.push(Text({ content: " j/k navigate", fg: "#555555" }));
        children.push(Text({ content: " l/h expand/collapse", fg: "#555555" }));
        children.push(Text({ content: " Enter switch to session", fg: "#555555" }));
        children.push(Text({ content: " n new session  w new workspace", fg: "#555555" }));
        children.push(Text({ content: " c container    a attach to workspace", fg: "#555555" }));
        children.push(Text({ content: " e editor       d detach from workspace", fg: "#555555" }));
        children.push(Text({ content: " t terminal     x kill/delete", fg: "#555555" }));
        children.push(Text({ content: " r refresh      q quit", fg: "#555555" }));
      }
    }

    renderer.root.add(
      Box(
        {
          id: CONTAINER_ID,
          width: "100%",
          height: "100%",
          flexDirection: "column",
          borderStyle: "rounded",
          borderColor: "#444488",
          paddingX: 0,
          paddingY: 1,
        },
        ...children,
      ),
    );
  }

  render();

  // Activity polling
  function pollActivity() {
    const sessions = loadSessions();
    let needsRender = false;

    const activeIds = new Set(sessions.map((s) => s.id));
    for (const id of activityMap.keys()) {
      if (!activeIds.has(id)) {
        activityMap.delete(id);
      }
    }

    for (const session of sessions) {
      if (session.status !== "running") continue;

      const paneId = getFirstPane(session.tmuxSession);
      if (!paneId) continue;

      const output = capturePaneOutput(paneId, 1).trimEnd();
      const lastLine = output.split("\n").pop() ?? "";
      const now = Date.now();
      const prev = activityMap.get(session.id);

      if (!prev) {
        activityMap.set(session.id, { lastLine, lastChangeTime: now });
        continue;
      }

      const wasIdle = now - prev.lastChangeTime >= IDLE_THRESHOLD_MS;

      if (lastLine !== prev.lastLine) {
        prev.lastLine = lastLine;
        prev.lastChangeTime = now;
        if (wasIdle) needsRender = true;
      } else {
        const isNowIdle = now - prev.lastChangeTime >= IDLE_THRESHOLD_MS;
        if (isNowIdle && !wasIdle) needsRender = true;
      }
    }

    if (needsRender) render();
  }

  const pollInterval = setInterval(pollActivity, POLL_INTERVAL_MS);

  // Keyboard handling
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    // --- Workspace creation / attach flow ---
    if (workspaceStep) {
      if (key.name === "escape") {
        workspaceStep = null;
        workspaceInput = "";
        workspaceAttachTarget = null;
        render();
        return;
      }

      if (workspaceStep === "name") {
        if (key.name === "return" && workspaceInput.trim()) {
          const name = workspaceInput.trim();
          const config = loadConfig();
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const ws: Workspace = {
            id: `ws_${slug}`,
            name,
            sessionIds: [],
            maxPanes: config.maxPanesPerWindow,
          };
          addWorkspace(ws);
          workspaceStep = null;
          workspaceInput = "";
          render();
          return;
        }
        if (key.name === "backspace") {
          workspaceInput = workspaceInput.slice(0, -1);
          render();
          return;
        }
        if (
          key.sequence &&
          key.sequence.length === 1 &&
          /[a-zA-Z0-9_ -]/.test(key.sequence) &&
          !key.ctrl &&
          !key.meta
        ) {
          workspaceInput += key.sequence;
          render();
          return;
        }
        return;
      }

      if (workspaceStep === "attach-pick") {
        if (key.name === "j" || key.name === "down") {
          if (workspaceAttachIndex < workspaceAttachChoices.length - 1) {
            workspaceAttachIndex++;
            render();
          }
          return;
        }
        if (key.name === "k" || key.name === "up") {
          if (workspaceAttachIndex > 0) {
            workspaceAttachIndex--;
            render();
          }
          return;
        }
        if (key.name === "return" && workspaceAttachTarget && workspaceAttachChoices.length > 0) {
          const session = workspaceAttachChoices[workspaceAttachIndex].session;
          attachSessionToWorkspace(workspaceAttachTarget.id, session.id);
          workspaceStep = null;
          workspaceAttachTarget = null;
          render();
          return;
        }
        return;
      }

      return;
    }

    // --- New session creation flow ---
    if (newSessionStep) {
      if (key.name === "escape") {
        newSessionStep = null;
        newSessionInput = "";
        newSessionRepo = null;
        newSessionContainer = false;
        render();
        return;
      }

      if (newSessionStep === "repo") {
        if (key.name === "j" || key.name === "down") {
          if (newSessionRepoIndex < newSessionRepoChoices.length - 1) {
            newSessionRepoIndex++;
            render();
          }
          return;
        }
        if (key.name === "k" || key.name === "up") {
          if (newSessionRepoIndex > 0) {
            newSessionRepoIndex--;
            render();
          }
          return;
        }
        if (key.name === "return") {
          newSessionRepo = newSessionRepoChoices[newSessionRepoIndex].value;
          newSessionStep = "identifier";
          newSessionInput = "";
          render();
          return;
        }
        return;
      }

      if (newSessionStep === "identifier") {
        if (key.name === "return" && newSessionInput.trim()) {
          const repo = newSessionRepo!;
          const identifier = newSessionInput.trim();

          let hasDup = false;
          for (const g of groups) {
            if (g.sessions.some((s) => s.id === identifier)) {
              hasDup = true;
              break;
            }
          }
          if (hasDup) {
            newSessionInput = "";
            render();
            return;
          }

          if (!configExists()) {
            newSessionStep = null;
            render();
            return;
          }

          const config = loadConfig();
          const match = resolveRepo(repo, config);
          if (!match) {
            newSessionStep = null;
            render();
            return;
          }

          const repoPath = match.fullPath;
          const worktreeBase = path.join(repoPath, ".worktrees");
          fs.mkdirSync(worktreeBase, { recursive: true });
          const worktreePath = path.join(worktreeBase, identifier);

          if (!fs.existsSync(worktreePath)) {
            createWorktree(repoPath, worktreePath, identifier);
          }

          if (newSessionContainer) {
            if (!devcontainerAvailable()) {
              newSessionStep = null;
              newSessionContainer = false;
              render();
              return;
            }
            if (!hasDevcontainerConfig(worktreePath) && !hasDevcontainerConfig(repoPath)) {
              newSessionStep = null;
              newSessionContainer = false;
              render();
              return;
            }
          }

          const agent = config.agent;
          const tmuxName = `cr_${identifier}`;

          try {
            execFileSync(
              "tmux",
              ["new-session", "-d", "-s", tmuxName, "-c", worktreePath],
              { stdio: "ignore" },
            );
            setSessionPaneBorderStatus(tmuxName);
            setPaneTitle(tmuxName, identifier);
          } catch { /* ignore */ }

          const rawAgentCmd = [agent, ...config.agentArgs].join(" ");
          const agentCmd = newSessionContainer
            ? buildContainerAgentCommand(worktreePath, rawAgentCmd, config)
            : rawAgentCmd;
          sendKeys(tmuxName, agentCmd);

          const session: Session = {
            id: identifier,
            repo,
            repoPath,
            worktreePath,
            branch: identifier,
            tmuxSession: tmuxName,
            agent,
            prompt: undefined,
            container: newSessionContainer || undefined,
            mode: "hidden",
            status: "running",
            createdAt: new Date().toISOString(),
          };

          addSession(session);
          writeContextFile(worktreePath, session);

          newSessionStep = null;
          newSessionInput = "";
          newSessionRepo = null;
          newSessionContainer = false;

          const newRefreshed = refreshSessions();
          groups = newRefreshed.groups;
          allSessions = newRefreshed.allSessions;
          navRows = buildNavRows(groups, collapsedRepos, expandedWorkspaces, allSessions);
          const newIdx = navRows.findIndex(
            (r) => r.type === "session" && r.session.id === identifier,
          );
          if (newIdx >= 0) selectedIndex = newIdx;

          render();
          return;
        }

        if (key.name === "backspace") {
          newSessionInput = newSessionInput.slice(0, -1);
          render();
          return;
        }

        if (
          key.sequence &&
          key.sequence.length === 1 &&
          /[a-zA-Z0-9_-]/.test(key.sequence) &&
          !key.ctrl &&
          !key.meta
        ) {
          newSessionInput += key.sequence;
          render();
          return;
        }

        return;
      }

      return;
    }

    // --- Kill confirmation mode ---
    if (killConfirmSessionId) {
      if (key.name === "escape") {
        killConfirmSessionId = null;
        render();
        return;
      }

      const isShiftX = key.sequence === "X";
      if (key.name === "x" || isShiftX) {
        const session = loadSessions().find((s) => s.id === killConfirmSessionId);
        if (session) {
          // Unmount from workspace if mounted
          if (session.mountedIn) {
            updateSession(session.id, { mountedIn: undefined });
          }

          // Kill sub-panes first
          if (session.panes) {
            for (const sub of session.panes) {
              if (sub.type !== "agent") killPane(sub.paneId);
            }
          }

          killSession(session.tmuxSession);

          if (session.container) {
            stopContainer(session.worktreePath);
          }

          if (isShiftX) {
            removeContextFile(session.worktreePath);
            removeWorktree(session.repoPath, session.worktreePath);
          }

          expandedSessions.delete(session.id);
          removeSession(session.id);
        }
        killConfirmSessionId = null;
        render();
        return;
      }

      killConfirmSessionId = null;
      render();
      return;
    }

    // --- Navigation mode ---
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      cleanup();
      process.exit(0);
    }

    if (key.name === "j" || key.name === "down") {
      if (selectedIndex < navRows.length - 1) {
        selectedIndex++;
        render();
      }
      return;
    }

    if (key.name === "k" || key.name === "up") {
      if (selectedIndex > 0) {
        selectedIndex--;
        render();
      }
      return;
    }

    if (key.name === "l" || key.name === "right") {
      const row = navRows[selectedIndex];
      if (!row) return;

      if (row.type === "repo") {
        if (collapsedRepos.has(row.repo)) {
          collapsedRepos.delete(row.repo);
          render();
        }
      } else if (row.type === "session") {
        if (!expandedSessions.has(row.session.id)) {
          expandedSessions.add(row.session.id);
          render();
        }
      } else if (row.type === "workspace") {
        if (!expandedWorkspaces.has(row.workspace.id)) {
          expandedWorkspaces.add(row.workspace.id);
          render();
        }
      }
      return;
    }

    if (key.name === "h" || key.name === "left") {
      const row = navRows[selectedIndex];
      if (!row) return;

      if (row.type === "repo") {
        if (!collapsedRepos.has(row.repo)) {
          collapsedRepos.add(row.repo);
          render();
        }
      } else if (row.type === "session") {
        if (expandedSessions.has(row.session.id)) {
          expandedSessions.delete(row.session.id);
          render();
        }
      } else if (row.type === "workspace") {
        if (expandedWorkspaces.has(row.workspace.id)) {
          expandedWorkspaces.delete(row.workspace.id);
          render();
        }
      }
      return;
    }

    if (key.name === "x") {
      const row = navRows[selectedIndex];
      if (!row) return;
      if (row.type === "session") {
        killConfirmSessionId = row.session.id;
        render();
        return;
      }
      if (row.type === "workspace") {
        const ws = row.workspace;
        // Unmount if this workspace is active in dashboard
        if (activeWorkspaceId === ws.id) {
          unmountWorkspace();
        }
        // Also kill separate tmux session if it exists (from CLI `workspace show`)
        if (ws.tmuxSession && sessionExists(ws.tmuxSession)) {
          killSession(ws.tmuxSession);
        }
        for (const sid of ws.sessionIds) {
          updateSession(sid, { mountedIn: undefined });
        }
        removeWorkspace(ws.id);
        expandedWorkspaces.delete(ws.id);
        render();
        return;
      }
      return;
    }

    if (key.name === "e" || key.name === "t") {
      const row = navRows[selectedIndex];
      if (!row) return;
      let session: Session | undefined;
      if (row.type === "session") session = row.session;
      else if (row.type === "workspace-member") session = row.session;
      if (!session || session.status !== "running") return;

      const type: SubPane["type"] = key.name === "e" ? "editor" : "terminal";

      if (row.type === "workspace-member" && session.mountedIn && activeWorkspaceId) {
        // Session is mounted in the dashboard window — find its pane by title
        const windowPanes = getWindowPaneIds(dashboardPaneId);
        let targetPane: string | null = null;
        for (const pid of windowPanes) {
          if (pid === dashboardPaneId) continue;
          try {
            const title = execFileSync(
              "tmux",
              ["display-message", "-t", pid, "-p", "#{pane_title}"],
              { encoding: "utf-8" },
            ).trim();
            if (title === session.id) { targetPane = pid; break; }
          } catch { /* ignore */ }
        }
        if (targetPane) {
          try {
            const newPaneId = smartSplitAt(targetPane, session.worktreePath);
            setPaneTitle(newPaneId, `${session.id} [${type}]`);
            if (type === "editor") sendKeys(newPaneId, "nvim .");
            // Workspace-local pane — NOT tracked in session.panes
          } catch { /* ignore */ }
        }
      } else {
        // Session is at home — split in its own tmux session
        const targetPaneId = getFirstPane(session.tmuxSession);
        if (!targetPaneId) return;

        try {
          const newPaneId = smartSplitAt(targetPaneId, session.worktreePath);
          setPaneTitle(newPaneId, `${session.id} [${type}]`);
          if (type === "editor") sendKeys(newPaneId, "nvim .");
          addSubPane(session.id, { paneId: newPaneId, type });
        } catch { /* ignore */ }
      }
      render();
      return;
    }

    if (key.name === "w") {
      workspaceStep = "name";
      workspaceInput = "";
      render();
      return;
    }

    if (key.name === "a") {
      const row = navRows[selectedIndex];
      if (!row) return;
      let wsId: string | undefined;
      if (row.type === "workspace") wsId = row.workspace.id;
      else if (row.type === "workspace-member") wsId = row.workspace.id;
      if (!wsId) return;
      const ws = findWorkspace(wsId);
      if (!ws) return;
      if (ws.sessionIds.length >= ws.maxPanes) return;

      const allWs = loadWorkspaces();
      const sessionsInOtherWorkspaces = new Set<string>();
      for (const o of allWs) {
        if (o.id !== ws.id) {
          for (const sid of o.sessionIds) sessionsInOtherWorkspaces.add(sid);
        }
      }

      const choices = allSessions
        .filter((s) =>
          s.status === "running" &&
          !ws.sessionIds.includes(s.id) &&
          !sessionsInOtherWorkspaces.has(s.id)
        )
        .map((s) => ({ label: `${s.id} (${s.repo})`, session: s }));

      workspaceAttachTarget = ws;
      workspaceAttachChoices = choices;
      workspaceAttachIndex = 0;
      workspaceStep = "attach-pick";
      render();
      return;
    }

    if (key.name === "d") {
      const row = navRows[selectedIndex];
      if (!row || row.type !== "workspace-member") return;

      const session = row.session;

      // If mounted in dashboard window, swap the pane back home
      if (session.mountedIn === row.workspace.id && activeWorkspaceId === row.workspace.id) {
        const windowPanes = getWindowPaneIds(dashboardPaneId);
        for (const pid of windowPanes) {
          if (pid === dashboardPaneId) continue;
          try {
            const title = execFileSync(
              "tmux",
              ["display-message", "-t", pid, "-p", "#{pane_title}"],
              { encoding: "utf-8" },
            ).trim();
            if (title === session.id) {
              const homePanes = listSessionPanes(session.tmuxSession);
              if (homePanes.length > 0) {
                execFileSync(
                  "tmux",
                  ["swap-pane", "-s", pid, "-t", homePanes[0]],
                  { stdio: "ignore" },
                );
              }
              killPane(pid);
              break;
            }
          } catch { /* ignore */ }
        }
      }

      updateSession(session.id, { mountedIn: undefined });
      detachSessionFromWorkspace(row.workspace.id, session.id);
      render();
      return;
    }

    if (key.name === "n" || key.name === "c") {
      if (!configExists()) return;
      const config = loadConfig();
      const workspace = resolveWorkspacePath(config);

      const aliases = config.aliases;
      const scannedRepos = listWorkspaceRepos(workspace);

      const repoToAlias = new Map<string, string>();
      for (const [alias, relPath] of Object.entries(aliases)) {
        const repoName = path.basename(relPath);
        repoToAlias.set(repoName, alias);
        repoToAlias.set(alias, alias);
      }

      const seen = new Set<string>();
      const choices: { label: string; value: string }[] = [];

      for (const repo of scannedRepos) {
        if (seen.has(repo)) continue;
        seen.add(repo);
        const alias = repoToAlias.get(repo);
        if (alias && alias !== repo) {
          choices.push({ label: `${alias} (${repo})`, value: alias });
          seen.add(alias);
        } else {
          choices.push({ label: repo, value: repo });
        }
      }

      for (const alias of Object.keys(aliases)) {
        if (seen.has(alias)) continue;
        seen.add(alias);
        choices.push({ label: alias, value: alias });
      }

      choices.sort((a, b) => a.label.localeCompare(b.label));

      if (choices.length === 0) return;

      newSessionRepoChoices = choices;
      newSessionRepoIndex = 0;
      newSessionStep = "repo";
      newSessionInput = "";
      newSessionRepo = null;
      newSessionContainer = key.name === "c";
      render();
      return;
    }

    if (key.name === "r") {
      render();
      return;
    }

    if (key.name === "return") {
      const row = navRows[selectedIndex];
      if (!row) return;

      if (row.type === "repo") {
        if (collapsedRepos.has(row.repo)) {
          collapsedRepos.delete(row.repo);
        } else {
          collapsedRepos.add(row.repo);
        }
        render();
        return;
      }

      if (row.type === "workspace-header") return;

      // Enter on workspace — mount its sessions as panes
      if (row.type === "workspace") {
        if (activeWorkspaceId === row.workspace.id) {
          // Already active — unmount
          unmountWorkspace();
        } else {
          mountWorkspace(row.workspace);
          // Auto-expand so members are visible
          expandedWorkspaces.add(row.workspace.id);
        }
        render();
        return;
      }

      // Enter on session or workspace-member — switch to session's tmux session
      const session = row.session;

      // Restart stopped sessions
      if (session.status !== "running") {
        const config = loadConfig();
        const tmuxName = session.tmuxSession;

        try {
          execFileSync(
            "tmux",
            ["new-session", "-d", "-s", tmuxName, "-c", session.worktreePath],
            { stdio: "ignore" },
          );
          setSessionPaneBorderStatus(tmuxName);
          setPaneTitle(tmuxName, session.id);
        } catch { /* ignore */ }

        const agentCmd = [session.agent, ...config.agentArgs].join(" ");
        sendKeys(tmuxName, agentCmd);
        session.status = "running";
      }

      // Switch to the session's tmux session
      try {
        switchClient(session.tmuxSession);
      } catch { /* ignore */ }
      return;
    }
  });
}
