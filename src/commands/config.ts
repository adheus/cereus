import chalk from "chalk";
import { input, select } from "@inquirer/prompts";
import {
  loadConfig,
  saveConfig,
  AgentmuxConfig,
} from "../lib/config.js";

export function configShow(): void {
  const config = loadConfig();
  console.log(chalk.bold("Agentmux Configuration:\n"));
  console.log(`  workspace:          ${chalk.cyan(config.workspace)}`);
  console.log(`  agent:              ${chalk.cyan(config.agent)}`);
  console.log(`  agentArgs:          ${chalk.cyan(JSON.stringify(config.agentArgs))}`);
  console.log(`  defaultMode:        ${chalk.cyan(config.defaultMode)}`);
  console.log(`  maxPanesPerWindow:  ${chalk.cyan(String(config.maxPanesPerWindow))}`);
  console.log(
    `  aliases:            ${chalk.cyan(Object.keys(config.aliases).length + " configured")}`,
  );
}

export async function configSet(key: string, value: string): Promise<void> {
  const config = loadConfig();

  switch (key) {
    case "workspace":
      config.workspace = value;
      break;
    case "agent":
      config.agent = value;
      break;
    case "defaultMode":
      if (!["smart", "window", "split", "hidden"].includes(value)) {
        console.error(chalk.red("defaultMode must be: smart, window, split, or hidden"));
        process.exit(1);
      }
      config.defaultMode = value as AgentmuxConfig["defaultMode"];
      break;
    case "maxPanesPerWindow": {
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 1 || n > 16) {
        console.error(chalk.red("maxPanesPerWindow must be a number between 1 and 16"));
        process.exit(1);
      }
      config.maxPanesPerWindow = n;
      break;
    }
    case "agentArgs":
      try {
        config.agentArgs = JSON.parse(value);
      } catch {
        console.error(chalk.red("agentArgs must be a JSON array, e.g. '[\"--yolo\"]'"));
        process.exit(1);
      }
      break;
    default:
      console.error(chalk.red(`Unknown config key: ${key}`));
      console.log("Available keys: workspace, agent, agentArgs, defaultMode, maxPanesPerWindow");
      process.exit(1);
  }

  saveConfig(config);
  console.log(chalk.green("✔"), `Set ${key} = ${value}`);
}

export async function runSetup(): Promise<void> {
  const existing = loadConfig();

  const workspace = await input({
    message: "Workspace root (where your repos live):",
    default: existing.workspace,
  });

  const agent = await input({
    message: "Default agent CLI command:",
    default: existing.agent,
  });

  const defaultMode = await select({
    message: "Default session mode:",
    choices: [
      { name: "smart — auto-split panes, then new windows (default)", value: "smart" },
      { name: "window — new tmux window", value: "window" },
      { name: "split — split current pane", value: "split" },
      { name: "hidden — run in background", value: "hidden" },
    ],
    default: existing.defaultMode,
  });

  const maxPanesStr = await input({
    message: "Max panes per window (for smart mode):",
    default: String(existing.maxPanesPerWindow),
  });

  const config: AgentmuxConfig = {
    ...existing,
    workspace,
    agent,
    defaultMode: defaultMode as AgentmuxConfig["defaultMode"],
    maxPanesPerWindow: parseInt(maxPanesStr, 10) || 4,
  };

  saveConfig(config);
  console.log(chalk.green("\n✔"), "Configuration saved.\n");
}
