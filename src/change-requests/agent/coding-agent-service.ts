// Asks a configured coding agent (Claude Code, Codex, ...) to build a
// codemod package for a breaking package upgrade, "the codemod way": the
// agent uses the codemod CLI's AI skill/MCP tools (installed once,
// user-scoped, via `npx codemod ai --harness <claude|codex> --user` - see
// install.sh and docs/change-requests.md) to scaffold a package with
// `codemod init`, implement an AST-based transform, and iterate against
// its own tests until they pass - that loop happens *inside* the agent's
// own session, driven by the skill's instructions, not by this class.
// This class only spawns the agent process, once, and waits for it to
// finish - same subprocess-and-wait shape as SbomTool/RenovateTool.
//
// cwd is the codemod's own registry path directly - a user-scoped skill
// install resolves the /codemod command regardless of cwd (verified
// directly, from a throwaway directory with no project config at all),
// unlike a --project-scoped install, which only resolves from the
// specific directory it was installed into. That's the whole reason this
// installs --user, not --project: a globally-installed CLI has no
// "project" of its own to scope it to.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodingAgentConfig } from "../../config/config.ts";
import { CodemodRegistry } from "../registry/codemod-registry.ts";
import type { ChangeRequestInput, CodemodResult } from "../types.ts";

const execFileAsync = promisify(execFile);

// The agent's session output is a transcript, not structured data - this is
// the contract asked of it (see buildPrompt) so the result can be parsed
// instead of scraped from prose.
const RESULT_MARKER = "CODEMOD_RESULT:";

export class CodingAgentService {
  private readonly config: CodingAgentConfig;
  private readonly registry: CodemodRegistry = new CodemodRegistry();

  constructor(config: CodingAgentConfig) {
    this.config = config;
  }

  async generateCodemod(input: ChangeRequestInput): Promise<CodemodResult> {
    const codemodPath = this.registry.pathFor(input.packageName, input.version, input.newVersion);
    const prompt = this.buildPrompt(input, codemodPath);

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(this.config.command, [...this.config.args, prompt], {
        cwd: codemodPath,
        maxBuffer: 1024 * 1024 * 50,
      }));
    } catch (err) {
      // A non-zero exit here still carries everything the agent printed
      // before it gave up, on err.stdout - Node attaches it directly to the
      // error object (same shape as a successful exec's result). Logging it
      // is the only way to see what actually happened; err.message alone is
      // just "Command failed: <argv>" plus stderr, which doesn't include it.
      const errStdout = this.stdoutOf(err);
      console.error(
        `CodingAgentService: agent process failed for "${input.packageName}". stdout:\n${errStdout}`,
      );
      return {
        success: false,
        codemodPath,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    return this.parseResult(stdout, codemodPath);
  }

  private buildPrompt(input: ChangeRequestInput, codemodPath: string): string {
    const callSites = input.callSites
      .map((site) => `- ${site.file}:${site.line} — ${site.snippet} (${site.apiSurface})`)
      .join("\n");

    return `/codemod

Build a codemod package that migrates all call sites below from
"${input.packageName}"@${input.version} to @${input.newVersion}, based on
this changelog summary of what changed:

${input.summary}

Call sites to migrate (also inspect the surrounding files yourself - this
list may not be exhaustive):
${callSites}

This codemod package will be stored in a shared local registry and reused
against other repos beyond this one, so don't special-case the transform
to only the exact import style seen above - handle every common way
"${input.packageName}" gets imported in real code (default import,
namespace import (\`import * as x from "..."\`), named/destructured import,
and \`require(...)\`, whichever apply to this package), not just whichever
one this call site sample happens to use.

The current working directory ("${codemodPath}") is this exact upgrade's
slot in a shared local registry - check first whether a codemod package
already exists here (e.g. a \`codemod.yaml\`) from a previous repo that hit
the same upgrade. If one exists, inspect it against the call sites above:
if it already covers them, verify it still passes and stop there; if it
doesn't (e.g. it only handles a different import style, or missed part of
the API surface), extend it rather than starting over. If nothing exists
yet, scaffold fresh here - \`codemod init . --no-interactive\`.

Either way, use the codemod skill's normal workflow: implement (or extend)
an AST-based transform, add fixtures from the call sites above, and
iterate until the package's own tests and \`validate_codemod_package\` are
green. Do not stop until they are.

When finished, print exactly one line, with nothing else after it, starting
with "${RESULT_MARKER}" followed by JSON matching
{ "success": boolean, "codemodPath": string, "reason"?: string } -
"reason" only if success is false, explaining why you gave up.`;
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
      // Spread first, codemodPath last: our own value (what the agent was
      // actually told to scaffold at) always wins over whatever it echoed
      // back in its JSON, which is redundant at best if correct and wrong
      // at worst if the agent mistyped/relativized it.
      return { ...result, codemodPath };
    } catch (err) {
      console.error(`CodingAgentService: couldn't parse agent result line "${line}":`, err);
      return { success: false, codemodPath, reason: "agent result line wasn't valid JSON" };
    }
  }

  // execFileAsync's rejection is still an Error, with stdout/stderr from the
  // process attached directly on it (same shape as a successful result) -
  // this just narrows the `unknown` catch type to read it safely.
  private stdoutOf(err: unknown): string {
    if (err && typeof err === "object" && "stdout" in err) {
      return String((err as { stdout: unknown }).stdout);
    }
    return "";
  }
}
