#!/usr/bin/env node
import { Command } from "commander";
import { ConfigLoader } from "./config/config-loader.ts";
import { DashboardModule } from "./dashboard/index.ts";
import { DataSourcesModule } from "./data-sources/index.ts";
import { DependenciesModule } from "./dependencies/index.ts";
import { DependencyInstaller } from "./dependencies/sbom/dependency-installer.ts";
import { RepoCloner } from "./github/tool/repo-cloner.ts";
import { ChangelogLookupJob } from "./jobs/changelog-lookup-job.ts";
import { Scheduler } from "./jobs/scheduler.ts";
import { SuggestionsJob } from "./jobs/suggestions-job.ts";
import { SuggestionsModule } from "./suggestions/index.ts";

const DAILY_CRON = "0 0 * * *";

const app = new Command();

app.name("apiweiser-cli").description("");

app
  .command("scan", { isDefault: true })
  .option("-p, --path <path>", "local project path")
  .option("-r, --repo <url>", "git URL of a repo to clone and scan instead of --path")
  .option("--once", "run every job once, right away, and exit instead of scheduling them daily")
  .action(async (opts: { path?: string; repo?: string; once?: boolean }) => {
    // true when both or neither are set
    if (!opts.path === !opts.repo) {
      console.error("Provide exactly one of --path or --repo.");
      process.exit(1);
    }

    const config = new ConfigLoader().load();

    let repoPath: string;
    if (opts.repo) {
      repoPath = await new RepoCloner(config.github).cloneOrPull(opts.repo);
      await new DependencyInstaller().install(repoPath);
    } else {
      repoPath = opts.path!;
    }

    const dependencies = new DependenciesModule();
    await dependencies.scan(repoPath);

    const scheduler = new Scheduler(DAILY_CRON, [
      new ChangelogLookupJob(new DataSourcesModule()),
      new SuggestionsJob(new SuggestionsModule(config), repoPath),
    ]);

    if (opts.once) {
      await scheduler.runAll();
    } else {
      scheduler.start();
    }
  });

app
  .command("dashboard")
  .option("--port <port>", "port to listen on", "3000")
  .action((opts: { port: string }) => {
    new DashboardModule().start(Number(opts.port));
  });

app.parse(process.argv);
