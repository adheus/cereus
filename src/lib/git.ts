import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function isGitRepo(dir: string): boolean {
  try {
    git(["rev-parse", "--is-inside-work-tree"], dir);
    return true;
  } catch {
    return false;
  }
}

export function getRepoRoot(dir: string): string {
  return git(["rev-parse", "--show-toplevel"], dir);
}

export function getCurrentBranch(dir: string): string {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
}

export function createWorktree(
  repoDir: string,
  worktreePath: string,
  branch: string,
  startPoint?: string,
): void {
  const args = ["worktree", "add", "-b", branch, worktreePath];
  if (startPoint) {
    args.push(startPoint);
  }
  git(args, repoDir);
}


export function removeWorktree(repoDir: string, worktreePath: string): void {
  try {
    git(["worktree", "remove", worktreePath, "--force"], repoDir);
  } catch {
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  }
}

export function cloneRepo(url: string, targetDir: string): void {
  execFileSync("git", ["clone", url, targetDir], { stdio: "inherit" });
}

export function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(["init"], dir);
}

export function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function ghCreateRepo(
  name: string,
  dir: string,
  isPrivate = true,
): void {
  const visibility = isPrivate ? "--private" : "--public";
  execFileSync("gh", ["repo", "create", name, visibility, "--clone"], {
    cwd: dir,
    stdio: "inherit",
  });
}

export function getWorktreesDir(repoPath: string): string {
  const repoName = path.basename(repoPath);
  return path.join(repoPath, ".worktrees", repoName);
}

export function listWorktrees(repoDir: string): string[] {
  try {
    const output = git(["worktree", "list", "--porcelain"], repoDir);
    return output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.replace("worktree ", ""));
  } catch {
    return [];
  }
}
