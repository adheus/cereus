import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CereusConfig } from "./config.js";

/**
 * Check if the devcontainer CLI is installed and available.
 */
export function devcontainerAvailable(): boolean {
  try {
    execFileSync("devcontainer", ["--version"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a devcontainer.json exists in the given repo/worktree path.
 * Checks both .devcontainer/devcontainer.json and .devcontainer.json.
 */
export function hasDevcontainerConfig(worktreePath: string): boolean {
  return (
    fs.existsSync(
      path.join(worktreePath, ".devcontainer", "devcontainer.json"),
    ) || fs.existsSync(path.join(worktreePath, ".devcontainer.json"))
  );
}

/**
 * Build the remote-env flags for devcontainer commands.
 * Reads current env values for the configured variable names.
 */
function buildRemoteEnvFlags(config: CereusConfig): string[] {
  const flags: string[] = [];
  const envVars = config.containerEnvVars ?? [];
  for (const name of envVars) {
    const value = process.env[name];
    if (value) {
      flags.push("--remote-env", `${name}=${value}`);
    }
  }
  return flags;
}

/**
 * Build a shell command that starts the devcontainer and runs the agent inside it.
 * Returns a single string suitable for sending to a tmux pane via send-keys.
 */
export function buildContainerAgentCommand(
  worktreePath: string,
  agentCmd: string,
  config: CereusConfig,
): string {
  const envFlags = buildRemoteEnvFlags(config);
  const envStr = envFlags.length > 0 ? " " + envFlags.join(" ") : "";

  return (
    `devcontainer up --workspace-folder ${JSON.stringify(worktreePath)}${envStr}` +
    ` && devcontainer exec --workspace-folder ${JSON.stringify(worktreePath)} ${agentCmd}`
  );
}

/**
 * Stop and remove the devcontainer for a given workspace.
 */
export function stopContainer(worktreePath: string): void {
  try {
    execFileSync(
      "devcontainer",
      ["down", "--workspace-folder", worktreePath],
      { stdio: "ignore" },
    );
  } catch {
    // Container may already be stopped
  }
}
