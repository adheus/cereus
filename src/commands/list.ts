import chalk from "chalk";
import { loadSessions, saveSessions } from "../lib/sessions.js";
import { sessionExists } from "../lib/tmux.js";

export function listCommand(): void {
  const sessions = loadSessions();

  if (sessions.length === 0) {
    console.log(chalk.blue("▸"), "No active sessions.");
    return;
  }

  for (const session of sessions) {
    session.status = sessionExists(session.tmuxSession) ? "running" : "stopped";
  }
  saveSessions(sessions);

  const header = [
    pad("NAME", 18),
    pad("REPO", 15),
    pad("STATUS", 10),
    pad("MODE", 8),
    pad("AGENT", 15),
    "PROMPT",
  ].join(" ");

  console.log(chalk.bold(header));

  for (const s of sessions) {
    const statusColor = s.status === "running" ? chalk.green : chalk.red;
    const prompt = s.prompt
      ? s.prompt.length > 40
        ? s.prompt.slice(0, 37) + "..."
        : s.prompt
      : "-";

    const row = [
      pad(s.id, 18),
      pad(s.repo, 15),
      statusColor(pad(s.status, 10)),
      pad(s.mode, 8),
      pad(s.agent, 15),
      prompt,
    ].join(" ");

    console.log(row);
  }
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}
