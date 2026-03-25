# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cereus is a CLI tool for managing parallel AI coding sessions using git worktrees, tmux, and AI agents. It lets developers run multiple isolated coding tasks in parallel, each with its own branch, worktree, and terminal pane.

## Build & Development Commands

- `bun run dev` — Run directly with tsx (no build step needed)
- `bun run build` — Bundle with tsup → `dist/index.js` (ESM, includes shebang)
- `bun run build:native` — Compile to standalone binary via `bun build --compile` → `dist/cereus`
- `bun run lint` — Type-check with `tsc --noEmit`
- `bun run release` — Tag current version and push to trigger CI release (builds binaries for darwin-arm64, linux-arm64, linux-x64)

No test framework is configured yet.

## Architecture

**CLI layer** (`src/index.ts`): Commander.js program defining commands. Each command delegates to a handler in `src/commands/`.

**Commands** (`src/commands/`):
- `new` — Create a new agent session in a worktree
- `list` — List all active sessions
- `attach` — Attach to an existing session
- `kill` — Kill a session (cleans up sub-panes, containers, worktrees)
- `pane` — Manage sub-panes (editor/terminal) within a session
- `workspace` — Manage workspaces (named collections of sessions viewed together)
- `dashboard` — Interactive TUI for managing sessions and workspaces
- `alias` — Manage repository aliases
- `config` — View/edit configuration

**Libraries** (`src/lib/`):
- `config.ts` — Reads/writes `~/.cereus/config.json`, merges defaults
- `sessions.ts` — CRUD for `~/.cereus/sessions.json` (tracks sessions with id, repo, branch, tmux pane, agent, sub-panes, status)
- `workspaces.ts` — CRUD for `~/.cereus/workspaces.json` (persistent named collections of sessions)
- `tmux.ts` — Wraps tmux via `child_process.execSync`; implements smart pane layout, pane border titles, pane existence checks
- `git.ts` — Git worktree create/remove, repo init, optional GitHub CLI integration
- `repo.ts` — Resolves repo names via aliases → direct path → recursive workspace scan (3 levels deep)
- `context.ts` — Generates `CEREUS.md` files in each worktree so agents know about sibling sessions
- `container.ts` — Devcontainer support for running agents in containers

**Data flow**: User runs a command → command handler resolves repo/config → creates worktree + tmux pane → persists session → optionally launches agent in pane.

## Key Patterns

- **Repository resolution chain**: alias lookup → direct workspace path → recursive scan → prompt to clone/create
- **Session lifecycle**: created (with tmux pane + worktree) → running → killed (tmux pane destroyed, worktree optionally removed)
- **Sub-panes**: Sessions can have additional editor (neovim) or terminal panes alongside the agent pane, tracked in `session.panes[]`
- **Workspaces**: Persistent named groups of sessions (`~/.cereus/workspaces.json`). When shown, arranges session panes in a tmux session using swap-pane with smart layout. A session can only be in one workspace at a time.
- **Display modes**: `smart` (auto-grid), `window`, `split`, `hidden` — controlled by the smart layout algorithm in `tmux.ts`
- **Pane border titles**: All cereus tmux sessions have `pane-border-status top` enabled, with pane titles set to session identifiers
- **Interactive setup**: First run detects missing config and walks user through setup via `@inquirer/prompts`
- **All tmux/git operations** use synchronous `execSync` calls

## Dashboard Key Bindings

- `j/k` or arrows — Navigate
- `l/h` — Expand/collapse repos, sessions, workspaces
- `Enter` — Attach to session (preview pane) or toggle expand
- `n` — New session
- `c` — New container session
- `p` — Add sub-pane (editor/terminal) to selected session
- `o` — Create new workspace
- `a` — Attach session to selected workspace
- `d` — Detach session from workspace
- `x` — Kill session or delete workspace
- `r` — Refresh
- `q` — Quit

## Release Process

Releases are automated via GitHub Actions (`.github/workflows/release.yml`). Running `bun run release` tags the current version from `package.json` and pushes the tag. CI then builds native binaries for 3 targets (darwin-arm64, linux-arm64, linux-x64) and creates a GitHub release with them attached. Cross-compilation is not supported due to `@opentui/core`'s platform-specific native bindings.
