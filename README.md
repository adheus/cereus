# cereus

```
 _  _
| || | _
| || || |
| || || |-
 \_  || |
   |  _/
  -| | \
   |_|-
```

Parallel AI coding sessions powered by **git worktrees** + **tmux** + **AI agents**.

Run multiple AI agents side-by-side, each in its own isolated branch and worktree, all managed through tmux — from a single terminal.

## Why

When you're working on a codebase and want to tackle multiple tasks in parallel with AI agents, you need isolation. Each agent needs its own branch, its own working directory, and its own terminal. Setting that up manually is tedious.

**cereus** does it in one command:

```bash
cereus new my-app fix-auth --prompt "Fix the authentication bug in login.ts"
cereus new my-app add-tests --prompt "Add unit tests for the user service"
```

Each session gets a git worktree (isolated branch + working copy), a tmux pane, and an AI agent running inside it. Smart mode automatically arranges panes in a grid layout.

## Install

```bash
bun install -g cereus
```

### Prerequisites

- [Bun](https://bun.sh/)
- [tmux](https://github.com/tmux/tmux)
- [git](https://git-scm.com/)
- An agent CLI (e.g. [cursor-agent](https://docs.cursor.com/agent), [claude](https://claude.ai), or any command)

## Quick Start

```bash
# First run — interactive setup
cereus config setup

# Start a session
cereus new my-app fix-auth --prompt "Fix the auth bug in login.ts"

# Start another in parallel
cereus new my-app add-tests --prompt "Add unit tests for user service"

# See what's running
cereus list

# Jump into a session
cereus attach fix-auth

# Kill a session (--clean removes the worktree too)
cereus kill fix-auth --clean

# Kill everything
cereus kill --all --clean --force
```

## Commands

### `cereus new <repo> <identifier>`

Create a new session with a git worktree, tmux pane, and agent.

```
Options:
  --smart            Smart split: fill panes then new window (default)
  --split            Split current tmux pane
  --window           Create new tmux window
  --hidden           Run session in background
  --agent <command>  Override agent CLI command
  --prompt <text>    Initial prompt for the agent
  --from <branch>    Base branch for the worktree (default: HEAD)
```

**Repo resolution**: cereus looks for the repo in your configured workspace. It checks aliases first, then scans directories up to 3 levels deep. If not found, it prompts you to clone or create one.

### `cereus list`

List all active sessions with their status, mode, agent, and prompt.

```bash
cereus list    # or: cereus ls
```

### `cereus attach <identifier>`

Attach to an existing session's tmux pane.

```
Options:
  --split   Attach as split pane
  --window  Attach as new window
```

### `cereus kill [identifier]`

Kill a session. You'll be prompted whether to also remove the worktree.

```
Options:
  --all     Kill all sessions
  --clean   Remove the git worktree without prompting
  -f        Skip all confirmation prompts (keeps worktree)
```

### `cereus alias`

Manage repo aliases for quick access.

```bash
cereus alias add myapp somecompany/myapp
cereus alias list
cereus alias remove myapp
```

### `cereus dashboard`

Open an interactive TUI sidebar for managing sessions. Requires [Bun](https://bun.sh/) runtime and must be run inside tmux.

```bash
cereus dashboard
```

Browse sessions, attach to them in a side pane, create new sessions, and kill sessions — all from a vim-style keyboard interface.

### `cereus config`

View or edit configuration.

```bash
cereus config show
cereus config set defaultMode smart
cereus config set maxPanesPerWindow 4
cereus config setup   # interactive setup
```

## Smart Mode

The default mode. Automatically arranges agent panes in a grid layout within your current tmux window:

```
┌─────────────┐    ┌──────┬──────┐    ┌──────┬──────┐    ┌──────┬──────┐
│             │    │      │      │    │      │  2   │    │  1   │  2   │
│      1      │ →  │  1   │  2   │ →  │  1   ├──────┤ →  ├──────┼──────┤
│             │    │      │      │    │      │  3   │    │  4   │  3   │
└─────────────┘    └──────┴──────┘    └──────┴──────┘    └──────┴──────┘
   1 session          2 sessions        3 sessions          4 sessions
```

Once the window reaches `maxPanesPerWindow` (default: 4), the next session opens in a new window.

## Configuration

Stored at `~/.cereus/config.json`:

```json
{
  "workspace": "~/projects",
  "agent": "cursor-agent",
  "agentArgs": [],
  "defaultMode": "smart",
  "defaultBaseBranch": "HEAD",
  "maxPanesPerWindow": 4,
  "aliases": {
    "myapp": "somecompany/myapp"
  }
}
```

| Key | Description | Default |
|-----|-------------|---------|
| `workspace` | Root directory where your repos live | `~/projects` |
| `agent` | Default agent CLI command | `cursor-agent` |
| `agentArgs` | Default arguments passed to the agent | `[]` |
| `defaultMode` | Session display mode (`smart`, `window`, `split`, `hidden`) | `smart` |
| `defaultBaseBranch` | Base branch for new worktrees | `HEAD` |
| `maxPanesPerWindow` | Max panes before creating a new window (smart mode) | `4` |
| `aliases` | Repo name shortcuts | `{}` |

## Agent Context

Each worktree gets an `CEREUS.md` file with session context — so if you run an agent manually inside a worktree, it can pick up what cereus is, what other sessions are running, and how to use the CLI.

Session data is tracked in `~/.cereus/sessions.json`.

## License

MIT
