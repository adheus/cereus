# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cereus is a CLI tool for managing parallel AI coding sessions using git worktrees, tmux, and AI agents. It lets developers run multiple isolated coding tasks in parallel, each with its own branch, worktree, and terminal pane.

## Build & Development Commands

- `bun run dev` — Run directly with tsx (no build step needed)
- `bun run build` — Bundle with tsup → `dist/index.js` (ESM, includes shebang)
- `bun run lint` — Type-check with `tsc --noEmit`

No test framework is configured yet.

## Architecture

**CLI layer** (`src/index.ts`): Commander.js program defining commands. Each command delegates to a handler in `src/commands/`.

**Commands** (`src/commands/`): `new`, `list`, `attach`, `kill`, `alias`, `config` — each file exports a function that orchestrates library calls and user prompts.

**Libraries** (`src/lib/`):
- `config.ts` — Reads/writes `~/.cereus/config.json`, merges defaults
- `sessions.ts` — CRUD for `~/.cereus/sessions.json` (tracks active sessions with id, repo, branch, tmux pane, agent, status)
- `tmux.ts` — Wraps tmux via `child_process.execSync`; implements smart pane layout (1=full, 2=hsplit, 3=L-shape, 4=2x2 grid, 5+=new window)
- `git.ts` — Git worktree create/remove, repo init, optional GitHub CLI integration
- `repo.ts` — Resolves repo names via aliases → direct path → recursive workspace scan (3 levels deep)
- `context.ts` — Generates `CEREUS.md` files in each worktree so agents know about sibling sessions

**Data flow**: User runs a command → command handler resolves repo/config → creates worktree + tmux pane → persists session → optionally launches agent in pane.

## Key Patterns

- **Repository resolution chain**: alias lookup → direct workspace path → recursive scan → prompt to clone/create
- **Session lifecycle**: created (with tmux pane + worktree) → running → killed (tmux pane destroyed, worktree optionally removed)
- **Display modes**: `smart` (auto-grid), `window`, `split`, `hidden` — controlled by the smart layout algorithm in `tmux.ts`
- **Interactive setup**: First run detects missing config and walks user through setup via `@inquirer/prompts`
- **All tmux/git operations** use synchronous `execSync` calls
