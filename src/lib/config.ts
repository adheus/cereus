import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AgentmuxConfig {
  workspace: string;
  agent: string;
  agentArgs: string[];
  defaultMode: "smart" | "window" | "split" | "hidden";
  maxPanesPerWindow: number;
  aliases: Record<string, string>;
}

const AGENTMUX_DIR = path.join(os.homedir(), ".agentmux");
const CONFIG_FILE = path.join(AGENTMUX_DIR, "config.json");

const DEFAULT_CONFIG: AgentmuxConfig = {
  workspace: path.join(os.homedir(), "projects"),
  agent: "cursor-agent",
  agentArgs: [],
  defaultMode: "smart",
  maxPanesPerWindow: 4,
  aliases: {},
};

export function getAgentmuxDir(): string {
  return AGENTMUX_DIR;
}

export function ensureAgentmuxDir(): void {
  fs.mkdirSync(AGENTMUX_DIR, { recursive: true });
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): AgentmuxConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  return { ...DEFAULT_CONFIG, ...parsed };
}

export function saveConfig(config: AgentmuxConfig): void {
  ensureAgentmuxDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function resolveWorkspacePath(config: AgentmuxConfig): string {
  return config.workspace.replace(/^~/, os.homedir());
}
