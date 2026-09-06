import { Command } from "commander";
import { ConfigLoader } from "./config/config-loader.ts";
import { Scheduler as DataSourcesScheduler } from "./data-sources/changelog-lookup-scheduler.ts";
import { Scheduler as ReleaseAnalysisScheduler } from "./data-sources/release-analysis-scheduler.ts";
import { DependenciesModule } from "./dependencies/index.ts";
import { Scheduler as SuggestionsScheduler } from "./suggestions/suggestions-scheduler.ts";

const app = new Command();

app
  .name("apiweiser-cli")
  .description("")
  .option("-p, --path <path>", "project path")
  .option("--suggestions-cron <expression>", "run Renovate suggestions on a cron schedule")
  .option(
    "--data-sources-cron <expression>",
    "look up queued packages' changelog sources on a cron schedule",
  )
  .option(
    "--release-analysis-cron <expression>",
    'classify each package\'s latest release for breaking changes on a cron schedule (intended cadence: once a day, e.g. "0 0 * * *")',
  );

app.parse(process.argv);

const opts = app.opts();

if (opts.path) {
  const dependencies = new DependenciesModule();
  await dependencies.scan(opts.path);

  if (opts.suggestionsCron) {
    const config = new ConfigLoader().load();
    const scheduler = new SuggestionsScheduler(
      opts.path,
      opts.suggestionsCron,
      config.codingAgent,
      config.github,
    );
    scheduler.start();
  }
}

if (opts.dataSourcesCron) {
  const scheduler = new DataSourcesScheduler(opts.dataSourcesCron);
  scheduler.start();
}

if (opts.releaseAnalysisCron) {
  const config = new ConfigLoader().load();
  const scheduler = new ReleaseAnalysisScheduler(opts.releaseAnalysisCron, config.llm);
  scheduler.start();
}
