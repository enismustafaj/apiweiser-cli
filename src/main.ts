import { Command } from "commander";
import { ConfigLoader } from "./config/config-loader.ts";
import { DependenciesModule } from "./dependencies/index.ts";
import { Scheduler } from "./suggestions/scheduler.ts";

const app = new Command();

app
  .name("apiweiser-scanner")
  .description("")
  .option("-p, --path <path>", "project path")
  .option("--suggestions-cron <expression>", "run Renovate suggestions on a cron schedule");

app.parse(process.argv);

const opts = app.opts();

if (opts.path) {
  const config = new ConfigLoader().load();
  const dependencies = new DependenciesModule(config.llm);
  await dependencies.scan(opts.path);

  if (opts.suggestionsCron) {
    const scheduler = new Scheduler(opts.path, opts.suggestionsCron);
    scheduler.start();
  }
}
