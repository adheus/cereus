import { execSync, execFileSync } from "node:child_process";

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export function sessionExists(name: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function createSession(name: string, cwd: string): void {
  execFileSync("tmux", ["new-session", "-d", "-s", name, "-c", cwd], {
    stdio: "ignore",
  });
}

export function sendKeys(target: string, keys: string): void {
  execFileSync("tmux", ["send-keys", "-t", target, keys, "Enter"]);
}

export function attachSession(name: string): void {
  execFileSync("tmux", ["attach-session", "-t", name], { stdio: "inherit" });
}

export function switchClient(name: string): void {
  execFileSync("tmux", ["switch-client", "-t", name], { stdio: "inherit" });
}

export function newWindow(name: string, cwd: string): void {
  if (isInsideTmux()) {
    execFileSync("tmux", ["new-window", "-n", name, "-c", cwd]);
  } else {
    createSession(name, cwd);
    attachSession(name);
  }
}

export function splitPane(cwd: string, direction: "h" | "v" = "h"): string {
  const output = execFileSync(
    "tmux",
    ["split-window", `-${direction}`, "-c", cwd, "-P", "-F", "#{pane_id}"],
    { encoding: "utf-8" },
  );
  return output.trim();
}

export function splitPaneAt(
  targetPane: string,
  cwd: string,
  direction: "h" | "v",
): string {
  const output = execFileSync(
    "tmux",
    [
      "split-window",
      `-${direction}`,
      "-t",
      targetPane,
      "-c",
      cwd,
      "-P",
      "-F",
      "#{pane_id}",
    ],
    { encoding: "utf-8" },
  );
  return output.trim();
}

export function killSession(name: string): void {
  if (sessionExists(name)) {
    execFileSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" });
  }
}

export function killPane(paneId: string): void {
  try {
    execFileSync("tmux", ["kill-pane", "-t", paneId], { stdio: "ignore" });
  } catch {
    // pane may already be gone
  }
}

export function paneExists(paneId: string): boolean {
  try {
    const output = run("tmux list-panes -a -F '#{pane_id}'");
    return output.split("\n").includes(paneId);
  } catch {
    return false;
  }
}

export function getCurrentWindowPaneCount(): number {
  try {
    const output = run("tmux list-panes -F '#{pane_id}'");
    return output.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

export function getCurrentWindowPaneIds(): string[] {
  try {
    const output = run("tmux list-panes -F '#{pane_id}'");
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export interface SmartSplitResult {
  paneId: string;
  createdWindow: boolean;
}

/**
 * Smart split: progressively fills a 2x2 grid, then creates a new window.
 *
 * Pane 1 (full)      → split-h      → [left | RIGHT]
 * Pane 2 (left|right) → split-v @1  → [left | right-top / RIGHT-BOTTOM]
 * Pane 3 (L|RT/RB)   → split-v @0  → [left-top / LEFT-BOTTOM | right-top / right-bottom]
 * Pane 4 (2x2 grid)  → new window   → start over
 */
export function smartSplit(
  cwd: string,
  maxPanes: number,
  windowName: string,
): SmartSplitResult {
  if (!isInsideTmux()) {
    createSession(windowName, cwd);
    return { paneId: windowName, createdWindow: true };
  }

  const paneCount = getCurrentWindowPaneCount();

  if (paneCount >= maxPanes) {
    execFileSync("tmux", ["new-window", "-n", windowName, "-c", cwd]);
    const newPaneId = getCurrentWindowPaneIds()[0];
    return { paneId: newPaneId, createdWindow: true };
  }

  const panes = getCurrentWindowPaneIds();

  let paneId: string;
  switch (paneCount) {
    case 1:
      paneId = splitPaneAt(panes[0], cwd, "h");
      break;
    case 2:
      paneId = splitPaneAt(panes[1], cwd, "v");
      break;
    case 3:
      paneId = splitPaneAt(panes[0], cwd, "v");
      break;
    default:
      paneId = splitPane(cwd, "h");
      break;
  }

  return { paneId, createdWindow: false };
}

export function capturePaneOutput(target: string, lines = 500): string {
  try {
    return execFileSync(
      "tmux",
      ["capture-pane", "-t", target, "-p", "-S", `-${lines}`],
      { encoding: "utf-8" },
    );
  } catch {
    return "";
  }
}

export function listTmuxSessions(): string[] {
  try {
    const output = run("tmux list-sessions -F '#{session_name}'");
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
