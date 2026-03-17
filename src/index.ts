import { Command } from "commander";
import { newCommand } from "./commands/new.js";
import { listCommand } from "./commands/list.js";
import { attachCommand } from "./commands/attach.js";
import { killCommand } from "./commands/kill.js";
import { aliasAdd, aliasList, aliasRemove } from "./commands/alias.js";
import { configShow, configSet, runSetup } from "./commands/config.js";
import { dashboardCommand } from "./commands/dashboard.js";

const program = new Command();

program
  .name("agentmux")
  .description(
    "Parallel AI coding sessions with git worktrees + tmux + agents",
  )
  .version("0.1.0");

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
  .option("--split", "Attach as split pane")
  .option("--window", "Attach as new window")
  .action(attachCommand);

program
  .command("kill")
  .description("Kill a session")
  .argument("[identifier]", "Session identifier")
  .option("--all", "Kill all sessions")
  .option("--clean", "Also remove the git worktree")
  .option("-f, --force", "Skip confirmation prompt")
  .action(killCommand);

program
  .command("dashboard")
  .alias("dash")
  .description("Open TUI dashboard for managing sessions")
  .action(dashboardCommand);

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
