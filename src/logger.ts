const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function threshold(): number {
  return LEVELS[process.env.LOG_LEVEL as LogLevel] ?? LEVELS.info;
}

export function logger(scope: string): Logger {
  const at =
    (level: LogLevel) =>
    (...args: unknown[]): void => {
      if (LEVELS[level] < threshold()) return;
      // Every level goes to stderr: stdout is reserved for a command's
      // JSON result, so it can be piped straight into a parser.
      console.error(
        `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}]`,
        ...args,
      );
    };

  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}
