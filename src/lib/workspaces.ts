import fs from "node:fs";
import path from "node:path";
import { getCereusDir, ensureCereusDir } from "./config.js";

export interface Workspace {
  id: string;
  name: string;
  sessionIds: string[];
  maxPanes: number;
  tmuxSession?: string;
}

const WORKSPACES_FILE = path.join(getCereusDir(), "workspaces.json");

export function loadWorkspaces(): Workspace[] {
  if (!fs.existsSync(WORKSPACES_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(WORKSPACES_FILE, "utf-8");
  return JSON.parse(raw);
}

export function saveWorkspaces(workspaces: Workspace[]): void {
  ensureCereusDir();
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(workspaces, null, 2) + "\n");
}

export function addWorkspace(workspace: Workspace): void {
  const workspaces = loadWorkspaces();
  workspaces.push(workspace);
  saveWorkspaces(workspaces);
}

export function removeWorkspace(id: string): void {
  const workspaces = loadWorkspaces().filter((o) => o.id !== id);
  saveWorkspaces(workspaces);
}

export function findWorkspace(idOrName: string): Workspace | undefined {
  return loadWorkspaces().find((o) => o.id === idOrName || o.name === idOrName);
}

export function updateWorkspace(
  id: string,
  update: Partial<Workspace>,
): void {
  const workspaces = loadWorkspaces();
  const idx = workspaces.findIndex((o) => o.id === id);
  if (idx !== -1) {
    workspaces[idx] = { ...workspaces[idx], ...update };
    saveWorkspaces(workspaces);
  }
}

export function attachSessionToWorkspace(
  workspaceId: string,
  sessionId: string,
): void {
  const workspaces = loadWorkspaces();
  const workspace = workspaces.find((o) => o.id === workspaceId);
  if (workspace && !workspace.sessionIds.includes(sessionId)) {
    workspace.sessionIds.push(sessionId);
    saveWorkspaces(workspaces);
  }
}

export function detachSessionFromWorkspace(
  workspaceId: string,
  sessionId: string,
): void {
  const workspaces = loadWorkspaces();
  const workspace = workspaces.find((o) => o.id === workspaceId);
  if (workspace) {
    workspace.sessionIds = workspace.sessionIds.filter((s) => s !== sessionId);
    saveWorkspaces(workspaces);
  }
}
