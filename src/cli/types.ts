export interface Command<Options, Result> {
  run(options: Options): Promise<Result>;
}
