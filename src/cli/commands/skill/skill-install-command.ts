import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { logger } from "../../../logger.ts";
import { CodemodAi } from "../../../skills/codemod-ai.ts";
import type { Harness } from "../../../skills/types.ts";
import type { Command } from "../../types.ts";
import type { SkillInstallOptions, SkillInstallResult } from "./types.ts";

const execFileAsync = promisify(execFile);

const SKILL_NAME = "upgrade-dependency";
const SKILL_SOURCE = join(import.meta.dirname, "..", "..", "..", "..", "skills", SKILL_NAME);
// The skill's name before 4.1 - removed on install so the agent doesn't see both
const OLD_SKILL_NAME = "apiweiser";

const HARNESSES: Harness[] = ["claude", "codex"];

// Agents decide from a skill's description whether to read it, and skip it
// when an upgrade looks easy. The user-level instructions file is read every
// session, so a line there makes using the skill a rule instead of a choice.
const BLOCK_START = "<!-- apiweiser-cli:start -->";
const BLOCK_END = "<!-- apiweiser-cli:end -->";
const BLOCK = `${BLOCK_START}
## Dependency upgrades

Use the \`${SKILL_NAME}\` skill before changing the version of any npm dependency, even a single package with a known target version, and even when the upgrade looks simple.
${BLOCK_END}`;

const log = logger("skill");

export class SkillInstallCommand implements Command<SkillInstallOptions, SkillInstallResult> {
  private readonly codemodAi = new CodemodAi();

  async run(options: SkillInstallOptions): Promise<SkillInstallResult> {
    const harness = options.harness ?? (await this.detectHarness());

    log.info(`Installing the codemod skill for ${harness}`);
    await this.codemodAi.installSkill(harness);

    const skillsDir = await this.codemodAi.userSkillsDir(harness);
    const target = join(skillsDir, SKILL_NAME);
    log.info(`Installing the ${SKILL_NAME} skill into ${target}`);
    await rm(target, { recursive: true, force: true });
    await rm(join(skillsDir, OLD_SKILL_NAME), { recursive: true, force: true });
    await cp(SKILL_SOURCE, target, { recursive: true });

    const instructions = instructionsFile(harness);
    log.info(`Adding the ${SKILL_NAME} rule to ${instructions}`);
    await upsertBlock(instructions);

    return { harness, skills: [join(skillsDir, "codemod"), target], instructions };
  }

  private async detectHarness(): Promise<Harness> {
    for (const harness of HARNESSES) {
      try {
        await execFileAsync("sh", ["-c", `command -v ${harness}`]);
        return harness;
      } catch {
        // not on PATH
      }
    }
    throw new Error("neither claude nor codex is on PATH - pass --harness <claude|codex>");
  }
}

// The instructions file each harness reads in every session, user-scoped like the skills
function instructionsFile(harness: Harness): string {
  return harness === "codex"
    ? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "AGENTS.md")
    : join(homedir(), ".claude", "CLAUDE.md");
}

// Replaces our block if it's there, appends it otherwise; the rest of the file is the user's
async function upsertBlock(file: string): Promise<void> {
  const current = existsSync(file) ? await readFile(file, "utf8") : "";
  const start = current.indexOf(BLOCK_START);
  const end = current.indexOf(BLOCK_END);
  const next =
    start !== -1 && end > start
      ? current.slice(0, start) + BLOCK + current.slice(end + BLOCK_END.length)
      : current.trimEnd() + (current.trim() ? "\n\n" : "") + BLOCK + "\n";
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, next);
}
