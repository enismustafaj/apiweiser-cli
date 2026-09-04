import { Command } from "commander";
import { Scheduler as DataSourcesScheduler } from "./data-sources/scheduler.ts";
import { DependenciesModule } from "./dependencies/index.ts";
import { Scheduler as SuggestionsScheduler } from "./suggestions/scheduler.ts";

const app = new Command();

app
  .name("apiweiser-scanner")
  .description("")
  .option("-p, --path <path>", "project path")
  .option("--suggestions-cron <expression>", "run Renovate suggestions on a cron schedule")
  .option(
    "--data-sources-cron <expression>",
    "look up queued packages' changelog sources on a cron schedule",
  );

app.parse(process.argv);

const opts = app.opts();

if (opts.path) {
  const dependencies = new DependenciesModule();
  await dependencies.scan(opts.path);

  if (opts.suggestionsCron) {
    const scheduler = new SuggestionsScheduler(opts.path, opts.suggestionsCron);
    scheduler.start();
  }
}

if (opts.dataSourcesCron) {
  const scheduler = new DataSourcesScheduler(opts.dataSourcesCron);
  scheduler.start();
}
