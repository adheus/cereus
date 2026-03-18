import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CereusConfig {
  workspace: string;
  agent: string;
  agentArgs: string[];
  defaultMode: "smart" | "window" | "split" | "hidden";
  defaultBaseBranch: string;
  maxPanesPerWindow: number;
  aliases: Record<string, string>;
}

const CEREUS_DIR = path.join(os.homedir(), ".cereus");
const CONFIG_FILE = path.join(CEREUS_DIR, "config.json");

const DEFAULT_CONFIG: CereusConfig = {
  workspace: path.join(os.homedir(), "projects"),
  agent: "cursor-agent",
  agentArgs: [],
  defaultMode: "smart",
  defaultBaseBranch: "HEAD",
  maxPanesPerWindow: 4,
  aliases: {},
};

export function getCereusDir(): string {
  return CEREUS_DIR;
}

export function ensureCereusDir(): void {
  fs.mkdirSync(CEREUS_DIR, { recursive: true });
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): CereusConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  return { ...DEFAULT_CONFIG, ...parsed };
}

export function saveConfig(config: CereusConfig): void {
  ensureCereusDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function resolveWorkspacePath(config: CereusConfig): string {
  return config.workspace.replace(/^~/, os.homedir());
}
