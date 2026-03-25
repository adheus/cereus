import fs from "node:fs";
import path from "node:path";
import { getCereusDir, ensureCereusDir } from "./config.js";

export interface SubPane {
  paneId: string;
  type: "agent" | "editor" | "terminal";
}

export interface Session {
  id: string;
  repo: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  tmuxSession: string;
  tmuxPane?: string; // deprecated: kept for backward compat, ignored in new code
  agent: string;
  prompt?: string;
  mode: "smart" | "window" | "split" | "hidden";
  container?: boolean;
  panes?: SubPane[];
  mountedIn?: string; // workspace ID if agent pane is currently borrowed
  status: "running" | "stopped";
  createdAt: string;
}

const SESSIONS_FILE = path.join(getCereusDir(), "sessions.json");

export function loadSessions(): Session[] {
  if (!fs.existsSync(SESSIONS_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
  return JSON.parse(raw);
}

export function saveSessions(sessions: Session[]): void {
  ensureCereusDir();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2) + "\n");
}

export function addSession(session: Session): void {
  const sessions = loadSessions();
  sessions.push(session);
  saveSessions(sessions);
}

export function removeSession(id: string): void {
  const sessions = loadSessions().filter((s) => s.id !== id);
  saveSessions(sessions);
}

export function findSession(id: string): Session | undefined {
  return loadSessions().find((s) => s.id === id);
}

export function updateSession(
  id: string,
  update: Partial<Session>,
): void {
  const sessions = loadSessions();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx !== -1) {
    sessions[idx] = { ...sessions[idx], ...update };
    saveSessions(sessions);
  }
}

export function addSubPane(sessionId: string, subPane: SubPane): void {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (session) {
    session.panes = session.panes || [];
    session.panes.push(subPane);
    saveSessions(sessions);
  }
}

export function removeSubPane(sessionId: string, paneId: string): void {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (session && session.panes) {
    session.panes = session.panes.filter((p) => p.paneId !== paneId);
    saveSessions(sessions);
  }
}

export function getAgentPane(session: Session): string | undefined {
  const agentSub = session.panes?.find((p) => p.type === "agent");
  return agentSub?.paneId;
}

export function getSessionsFilePath(): string {
  return SESSIONS_FILE;
}
