import fs from "node:fs";
import path from "node:path";
import { AgentmuxConfig, resolveWorkspacePath } from "./config.js";
import { isGitRepo } from "./git.js";

export interface RepoMatch {
  name: string;
  fullPath: string;
}

/**
 * Resolve a repo name to a path, checking aliases first then scanning
 * the workspace directory recursively (up to 3 levels deep).
 */
export function resolveRepo(
  name: string,
  config: AgentmuxConfig,
): RepoMatch | null {
  const workspace = resolveWorkspacePath(config);

  if (config.aliases[name]) {
    const aliasPath = path.join(workspace, config.aliases[name]);
    if (fs.existsSync(aliasPath) && isGitRepo(aliasPath)) {
      return { name, fullPath: aliasPath };
    }
  }

  const direct = path.join(workspace, name);
  if (fs.existsSync(direct) && isGitRepo(direct)) {
    return { name, fullPath: direct };
  }

  const found = scanForRepo(workspace, name, 3);
  if (found) {
    return { name, fullPath: found };
  }

  return null;
}

function scanForRepo(
  dir: string,
  target: string,
  maxDepth: number,
  currentDepth = 0,
): string | null {
  if (currentDepth >= maxDepth || !fs.existsSync(dir)) {
    return null;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.name === target && isGitRepo(fullPath)) {
      return fullPath;
    }

    const nested = scanForRepo(fullPath, target, maxDepth, currentDepth + 1);
    if (nested) return nested;
  }

  return null;
}
