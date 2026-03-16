import fs from "node:fs";
import path from "node:path";
import { getAgentmuxDir, ensureAgentmuxDir } from "./config.js";

export interface Session {
  id: string;
  repo: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  tmuxSession: string;
  tmuxPane?: string;
  agent: string;
  prompt?: string;
  mode: "smart" | "window" | "split" | "hidden";
  status: "running" | "stopped";
  createdAt: string;
}

const SESSIONS_FILE = path.join(getAgentmuxDir(), "sessions.json");

export function loadSessions(): Session[] {
  if (!fs.existsSync(SESSIONS_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
  return JSON.parse(raw);
}

export function saveSessions(sessions: Session[]): void {
  ensureAgentmuxDir();
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

export function getSessionsFilePath(): string {
  return SESSIONS_FILE;
}
