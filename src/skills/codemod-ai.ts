import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { CodemodSkillList, Harness } from "./types.ts";

const execFileAsync = promisify(execFile);

export class CodemodAi {
  async installSkill(harness: Harness): Promise<void> {
    await execFileAsync(
      "npx",
      ["--yes", "codemod", "ai", "--harness", harness, "--user", "--no-interactive"],
      { maxBuffer: 1024 * 1024 * 5 },
    );
  }

  // The harness's user-level skills dir - wherever codemod put its own skill,
  // e.g. ~/.claude/skills. Codemod knows each harness's layout; we don't.
  async userSkillsDir(harness: Harness): Promise<string> {
    const { stdout } = await execFileAsync(
      "npx",
      ["--yes", "codemod", "ai", "list", "--harness", harness, "--format", "json"],
      { maxBuffer: 1024 * 1024 * 5 },
    );
    const { skills } = JSON.parse(stdout) as CodemodSkillList;
    const codemod = skills.find((skill) => skill.name === "codemod" && skill.scope === "user");
    if (!codemod) throw new Error(`codemod's skill isn't installed for ${harness}`);
    return dirname(dirname(codemod.path.replace(/^~/, homedir())));
  }
}
