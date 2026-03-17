import fs from "node:fs";
import path from "node:path";
import {
  loadSessions,
  addSession,
  removeSession,
  type Session,
} from "../lib/sessions.js";
import {
  isInsideTmux,
  paneExists,
  sessionExists,
  killPane,
  killSession,
  sendKeys,
} from "../lib/tmux.js";
import {
  loadConfig,
  configExists,
  resolveWorkspacePath,
} from "../lib/config.js";
import { resolveRepo } from "../lib/repo.js";
import { createWorktree, isGitRepo } from "../lib/git.js";
import { writeContextFile } from "../lib/context.js";
import { execFileSync } from "node:child_process";

const VERSION = "0.1.0";

interface RepoGroup {
  repo: string;
  sessions: Session[];
}

// A navigable row is either a repo header or a session
type NavRow =
  | { type: "repo"; repo: string }
  | { type: "session"; session: Session };

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

function refreshSessions(): RepoGroup[] {
  const sessions = loadSessions();
  for (const s of sessions) {
    const alive = s.tmuxPane
      ? paneExists(s.tmuxPane)
      : sessionExists(s.tmuxSession);
    s.status = alive ? "running" : "stopped";
  }
  return groupByRepo(sessions);
}

/** Build the flat navigable list from groups, respecting collapsed repos */
function buildNavRows(
  groups: RepoGroup[],
  collapsedRepos: Set<string>,
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
  return rows;
}

function getCurrentPaneId(): string {
  try {
    return execFileSync("tmux", ["display-message", "-p", "#{pane_id}"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

/** Resolve the actual tmux pane ID for a session (works for both pane-based and session-based) */
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

function openPreviewPane(session: Session, dashboardPaneId: string): string {
  const paneId = execFileSync(
    "tmux",
    [
      "split-window", "-h", "-t", dashboardPaneId,
      "-c", session.worktreePath,
      "-P", "-F", "#{pane_id}", "-l", "70%",
    ],
    { encoding: "utf-8" },
  ).trim();

  const sessionPaneId = resolveSessionPaneId(session);
  if (sessionPaneId) {
    try {
      execFileSync(
        "tmux",
        ["swap-pane", "-s", sessionPaneId, "-t", paneId],
        { stdio: "ignore" },
      );
      return paneId;
    } catch {
      // fallback
    }
  }

  return paneId;
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

  const isBun = typeof (globalThis as any).Bun !== "undefined";
  if (!isBun) {
    console.error(
      "Dashboard requires Bun runtime. Run with: bun src/index.ts dashboard",
    );
    process.exit(1);
  }

  const { createCliRenderer, Box, Text } = await import("@opentui/core");
  type KeyEvent = import("@opentui/core").KeyEvent;

  const dashboardPaneId = getCurrentPaneId();

  let selectedIndex = 0;
  let previewPaneId: string | null = null;
  let swappedSessionId: string | null = null;
  const expandedSessions = new Set<string>();
  const collapsedRepos = new Set<string>();

  // Navigation list (rebuilt on each render)
  let groups: RepoGroup[] = [];
  let navRows: NavRow[] = [];

  // New session creation state
  let newSessionStep: "repo" | "identifier" | null = null;
  let newSessionRepoChoices: { label: string; value: string }[] = [];
  let newSessionRepoIndex = 0;
  let newSessionRepo: string | null = null;
  let newSessionInput = "";

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: false,
    enableMouseMovement: false,
  });

  function getSwappedSession(): Session | undefined {
    if (!swappedSessionId) return undefined;
    for (const g of groups) {
      for (const s of g.sessions) {
        if (s.id === swappedSessionId) return s;
      }
    }
    return undefined;
  }

  function cleanup() {
    const swapped = getSwappedSession();
    const swappedPaneId = swapped ? resolveSessionPaneId(swapped) : null;
    if (swappedPaneId && previewPaneId && paneExists(previewPaneId)) {
      try {
        execFileSync(
          "tmux",
          ["swap-pane", "-s", previewPaneId, "-t", swappedPaneId],
          { stdio: "ignore" },
        );
      } catch { /* ignore */ }
    }
    if (previewPaneId && paneExists(previewPaneId)) {
      killPane(previewPaneId);
    }
    // Restore automatic window naming
    try {
      execFileSync("tmux", [
        "set-option", "-w", "-t", dashboardPaneId, "automatic-rename", "on",
      ]);
    } catch { /* ignore */ }
    renderer.destroy();
  }

  function focusDashboard() {
    try {
      execFileSync("tmux", ["select-pane", "-t", dashboardPaneId]);
    } catch { /* ignore */ }
  }

  function restoreSwappedPane() {
    const prevSwapped = getSwappedSession();
    const prevPaneId = prevSwapped ? resolveSessionPaneId(prevSwapped) : null;
    if (prevPaneId && previewPaneId && paneExists(previewPaneId)) {
      try {
        execFileSync(
          "tmux",
          ["swap-pane", "-s", previewPaneId, "-t", prevPaneId],
          { stdio: "ignore" },
        );
      } catch { /* ignore */ }
      swappedSessionId = null;
    }
  }

  function attachSession(session: Session) {
    restoreSwappedPane();

    const sessionPaneId = resolveSessionPaneId(session);

    if (!previewPaneId || !paneExists(previewPaneId)) {
      previewPaneId = openPreviewPane(session, dashboardPaneId);
      if (sessionPaneId) {
        swappedSessionId = session.id;
      }
    } else {
      if (sessionPaneId) {
        try {
          execFileSync(
            "tmux",
            ["swap-pane", "-s", sessionPaneId, "-t", previewPaneId],
            { stdio: "ignore" },
          );
          swappedSessionId = session.id;
        } catch {
          try {
            execFileSync("tmux", [
              "send-keys", "-t", previewPaneId,
              `cd ${session.worktreePath}`, "Enter",
            ]);
          } catch { /* ignore */ }
        }
      } else {
        try {
          execFileSync("tmux", [
            "send-keys", "-t", previewPaneId,
            `cd ${session.worktreePath}`, "Enter",
          ]);
        } catch { /* ignore */ }
      }
    }

    // Set the window name to the session ID so it shows in the tmux status bar
    try {
      execFileSync("tmux", [
        "rename-window", "-t", dashboardPaneId, `${session.id} (agentmux)`,
      ]);
    } catch { /* ignore */ }

    focusDashboard();
  }

  const CONTAINER_ID = "dashboard-root";

  function render() {
    try {
      renderer.root.remove(CONTAINER_ID);
    } catch { /* first render */ }

    groups = refreshSessions();
    navRows = buildNavRows(groups, collapsedRepos);

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

    if (newSessionStep) {
      // --- New session creation UI ---
      children.push(Text({ content: " NEW SESSION", fg: "#00ff00" }));
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
          } else {
            const session = row.session;
            const isExpanded = expandedSessions.has(session.id);
            const statusColor =
              session.status === "running" ? "#00ff00" : "#ff4444";
            const arrow = isExpanded ? "▾" : "▸";

            children.push(
              Text({
                content: `  ${isSelected ? arrow : " "} ● ${session.id}`,
                fg: isSelected ? "#ffffff" : statusColor,
                bg: isSelected ? "#333366" : undefined,
              }),
            );

            if (isExpanded) {
              const dim = "#888888";
              children.push(
                Text({
                  content: `       Status:    ${session.status}`,
                  fg: statusColor,
                }),
              );
              children.push(
                Text({
                  content: `       Branch:    ${session.branch}`,
                  fg: dim,
                }),
              );
              children.push(
                Text({
                  content: `       Agent:     ${session.agent}`,
                  fg: dim,
                }),
              );
              children.push(
                Text({
                  content: `       Mode:      ${session.mode}`,
                  fg: dim,
                }),
              );
              children.push(
                Text({
                  content: `       Worktree:  ${session.worktreePath}`,
                  fg: "#666666",
                }),
              );
              if (session.prompt) {
                children.push(
                  Text({
                    content: `       Prompt:    ${session.prompt}`,
                    fg: dim,
                  }),
                );
              }
            }
          }
        }
      }

      children.push(Text({ content: "" }));
      children.push(Box({ flexGrow: 1 }));
      children.push(Text({ content: " j/k navigate", fg: "#555555" }));
      children.push(Text({ content: " l/h expand/collapse", fg: "#555555" }));
      children.push(Text({ content: " Enter attach", fg: "#555555" }));
      children.push(Text({ content: " n new session", fg: "#555555" }));
      children.push(Text({ content: " x kill session", fg: "#555555" }));
      children.push(Text({ content: " r refresh", fg: "#555555" }));
      children.push(Text({ content: " q quit", fg: "#555555" }));
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

  // Keyboard handling
  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    // --- New session creation flow ---
    if (newSessionStep) {
      if (key.name === "escape") {
        newSessionStep = null;
        newSessionInput = "";
        newSessionRepo = null;
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

          // Check for duplicates
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

          if (fs.existsSync(worktreePath)) {
            newSessionStep = null;
            render();
            return;
          }

          createWorktree(repoPath, worktreePath, identifier);

          const agent = config.agent;
          const tmuxName = `cr_${identifier}`;

          try {
            execFileSync(
              "tmux",
              ["new-session", "-d", "-s", tmuxName, "-c", worktreePath],
              { stdio: "ignore" },
            );
          } catch { /* ignore */ }

          const agentCmd = [agent, ...config.agentArgs].join(" ");
          sendKeys(tmuxName, agentCmd);

          const session: Session = {
            id: identifier,
            repo,
            repoPath,
            worktreePath,
            branch: identifier,
            tmuxSession: tmuxName,
            tmuxPane: undefined,
            agent,
            prompt: undefined,
            mode: "hidden",
            status: "running",
            createdAt: new Date().toISOString(),
          };

          addSession(session);
          writeContextFile(worktreePath, session);

          newSessionStep = null;
          newSessionInput = "";
          newSessionRepo = null;

          // Re-render and select the new session
          groups = refreshSessions();
          navRows = buildNavRows(groups, collapsedRepos);
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
      } else {
        if (!expandedSessions.has(row.session.id)) {
          expandedSessions.add(row.session.id);
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
      } else {
        if (expandedSessions.has(row.session.id)) {
          expandedSessions.delete(row.session.id);
          render();
        }
      }
      return;
    }

    if (key.name === "x") {
      const row = navRows[selectedIndex];
      if (!row || row.type !== "session") return;
      const session = row.session;

      if (
        swappedSessionId === session.id &&
        previewPaneId &&
        paneExists(previewPaneId)
      ) {
        const killedPaneId = resolveSessionPaneId(session);
        if (killedPaneId) {
          try {
            execFileSync(
              "tmux",
              ["swap-pane", "-s", previewPaneId, "-t", killedPaneId],
              { stdio: "ignore" },
            );
          } catch { /* ignore */ }
        }
        swappedSessionId = null;
        killPane(previewPaneId);
        previewPaneId = null;
      }

      if (session.tmuxPane) {
        killPane(session.tmuxPane);
      } else {
        killSession(session.tmuxSession);
      }

      expandedSessions.delete(session.id);
      removeSession(session.id);
      render();
      return;
    }

    if (key.name === "n") {
      if (!configExists()) return;
      const config = loadConfig();
      const workspace = resolveWorkspacePath(config);

      const aliases = config.aliases; // alias name -> relative path
      const scannedRepos = listWorkspaceRepos(workspace);

      // Build a map of repo name -> alias name (reverse lookup)
      const repoToAlias = new Map<string, string>();
      for (const [alias, relPath] of Object.entries(aliases)) {
        // The last segment of the alias path is typically the repo dir name
        const repoName = path.basename(relPath);
        repoToAlias.set(repoName, alias);
        // Also map the alias itself in case it doesn't match a scanned repo
        repoToAlias.set(alias, alias);
      }

      // Build deduplicated choices
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

      // Add aliases that weren't found in workspace scan
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

      // Enter on a repo toggles collapse
      if (row.type === "repo") {
        if (collapsedRepos.has(row.repo)) {
          collapsedRepos.delete(row.repo);
        } else {
          collapsedRepos.add(row.repo);
        }
        render();
        return;
      }

      const session = row.session;
      if (session.status !== "running") return;

      attachSession(session);
      render();

      if (previewPaneId && paneExists(previewPaneId)) {
        try {
          execFileSync("tmux", ["select-pane", "-t", previewPaneId]);
        } catch { /* ignore */ }
      }
      return;
    }
  });
}
