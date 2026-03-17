import path from "node:path";
import fs from "node:fs";
import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  loadConfig,
  configExists,
  resolveWorkspacePath,
  CereusConfig,
} from "../lib/config.js";
import { addSession, loadSessions } from "../lib/sessions.js";
import { resolveRepo } from "../lib/repo.js";
import {
  createWorktree,
  cloneRepo,
  initRepo,
  ghAvailable,
  ghCreateRepo,
} from "../lib/git.js";
import {
  isInsideTmux,
  createSession,
  sendKeys,
  sessionExists,
  smartSplit,
  splitPane,
} from "../lib/tmux.js";
import { writeContextFile } from "../lib/context.js";
import { runSetup } from "./config.js";

type Mode = "smart" | "window" | "split" | "hidden";

interface NewOptions {
  smart?: boolean;
  split?: boolean;
  window?: boolean;
  hidden?: boolean;
  agent?: string;
  prompt?: string;
}

export async function newCommand(
  repo: string,
  identifier: string,
  options: NewOptions,
): Promise<void> {
  if (!configExists()) {
    console.log(chalk.yellow("First time setup — let's configure cereus.\n"));
    await runSetup();
  }

  const config = loadConfig();
  const mode = resolveMode(options, config);
  const agent = options.agent ?? config.agent;
  const tmuxName = `cr_${identifier}`;

  const existing = loadSessions().find((s) => s.id === identifier);
  if (existing) {
    console.error(
      chalk.red(`Session '${identifier}' already exists. Use 'cereus attach ${identifier}' or 'cereus kill ${identifier}'.`),
    );
    process.exit(1);
  }

  const repoPath = await resolveOrCreateRepo(repo, config);
  if (!repoPath) {
    process.exit(1);
  }

  const worktreeBase = path.join(repoPath, ".worktrees");
  fs.mkdirSync(worktreeBase, { recursive: true });
  const worktreePath = path.join(worktreeBase, identifier);

  if (fs.existsSync(worktreePath)) {
    console.error(chalk.red(`Worktree path already exists: ${worktreePath}`));
    process.exit(1);
  }

  console.log(chalk.blue("▸"), `Creating worktree '${identifier}'...`);
  createWorktree(repoPath, worktreePath, identifier);

  const agentCmd = buildAgentCommand(agent, config, options.prompt);
  let tmuxPane: string | undefined;

  switch (mode) {
    case "smart": {
      console.log(chalk.blue("▸"), "Smart splitting...");
      if (!isInsideTmux()) {
        createSession(tmuxName, worktreePath);
        sendKeys(tmuxName, agentCmd);
        console.log(chalk.green("✔"), `Session '${identifier}' started (new tmux session — not inside tmux)`);
        console.log(`\n  attach:  cereus attach ${identifier}\n`);
      } else {
        const result = smartSplit(worktreePath, config.maxPanesPerWindow, identifier);
        tmuxPane = result.paneId;
        sendKeys(tmuxPane, agentCmd);
        if (result.createdWindow) {
          console.log(chalk.green("✔"), `Session '${identifier}' started (new window — panes full)`);
        } else {
          console.log(chalk.green("✔"), `Session '${identifier}' started (pane ${tmuxPane})`);
        }
      }
      break;
    }

    case "split": {
      if (!isInsideTmux()) {
        console.error(chalk.red("--split requires running inside a tmux session"));
        process.exit(1);
      }
      tmuxPane = splitPane(worktreePath, "h");
      sendKeys(tmuxPane, agentCmd);
      console.log(chalk.green("✔"), `Session '${identifier}' started (split)`);
      break;
    }

    case "hidden": {
      createSession(tmuxName, worktreePath);
      sendKeys(tmuxName, agentCmd);
      console.log(chalk.green("✔"), `Session '${identifier}' started (hidden)`);
      console.log(`\n  attach:  cereus attach ${identifier}`);
      console.log(`  kill:    cereus kill ${identifier}\n`);
      break;
    }

    case "window": {
      createSession(tmuxName, worktreePath);
      sendKeys(tmuxName, agentCmd);
      if (isInsideTmux()) {
        console.log(chalk.green("✔"), `Session '${identifier}' started`);
        console.log(chalk.blue("▸"), "Switching to session...");
        const { execFileSync } = await import("node:child_process");
        execFileSync("tmux", ["switch-client", "-t", tmuxName], {
          stdio: "inherit",
        });
      } else {
        console.log(chalk.green("✔"), `Session '${identifier}' started`);
        console.log(`\n  attach:  cereus attach ${identifier}\n`);
      }
      break;
    }
  }

  const session = {
    id: identifier,
    repo,
    repoPath,
    worktreePath,
    branch: identifier,
    tmuxSession: tmuxName,
    tmuxPane,
    agent,
    prompt: options.prompt,
    mode,
    status: "running" as const,
    createdAt: new Date().toISOString(),
  };

  addSession(session);
  writeContextFile(worktreePath, session);
}

function resolveMode(options: NewOptions, config: CereusConfig): Mode {
  if (options.smart) return "smart";
  if (options.split) return "split";
  if (options.hidden) return "hidden";
  if (options.window) return "window";
  return config.defaultMode;
}

function buildAgentCommand(
  agent: string,
  config: CereusConfig,
  prompt?: string,
): string {
  const parts = [agent, ...config.agentArgs];
  if (prompt) {
    parts.push(JSON.stringify(prompt));
  }
  return parts.join(" ");
}

async function resolveOrCreateRepo(
  name: string,
  config: CereusConfig,
): Promise<string | null> {
  const match = resolveRepo(name, config);
  if (match) {
    console.log(chalk.blue("▸"), `Found repo at ${chalk.bold(match.fullPath)}`);
    return match.fullPath;
  }

  console.log(chalk.yellow(`Repository '${name}' not found in workspace.`));

  const action = await select({
    message: "What would you like to do?",
    choices: [
      { name: "Clone from URL", value: "clone" },
      { name: "Create new repository", value: "create" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  const workspace = resolveWorkspacePath(config);

  switch (action) {
    case "clone": {
      const url = await input({ message: "Repository URL:" });
      const targetDir = path.join(workspace, name);
      console.log(chalk.blue("▸"), `Cloning into ${targetDir}...`);
      cloneRepo(url, targetDir);
      return targetDir;
    }

    case "create": {
      const targetDir = path.join(workspace, name);
      const useGh = ghAvailable();

      if (useGh) {
        const useGhCreate = await confirm({
          message: "GitHub CLI detected. Create a GitHub repository?",
          default: true,
        });

        if (useGhCreate) {
          const isPrivate = await confirm({
            message: "Private repository?",
            default: true,
          });
          console.log(chalk.blue("▸"), `Creating GitHub repo '${name}'...`);
          ghCreateRepo(name, workspace, isPrivate);
          return path.join(workspace, name);
        }
      }

      console.log(chalk.blue("▸"), `Initializing new repo at ${targetDir}...`);
      initRepo(targetDir);
      return targetDir;
    }

    case "cancel":
    default:
      return null;
  }
}
