import { Command } from "commander";
import { newCommand } from "./commands/new.js";
import { listCommand } from "./commands/list.js";
import { attachCommand } from "./commands/attach.js";
import { killCommand } from "./commands/kill.js";
import { aliasAdd, aliasList, aliasRemove } from "./commands/alias.js";
import { configShow, configSet, runSetup } from "./commands/config.js";
import { dashboardCommand } from "./commands/dashboard.js";
import {
  paneAddCommand,
  paneListCommand,
  paneRemoveCommand,
} from "./commands/pane.js";
import {
  workspaceCreateCommand,
  workspaceListCommand,
  workspaceShowCommand,
  workspaceAttachCommand,
  workspaceDetachCommand,
  workspaceDeleteCommand,
} from "./commands/workspace.js";

const program = new Command();

program
  .name("cereus")
  .description(
    "Parallel AI coding sessions with git worktrees + tmux + agents",
  )
  .version("0.2.0");

program
  .command("new")
  .description("Create a new agent session in a worktree")
  .argument("<repo>", "Repository name (resolved from workspace)")
  .argument("<identifier>", "Session identifier (also used as branch name)")
  .option("--smart", "Smart split: fill panes then new window (default)")
  .option("--split", "Split current tmux pane")
  .option("--window", "Create new tmux window")
  .option("--hidden", "Run session in background")
  .option("--agent <command>", "Override agent CLI command")
  .option("--prompt <text>", "Initial prompt for the agent")
  .option("--from <branch>", "Base branch for the worktree (default: HEAD)")
  .option("--container", "Run agent inside a devcontainer")
  .action(newCommand);

program
  .command("list")
  .alias("ls")
  .description("List all active sessions")
  .action(listCommand);

program
  .command("attach")
  .description("Attach to an existing session")
  .argument("<identifier>", "Session identifier")
  .action(attachCommand);

program
  .command("kill")
  .description("Kill a session")
  .argument("[identifier]", "Session identifier")
  .option("--all", "Kill all sessions")
  .option("--clean", "Remove the git worktree without prompting")
  .option("-f, --force", "Skip all confirmation prompts")
  .action(killCommand);

program
  .command("dashboard")
  .alias("dash")
  .description("Open TUI dashboard for managing sessions")
  .action(dashboardCommand);

const pane = program
  .command("pane")
  .description("Manage sub-panes within a session");

pane
  .command("add")
  .description("Add a sub-pane (editor or terminal) to a session")
  .argument("<session>", "Session identifier")
  .option("--type <type>", "Pane type: editor, terminal", "terminal")
  .action(paneAddCommand);

pane
  .command("list")
  .alias("ls")
  .description("List sub-panes for a session")
  .argument("<session>", "Session identifier")
  .action(paneListCommand);

pane
  .command("remove")
  .alias("rm")
  .description("Remove a sub-pane from a session")
  .argument("<session>", "Session identifier")
  .argument("<pane-id>", "Pane ID to remove")
  .action(paneRemoveCommand);

const workspace = program
  .command("workspace")
  .alias("ws")
  .description("Manage session workspaces");

workspace
  .command("create")
  .description("Create a new workspace")
  .argument("<name>", "Workspace name")
  .option("--max-panes <n>", "Maximum panes in the workspace", parseInt)
  .action(workspaceCreateCommand);

workspace
  .command("list")
  .alias("ls")
  .description("List all workspaces")
  .action(workspaceListCommand);

workspace
  .command("show")
  .description("Open a workspace (arrange session panes)")
  .argument("<name>", "Workspace name")
  .action(workspaceShowCommand);

workspace
  .command("attach")
  .description("Attach a session to a workspace")
  .argument("<name>", "Workspace name")
  .argument("<session>", "Session identifier")
  .action(workspaceAttachCommand);

workspace
  .command("detach")
  .description("Detach a session from a workspace")
  .argument("<name>", "Workspace name")
  .argument("<session>", "Session identifier")
  .action(workspaceDetachCommand);

workspace
  .command("delete")
  .alias("rm")
  .description("Delete a workspace")
  .argument("<name>", "Workspace name")
  .action(workspaceDeleteCommand);

const alias = program
  .command("alias")
  .description("Manage repository aliases");

alias
  .command("add")
  .description("Add a repo alias")
  .argument("<name>", "Alias name")
  .argument("<path>", "Relative path in workspace")
  .action(aliasAdd);

alias
  .command("list")
  .description("List all aliases")
  .action(aliasList);

alias
  .command("remove")
  .description("Remove an alias")
  .argument("<name>", "Alias name")
  .action(aliasRemove);

const config = program
  .command("config")
  .description("View or edit configuration");

config
  .command("show")
  .description("Show current configuration")
  .action(configShow);

config
  .command("set")
  .description("Set a configuration value")
  .argument("<key>", "Config key (workspace, agent, agentArgs, defaultMode)")
  .argument("<value>", "Config value")
  .action(configSet);

config
  .command("setup")
  .description("Run interactive setup")
  .action(runSetup);

program.parseAsync().catch((err) => {
  if (err?.name === "ExitPromptError") {
    process.exit(0);
  }
  console.error(err?.message ?? err);
  process.exit(1);
});
