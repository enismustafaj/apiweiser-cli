// The fields CodemodSearch reads from `codemod search --format json`.
export interface CodemodSearchResponse {
  packages: { name: string; scope: string | null; latest_version: string }[];
}
