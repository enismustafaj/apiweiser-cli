import { logger } from "../logger.ts";
import type { Command } from "./types.ts";

const log = logger("cli");

export async function execute<Options, Result>(
  command: Command<Options, Result>,
  options: Options,
): Promise<void> {
  try {
    const result = await command.run(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
