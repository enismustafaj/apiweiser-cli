import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodemodSearchResponse } from "../types.ts";

const execFileAsync = promisify(execFile);

export class CodemodSearch {
  // An exact name match only - the name is CodemodRegistry.remoteName, so a
  // match is the same upgrade, never just a similar one. Returns a spec
  // `codemod run` takes as is, e.g. "@apiweiser/react-18-to-19@1.2.0".
  async findExact(name: string, scope: string): Promise<string | null> {
    const { stdout } = await execFileAsync(
      "npx",
      ["--yes", "codemod", "search", name, "--scope", scope, "--format", "json"],
      { maxBuffer: 1024 * 1024 * 5 },
    );
    const response = JSON.parse(stdout) as CodemodSearchResponse;
    const match = response.packages.find((pkg) => pkg.name === name && pkg.scope === scope);
    return match ? `@${scope}/${match.name}@${match.latest_version}` : null;
  }
}
