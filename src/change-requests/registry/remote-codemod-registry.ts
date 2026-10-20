// See docs/change-requests.md § Remote registry.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RemoteCodemodRegistryConfig } from "../../config/config.ts";

const execFileAsync = promisify(execFile);

export class RemoteCodemodRegistry {
  private readonly config: RemoteCodemodRegistryConfig;

  // Only constructible from a remote config, so scope and apiKey are
  // guaranteed by the type - ConfigLoader checked they're present.
  constructor(config: RemoteCodemodRegistryConfig) {
    this.config = config;
  }

  // Automatic, called right after a codemod's PR is actually opened (see
  // ChangeRequestsModule) - by that point it's already passed its own full
  // test suite (CodingAgentService.generateCodemod only reports success
  // after that), so there's no separate quality gate here.
  async publish(codemodPath: string): Promise<void> {
    await execFileAsync(
      "npx",
      ["--yes", "codemod", "login", "--api-key", this.config.apiKey, "--scope", this.config.scope],
      { maxBuffer: 1024 * 1024 * 5 },
    );
    await execFileAsync("npx", ["--yes", "codemod", "publish", codemodPath], {
      maxBuffer: 1024 * 1024 * 5,
    });
  }
}
