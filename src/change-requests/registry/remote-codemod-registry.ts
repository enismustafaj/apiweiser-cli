// See docs/change-requests.md § Remote registry.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodemodRegistryConfig } from "../../config/config.ts";

const execFileAsync = promisify(execFile);

export class RemoteCodemodRegistry {
  private readonly config?: CodemodRegistryConfig;

  constructor(config?: CodemodRegistryConfig) {
    this.config = config;
  }

  // Automatic, called right after a codemod's PR is actually opened (see
  // ChangeRequestsModule) - by that point it's already passed its own full
  // test suite (CodingAgentService.generateCodemod only reports success
  // after that), so there's no separate quality gate here. Requires
  // mode: "remote" plus both `scope` and `apiKey` - `ConfigLoader` already
  // validates that combination for a config loaded normally, but this
  // guard stays here too since the class can be constructed directly
  // (e.g. in tests) without going through that validation.
  async publish(codemodPath: string): Promise<void> {
    if (this.config?.mode !== "remote" || !this.config.scope || !this.config.apiKey) {
      throw new Error(
        'RemoteCodemodRegistry: publish needs codemodRegistry.mode: "remote" with both ' +
          "scope and apiKey configured - see docs/change-requests.md § Remote registry.",
      );
    }

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
