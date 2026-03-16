# agentmux

Parallel AI coding sessions powered by **git worktrees** + **tmux** + **AI agents**.

Run multiple AI agents side-by-side, each in its own isolated branch and worktree, all managed through tmux — from a single terminal.

## Why

When you're working on a codebase and want to tackle multiple tasks in parallel with AI agents, you need isolation. Each agent needs its own branch, its own working directory, and its own terminal. Setting that up manually is tedious.

**agentmux** does it in one command:

```bash
agentmux new my-app fix-auth --prompt "Fix the authentication bug in login.ts"
agentmux new my-app add-tests --prompt "Add unit tests for the user service"
```

Each session gets a git worktree (isolated branch + working copy), a tmux pane, and an AI agent running inside it. Smart mode automatically arranges panes in a grid layout.

## Install

```bash
# Clone and install globally
git clone https://github.com/adheus/agentmux.git
cd agentmux
npm install
npm run build
npm link
```

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [tmux](https://github.com/tmux/tmux)
- [git](https://git-scm.com/)
- An agent CLI (e.g. [cursor-agent](https://docs.cursor.com/agent), [claude](https://claude.ai), or any command)

## Quick Start

```bash
# First run — interactive setup
agentmux config setup

# Start a session
agentmux new my-app fix-auth --prompt "Fix the auth bug in login.ts"

# Start another in parallel
agentmux new my-app add-tests --prompt "Add unit tests for user service"

# See what's running
agentmux list

# Jump into a session
agentmux attach fix-auth

# Kill a session (--clean removes the worktree too)
agentmux kill fix-auth --clean

# Kill everything
agentmux kill --all --clean --force
```

## Commands

### `agentmux new <repo> <identifier>`

Create a new session with a git worktree, tmux pane, and agent.

```
Options:
  --smart            Smart split: fill panes then new window (default)
  --split            Split current tmux pane
  --window           Create new tmux window
  --hidden           Run session in background
  --agent <command>  Override agent CLI command
  --prompt <text>    Initial prompt for the agent
```

**Repo resolution**: agentmux looks for the repo in your configured workspace. It checks aliases first, then scans directories up to 3 levels deep. If not found, it prompts you to clone or create one.

### `agentmux list`

List all active sessions with their status, mode, agent, and prompt.

```bash
agentmux list    # or: agentmux ls
```

### `agentmux attach <identifier>`

Attach to an existing session's tmux pane.

```
Options:
  --split   Attach as split pane
  --window  Attach as new window
```

### `agentmux kill [identifier]`

Kill a session and optionally clean up its worktree.

```
Options:
  --all     Kill all sessions
  --clean   Also remove the git worktree
  -f        Skip confirmation prompt
```

### `agentmux alias`

Manage repo aliases for quick access.

```bash
agentmux alias add myapp somecompany/myapp
agentmux alias list
agentmux alias remove myapp
```

### `agentmux config`

View or edit configuration.

```bash
agentmux config show
agentmux config set defaultMode smart
agentmux config set maxPanesPerWindow 4
agentmux config setup   # interactive setup
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

Stored at `~/.agentmux/config.json`:

```json
{
  "workspace": "~/projects",
  "agent": "cursor-agent",
  "agentArgs": [],
  "defaultMode": "smart",
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
| `maxPanesPerWindow` | Max panes before creating a new window (smart mode) | `4` |
| `aliases` | Repo name shortcuts | `{}` |

## Agent Context

Each worktree gets an `AGENTMUX.md` file with session context — so if you run an agent manually inside a worktree, it can pick up what agentmux is, what other sessions are running, and how to use the CLI.

Session data is tracked in `~/.agentmux/sessions.json`.

## License

MIT
