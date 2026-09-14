#!/usr/bin/env node
import { Command } from "commander";
import { ConfigLoader } from "./config/config-loader.ts";
import { Scheduler as DataSourcesScheduler } from "./data-sources/changelog-lookup-scheduler.ts";
import { Scheduler as ReleaseAnalysisScheduler } from "./data-sources/release-analysis-scheduler.ts";
import { DashboardModule } from "./dashboard/index.ts";
import { DependenciesModule } from "./dependencies/index.ts";
import { RepoCloner } from "./github/tool/repo-cloner.ts";
import { Scheduler as SuggestionsScheduler } from "./suggestions/suggestions-scheduler.ts";

const DAILY_CRON = "0 0 * * *";

const app = new Command();

app.name("apiweiser-cli").description("");

app
  .command("scan", { isDefault: true })
  .option("-p, --path <path>", "local project path")
  .option("-r, --repo <url>", "git URL of a repo to clone and scan instead of --path")
  .action(async (opts: { path?: string; repo?: string }) => {
    // true when both or neither are set
    if (!opts.path === !opts.repo) {
      console.error("Provide exactly one of --path or --repo.");
      process.exit(1);
    }

    const config = new ConfigLoader().load();

    const repoPath = opts.repo
      ? await new RepoCloner(config.github).cloneOrPull(opts.repo)
      : opts.path!;

    const dependencies = new DependenciesModule();
    await dependencies.scan(repoPath);

    new DataSourcesScheduler(DAILY_CRON).start();
    new ReleaseAnalysisScheduler(DAILY_CRON, config.llm).start();
    new SuggestionsScheduler(repoPath, DAILY_CRON, config.codingAgent, config.github).start();
  });

app
  .command("dashboard")
  .option("--port <port>", "port to listen on", "3000")
  .action((opts: { port: string }) => {
    new DashboardModule().start(Number(opts.port));
  });

app.parse(process.argv);
