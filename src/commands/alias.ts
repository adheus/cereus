import chalk from "chalk";
import { loadConfig, saveConfig } from "../lib/config.js";

export function aliasAdd(name: string, repoPath: string): void {
  const config = loadConfig();
  config.aliases[name] = repoPath;
  saveConfig(config);
  console.log(chalk.green("✔"), `Alias '${name}' → '${repoPath}'`);
}

export function aliasList(): void {
  const config = loadConfig();
  const aliases = Object.entries(config.aliases);

  if (aliases.length === 0) {
    console.log(chalk.blue("▸"), "No aliases configured.");
    return;
  }

  console.log(chalk.bold("Aliases:\n"));
  for (const [name, path] of aliases) {
    console.log(`  ${chalk.cyan(name)} → ${path}`);
  }
}

export function aliasRemove(name: string): void {
  const config = loadConfig();
  if (!config.aliases[name]) {
    console.error(chalk.red(`Alias '${name}' not found.`));
    process.exit(1);
  }
  delete config.aliases[name];
  saveConfig(config);
  console.log(chalk.green("✔"), `Alias '${name}' removed.`);
}
