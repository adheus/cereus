# Agentmux Roadmap

## v0.1 — Foundation (current)
- [x] CLI with `new`, `list`, `attach`, `kill`, `alias`, `config` commands
- [x] Git worktree creation per session
- [x] Tmux session management (window / split / hidden modes)
- [x] Config file with workspace root, default agent, aliases
- [x] Session tracking in sessions.json
- [x] AGENTMUX.md context file in worktrees
- [x] First-time interactive setup

## v0.2 — Polish & Reliability
- [ ] Session auto-cleanup (detect dead tmux sessions on `list`)
- [ ] `agentmux logs <identifier>` command to capture pane output
- [ ] Better error messages and edge case handling
- [ ] Support for `--base <branch>` to set worktree base branch
- [ ] Pass session context (other active sessions) to agent prompt
- [ ] Add `--model` flag pass-through to agent CLI
- [ ] Shell completions (zsh/bash)

## v0.3 — Multi-Agent Workflows
- [ ] Agent-to-agent awareness (shared context across sessions)
- [ ] Session groups / pipelines (chain tasks)
- [ ] Prompt templates for common workflows
- [ ] Session history / audit log
- [ ] Worktree setup hooks (auto-install deps, run build, etc.)

## v0.4 — TUI Dashboard
- [ ] Terminal UI for managing sessions (opentui or similar)
- [ ] Live session status monitoring
- [ ] Log streaming from active sessions
- [ ] Session switching from TUI
- [ ] Split-view for multiple session outputs

## Future Ideas
- [ ] Remote session support (SSH + tmux)
- [ ] CI/CD integration (headless agent runs)
- [ ] Plugin system for custom agent CLIs
- [ ] Session snapshots / restore
- [ ] Cost tracking per session (token usage)
- [ ] Web dashboard alternative
- [ ] npm publish for global install
