#!/usr/bin/env node
import { Command, Option } from "commander";
import { execute } from "./cli/command.ts";
import { ChangelogCommand } from "./cli/commands/changelog/changelog-command.ts";
import { CodemodCommand } from "./cli/commands/codemod/codemod-command.ts";
import { PlanCommand } from "./cli/commands/plan/plan-command.ts";
import { SkillInstallCommand } from "./cli/commands/skill/skill-install-command.ts";
import { ScanCommand } from "./cli/commands/scan/scan-command.ts";
import { DashboardModule } from "./dashboard/index.ts";
import { db } from "./db/singleton.ts";
import type { Harness } from "./skills/types.ts";

const app = new Command();

app.name("apiweiser-cli").description("");

app
  .command("scan")
  .description("record a repo's dependencies and where each is called, print them as JSON")
  .requiredOption("-p, --path <path>", "local project path")
  .action((opts: { path: string }) => execute(new ScanCommand(db), opts));

app
  .command("plan")
  .description("group a scanned repo's available updates into upgrade groups, print them as JSON")
  .requiredOption("-p, --path <path>", "local project path")
  .option(
    "--package <name>",
    "only the groups containing this package (repeatable)",
    (name: string, names: string[]) => [...names, name],
    [],
  )
  .action((opts: { path: string; package: string[] }) =>
    execute(new PlanCommand(db), { path: opts.path, packages: opts.package }),
  );

app
  .command("changelog")
  .description("fetch the release notes between each group member's current and target version")
  .requiredOption("-p, --path <path>", "local project path")
  .requiredOption("-g, --group <id>", "a group id from `plan`, e.g. react@19.0.0+react-dom@19.0.0")
  .action((opts: { path: string; group: string }) => execute(new ChangelogCommand(db), opts));

app
  .command("codemod")
  .description("find the codemod for each group member's upgrade, locally and in the registry")
  .requiredOption("-p, --path <path>", "local project path")
  .requiredOption("-g, --group <id>", "a group id from `plan`, e.g. react@19.0.0+react-dom@19.0.0")
  .action((opts: { path: string; group: string }) => execute(new CodemodCommand(db), opts));

app
  .command("skill")
  .command("install")
  .description("install the upgrade-dependency and codemod skills for your coding agent")
  .addOption(
    new Option("--harness <harness>", "the coding agent (default: whichever is on PATH)").choices([
      "claude",
      "codex",
    ]),
  )
  .action((opts: { harness?: Harness }) => execute(new SkillInstallCommand(), opts));

app
  .command("dashboard")
  .option("--port <port>", "port to listen on", "3000")
  .action((opts: { port: string }) => {
    new DashboardModule().start(Number(opts.port));
  });

app.parse(process.argv);
