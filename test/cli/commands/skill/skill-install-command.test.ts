import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SkillInstallCommand } from "../../../../src/cli/commands/skill/skill-install-command.ts";
import { CodemodAi } from "../../../../src/skills/codemod-ai.ts";

// CODEX_HOME usually isn't set, which t.mock.property can't mock
function setCodexHome(t: { after: (fn: () => void) => void }, dir: string): void {
  const before = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  t.after(() => {
    if (before === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = before;
  });
}

test("installs codemod's skill, then replaces the upgrade-dependency skill next to it", async (t) => {
  const skillsDir = mkdtempSync(join(tmpdir(), "apiweiser-skills-"));
  mkdirSync(join(skillsDir, "upgrade-dependency"));
  writeFileSync(join(skillsDir, "upgrade-dependency", "stale.md"), "from an older version");
  mkdirSync(join(skillsDir, "apiweiser"));
  setCodexHome(t, mkdtempSync(join(tmpdir(), "codex-home-")));

  const installSkill = t.mock.method(CodemodAi.prototype, "installSkill", async () => {});
  t.mock.method(CodemodAi.prototype, "userSkillsDir", async () => skillsDir);

  const result = await new SkillInstallCommand().run({ harness: "codex" });

  assert.deepEqual(installSkill.mock.calls[0]!.arguments, ["codex"]);
  assert.deepEqual(result.skills, [join(skillsDir, "codemod"), join(skillsDir, "upgrade-dependency")]);
  assert.equal(
    readFileSync(join(skillsDir, "upgrade-dependency", "SKILL.md"), "utf8"),
    readFileSync("skills/upgrade-dependency/SKILL.md", "utf8"),
  );
  assert.ok(!existsSync(join(skillsDir, "upgrade-dependency", "stale.md")), "an old install is replaced");
  assert.ok(!existsSync(join(skillsDir, "apiweiser")), "the skill's old name is removed");
});

test("adds the skill rule to the harness's instructions, replacing it on reinstall", async (t) => {
  const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
  const agents = join(codexHome, "AGENTS.md");
  writeFileSync(agents, "# My rules\n\nAlways use pnpm.\n");
  setCodexHome(t, codexHome);
  t.mock.method(CodemodAi.prototype, "installSkill", async () => {});
  t.mock.method(CodemodAi.prototype, "userSkillsDir", async () => mkdtempSync(join(tmpdir(), "apiweiser-skills-")));

  const result = await new SkillInstallCommand().run({ harness: "codex" });
  await new SkillInstallCommand().run({ harness: "codex" });

  assert.equal(result.instructions, agents);
  const content = readFileSync(agents, "utf8");
  assert.ok(content.startsWith("# My rules\n\nAlways use pnpm.\n\n<!-- apiweiser-cli:start -->"), "the user's rules stay");
  assert.equal(content.split("<!-- apiweiser-cli:start -->").length, 2, "one block after two installs");
  assert.match(content, /Use the `upgrade-dependency` skill before changing the version of any npm dependency/);
});
