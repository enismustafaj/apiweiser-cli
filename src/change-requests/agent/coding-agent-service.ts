import { execFile } from "node:child_process";
import { promisify } from "node:util";
import semver from "semver";
import type { CodingAgentConfig } from "../../config/config.ts";
import type { CallSite } from "../../dependencies/types.ts";
import { CodemodRegistry } from "../registry/codemod-registry.ts";
import type { ChangeRequestInput, ChangeRequestPackage, CodemodResult } from "../types.ts";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "CODEMOD_RESULT:";

const MAX_CALL_SITES_PER_SURFACE = 3;

export class CodingAgentService {
  private readonly config: CodingAgentConfig;
  private readonly registry: CodemodRegistry = new CodemodRegistry();

  constructor(config: CodingAgentConfig) {
    this.config = config;
  }

  async generateCodemod(input: ChangeRequestInput): Promise<CodemodResult> {
    const { label, fromVersion, toVersion } = this.registryKey(input.packages);
    const codemodPath = this.registry.pathFor(label, fromVersion, toVersion);
    const prompt = this.buildPrompt(input, codemodPath);

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(this.config.command, [...this.config.args, prompt], {
        cwd: codemodPath,
        maxBuffer: 1024 * 1024 * 50,
      }));
    } catch (err) {
      const errStdout = this.stdoutOf(err);
      console.error(
        `CodingAgentService: agent process failed for "${label}". stdout:\n${errStdout}`,
      );
      return {
        success: false,
        codemodPath,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    return this.parseResult(stdout, codemodPath);
  }

  // Multi-package groups are always scope-siblings grouped together because
  // they must move together (see SuggestionsModule § Grouping scoped
  // packages) - the shared scope (e.g. "@angular") is a natural single
  // registry key, and the widest version span across the group is a
  // reasonable stand-in for "this exact upgrade" when members don't all
  // move by the exact same amount (e.g. @angular/core 5->20 but
  // @angular/router 5->22).
  private registryKey(packages: ChangeRequestPackage[]): {
    label: string;
    fromVersion: string;
    toVersion: string;
  } {
    if (packages.length === 1) {
      const pkg = packages[0]!;
      return { label: pkg.name, fromVersion: pkg.version, toVersion: pkg.newVersion };
    }

    const first = packages[0]!.name;
    const label = first.startsWith("@")
      ? first.split("/")[0]!
      : packages.map((p) => p.name).join("+");
    return {
      label,
      fromVersion: this.extreme(
        packages.map((p) => p.version),
        "lt",
      ),
      toVersion: this.extreme(
        packages.map((p) => p.newVersion),
        "gt",
      ),
    };
  }

  private extreme(versions: string[], keep: "lt" | "gt"): string {
    return versions.reduce((current, candidate) => {
      const a = semver.coerce(candidate);
      const b = semver.coerce(current);
      if (!a || !b) return current;
      return (keep === "lt" ? semver.lt(a, b) : semver.gt(a, b)) ? candidate : current;
    });
  }

  private buildPrompt(input: ChangeRequestInput, codemodPath: string): string {
    const callSitesSection = input.isDevDependency
      ? this.buildDevDependencySection(input)
      : this.buildCallSitesSection(input);
    // Matches whichever noun the section above actually used, so the
    // shared instructions below read naturally either way.
    const sitesRef = input.isDevDependency ? "usages you find" : "call sites above";
    const packageNames = input.packages.map((pkg) => `"${pkg.name}"`).join(", ");

    return `/codemod

Build a codemod package that migrates ${this.describePackages(input.packages)},
based on this changelog summary of what changed:

${input.summary}

${callSitesSection}

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
the same upgrade. If one exists, inspect it against the ${sitesRef}: if it
already covers them, verify it still passes and stop there; if it doesn't
(e.g. it only handles a different import style, or missed part of the API
surface), extend it rather than starting over. If nothing exists yet,
scaffold fresh here - \`codemod init . --no-interactive\`.

If extending: do not delete or modify any existing fixture under tests/ -
those are what keep this codemod correct for every repo that has already
used it, not just this one. Only add new fixtures alongside them.

Either way, use the codemod skill's normal workflow: implement (or extend)
an AST-based transform, add fixtures from the ${sitesRef}, and run the
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

  private describePackages(packages: ChangeRequestPackage[]): string {
    if (packages.length === 1) {
      const pkg = packages[0]!;
      return `"${pkg.name}"@${pkg.version} to @${pkg.newVersion}`;
    }
    const list = packages
      .map((pkg) => `- "${pkg.name}"@${pkg.version} to @${pkg.newVersion}`)
      .join("\n");
    return `the following packages, which must be upgraded together (they're\nscope-siblings that peer-depend on each other at matching versions):\n${list}`;
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

  // devDependencies are never scanned for call sites (see
  // DependenciesModule.scan) - real usage doesn't show up the same way for
  // dev tooling (config files, scripts, other devDependencies' own type
  // declarations), so there's no sample list to hand over. The changelog
  // summary above plus the agent's own read of the repo is the only input.
  private buildDevDependencySection(input: ChangeRequestInput): string {
    const packageNames = input.packages.map((pkg) => `"${pkg.name}"`).join(", ");
    return `${packageNames} ${input.packages.length === 1 ? "is a" : "are"} devDependency - no call
sites were tracked for it (dev tooling isn't scanned as application API
usage the same way a runtime dependency is). Inspect this repo yourself
(config files, package.json scripts, CI config, other code that references
${packageNames}) to figure out what, if anything, actually needs to
change for this upgrade, based on the changelog summary above. If nothing
in this repo needs to change, that's a valid outcome - report success with
an empty transform rather than inventing a change that isn't needed.`;
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
      console.error(
        `CodingAgentService: agent produced no ${RESULT_MARKER} line, treating as failure. Raw output:\n${stdout}`,
      );
      return { success: false, codemodPath, reason: "agent did not report a result" };
    }

    try {
      const json = line.slice(line.indexOf(RESULT_MARKER) + RESULT_MARKER.length).trim();
      const result = JSON.parse(json) as CodemodResult;
      // codemodPath last: our own value wins over whatever the agent echoed.
      return { ...result, codemodPath };
    } catch (err) {
      console.error(`CodingAgentService: couldn't parse agent result line "${line}":`, err);
      return { success: false, codemodPath, reason: "agent result line wasn't valid JSON" };
    }
  }

  private stdoutOf(err: unknown): string {
    if (err && typeof err === "object" && "stdout" in err) {
      return String((err as { stdout: unknown }).stdout);
    }
    return "";
  }
}
