import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CodemodRegistryConfig, CodingAgentConfig } from "../../config/config.ts";
import type { CallSite } from "../../dependencies/types.ts";
import { logger } from "../../logger.ts";
import { registryKeyFor } from "../registry-key.ts";
import { CodemodRegistry } from "../registry/codemod-registry.ts";
import type { ChangeRequestInput, ChangeRequestPackage, CodemodResult } from "../types.ts";

const execFileAsync = promisify(execFile);

const log = logger("coding-agent");

const RESULT_MARKER = "CODEMOD_RESULT:";

const MAX_CALL_SITES_PER_SURFACE = 3;

const LOGS_DIR = join(homedir(), ".apiweiser-cli", "logs");

export class CodingAgentService {
  private readonly config: CodingAgentConfig;
  private readonly registry: CodemodRegistry = new CodemodRegistry();
  private readonly codemodRegistryConfig: CodemodRegistryConfig;
  private readonly logsDir: string;

  constructor(
    config: CodingAgentConfig,
    codemodRegistryConfig: CodemodRegistryConfig = { mode: "local" },
    logsDir: string = LOGS_DIR,
  ) {
    this.config = config;
    this.codemodRegistryConfig = codemodRegistryConfig;
    this.logsDir = logsDir;
  }

  async generateCodemod(input: ChangeRequestInput): Promise<CodemodResult> {
    const { label, fromVersion, toVersion } = registryKeyFor(input.packages);
    const codemodPath = this.registry.pathFor(label, fromVersion, toVersion);
    const remoteName = this.registry.remoteName(label, fromVersion, toVersion);
    const prompt = this.buildPrompt(input, codemodPath, remoteName);

    let output: string;
    let result: CodemodResult;
    try {
      const { stdout, stderr } = await execFileAsync(
        this.config.command,
        [...this.config.args, prompt],
        { cwd: codemodPath, maxBuffer: 1024 * 1024 * 50 },
      );
      output = `${stdout}\n--- stderr ---\n${stderr}`;
      result = this.parseResult(stdout, codemodPath);
    } catch (err) {
      output = this.outputOf(err);
      result = {
        success: false,
        codemodPath,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (!result.success) {
      const file = await this.saveOutput(label, output);
      log.error(`Agent failed for "${label}" (${result.reason}). Full output: ${file}`);
    }
    return result;
  }

  // Up to 50 MB of transcript - too much for the console, but the only way
  // to see why the agent gave up.
  private async saveOutput(label: string, output: string): Promise<string> {
    await mkdir(this.logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(this.logsDir, `${label.replace(/[^\w.-]+/g, "_")}-${stamp}.log`);
    await writeFile(file, output);
    return file;
  }

  private buildPrompt(input: ChangeRequestInput, codemodPath: string, remoteName: string): string {
    const callSitesSection = this.buildCallSitesSection(input);
    const packageNames = input.packages.map((pkg) => `"${pkg.name}"`).join(", ");

    return `/codemod

Build a codemod package that migrates ${this.describePackages(input.packages)},
based on this changelog summary of what changed:

${input.summary}

${callSitesSection}

The repository being migrated is at "${input.repoPath}". Read from it as
needed, but don't modify it - the finished codemod is applied to it
separately, after you're done.

This codemod package will be stored in a shared local registry and reused
against other repos beyond this one, so don't special-case the transform
to only the exact import style seen above - handle every common way
${packageNames} gets imported in real code (default import,
namespace import (\`import * as x from "..."\`), named/destructured import,
and \`require(...)\`, whichever apply to this package), not just whichever
one this sample happens to use.

The current working directory ("${codemodPath}") is this exact upgrade's
slot in a shared local registry - check first whether a codemod package
already exists here (e.g. a \`codemod.yaml\`) from a previous repo that hit
the same upgrade. If one exists, inspect it against the call sites above: if it
already covers them, verify it still passes and stop there; if it doesn't
(e.g. it only handles a different import style, or missed part of the API
surface), extend it rather than starting over. If nothing exists yet,
scaffold fresh here - \`codemod init . --no-interactive\`.
${this.remoteRegistrySection(remoteName, input.repoPath)}
If extending: do not delete or modify any existing fixture under tests/ -
those are what keep this codemod correct for every repo that has already
used it, not just this one. Only add new fixtures alongside them.

Either way, use the codemod skill's normal workflow: implement (or extend)
an AST-based transform, add fixtures from the call sites above, and run the
codemod's *entire* test suite - every existing fixture plus the new ones,
via \`run_jssg_tests\`/\`validate_codemod_package\`, not a filtered or
partial run - iterating until all of it is green. Do not stop until it is,
and do not report success unless the full suite (not just the fixtures you
added) passed.

When finished, print exactly one line, with nothing else after it, starting
with "${RESULT_MARKER}" followed by JSON matching
{ "success": boolean, "codemodPath": string, "reason"?: string } -
"reason" only if success is false, explaining why you gave up.`;
  }

  private remoteRegistrySection(remoteName: string, repoPath: string): string {
    if (this.codemodRegistryConfig.mode !== "remote") return "";

    return `
Also check the public codemod registry before scaffolding fresh -
\`npx codemod search "${remoteName}" --scope "${this.codemodRegistryConfig.scope}" --format json\`.
If a package named exactly "${remoteName}" exists there, inspect it the
same way you would a local entry (e.g. dry-run it against the repository -
\`npx codemod run "<name>@<version>" --target "${repoPath}" --dry-run --no-interactive\`)
and judge for yourself whether it actually covers the call sites/usages
above: reuse or adapt it if so, treat it only as a reference if it's
partial, or ignore it and scaffold fresh here if it doesn't apply. Don't
assume a name match means it's usable - verify it the same way you'd
verify a local entry.
`;
  }

  private describePackages(packages: ChangeRequestPackage[]): string {
    if (packages.length === 1) {
      const pkg = packages[0]!;
      return `"${pkg.name}"@${pkg.version} to @${pkg.newVersion}`;
    }
    const list = packages
      .map((pkg) => `- "${pkg.name}"@${pkg.version} to @${pkg.newVersion}`)
      .join("\n");
    return `the following packages, which must be upgraded together (their peer\ndependencies on each other mean none can be installed at its new version alone):\n${list}`;
  }

  private buildCallSitesSection(input: ChangeRequestInput): string {
    const sampledCallSites = this.sampleCallSites(input.callSites);
    const callSites = sampledCallSites
      .map((site) => `- ${site.file}:${site.line} — ${site.snippet} (${site.apiSurface})`)
      .join("\n");
    const truncated = sampledCallSites.length < input.callSites.length;

    return `Call sites to migrate${
      truncated
        ? ` (showing ${sampledCallSites.length} of ${input.callSites.length} total, up to ${MAX_CALL_SITES_PER_SURFACE} per distinct API surface - inspect the surrounding files yourself for the rest)`
        : " (also inspect the surrounding files yourself - this list may not be exhaustive)"
    }:
${callSites}`;
  }

  private sampleCallSites(callSites: CallSite[]): CallSite[] {
    const seenPerSurface = new Map<string, number>();
    const sample: CallSite[] = [];
    for (const site of callSites) {
      const count = seenPerSurface.get(site.apiSurface) ?? 0;
      if (count >= MAX_CALL_SITES_PER_SURFACE) continue;
      seenPerSurface.set(site.apiSurface, count + 1);
      sample.push(site);
    }
    return sample;
  }

  private parseResult(stdout: string, codemodPath: string): CodemodResult {
    const line = stdout
      .split("\n")
      .reverse()
      .find((candidate) => candidate.includes(RESULT_MARKER));

    if (!line) {
      return { success: false, codemodPath, reason: "agent did not report a result" };
    }

    try {
      const json = line.slice(line.indexOf(RESULT_MARKER) + RESULT_MARKER.length).trim();
      const result = JSON.parse(json) as CodemodResult;
      // codemodPath last: our own value wins over whatever the agent echoed.
      return { ...result, codemodPath };
    } catch {
      return { success: false, codemodPath, reason: "agent result line wasn't valid JSON" };
    }
  }

  private outputOf(err: unknown): string {
    const { stdout = "", stderr = "" } = (err ?? {}) as { stdout?: unknown; stderr?: unknown };
    return `${String(stdout)}\n--- stderr ---\n${String(stderr)}`;
  }
}
