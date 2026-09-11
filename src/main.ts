#!/usr/bin/env node
import { Command } from "commander";
import { ConfigLoader } from "./config/config-loader.ts";
import { Scheduler as DataSourcesScheduler } from "./data-sources/changelog-lookup-scheduler.ts";
import { Scheduler as ReleaseAnalysisScheduler } from "./data-sources/release-analysis-scheduler.ts";
import { DashboardModule } from "./dashboard/index.ts";
import { DependenciesModule } from "./dependencies/index.ts";
import { Scheduler as SuggestionsScheduler } from "./suggestions/suggestions-scheduler.ts";

const DAILY_CRON = "0 0 * * *";

const app = new Command();

app.name("apiweiser-cli").description("");

app
  .command("scan", { isDefault: true })
  .requiredOption("-p, --path <path>", "project path")
  .action(async (opts: { path: string }) => {
    const config = new ConfigLoader().load();

    const dependencies = new DependenciesModule();
    await dependencies.scan(opts.path);

    new DataSourcesScheduler(DAILY_CRON).start();
    new ReleaseAnalysisScheduler(DAILY_CRON, config.llm).start();
    new SuggestionsScheduler(opts.path, DAILY_CRON, config.codingAgent, config.github).start();
  });

app
  .command("dashboard")
  .option("--port <port>", "port to listen on", "3000")
  .action((opts: { port: string }) => {
    new DashboardModule().start(Number(opts.port));
  });

app.parse(process.argv);
