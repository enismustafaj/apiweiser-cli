---
name: upgrade-dependency
description: Use before changing the version of any npm dependency - even a single package with a known target version ("upgrade openai to 4", "move to eslint 9", "bump zod"), and even when the upgrade looks simple. One command (`apiweiser-cli plan`) gets what you can't see from the code or the type definitions - the breaking changes from the release notes for the exact version range, the peer packages that must move with it (or npm install fails), and an existing codemod for the call sites. Start here before the codemod skill. Also use to check a repo for outdated dependencies ("what can I upgrade?").
---

# apiweiser

`apiweiser-cli` does the deterministic parts of a dependency upgrade: where each
package is used, which updates exist, which packages must move together, the
release notes, and where the codemod for an upgrade lives. You do the judgement:
reading the notes, writing or checking codemods, fixing what's left, verifying.

## How the CLI talks to you

- Every command prints exactly one JSON document to **stdout**. Logs go to
  stderr - ignore them unless something fails.
- On failure it prints `{ "error": "..." }` and exits 1. Read the message; it
  usually says what to run first (e.g. "run `scan` first").
- Always pass `--path` (the repo root, the directory with `package.json`).
- No setup or tokens needed. If `changelog` reports a GitHub rate-limit
  `error`, use the fallbacks below; `GITHUB_TOKEN`, if set, raises the limit.

## Commands

| Command | Does | Needs |
|---|---|---|
| `apiweiser-cli scan --path <repo>` | Records the repo's dependencies and where each is called | - |
| `apiweiser-cli plan --path <repo> [--package <name>]...` | Lists available updates, grouped by what must move together | `scan` |
| `apiweiser-cli changelog --path <repo> --group <id>` | Writes each package's release notes for the range to a `.md` file | `scan` |
| `apiweiser-cli codemod --path <repo> --group <id>` | Finds the codemod for each package's upgrade | `scan` |

### `scan`
```json
{ "repo": "/abs/path",
  "packages": [{ "name": "react", "version": "18.3.1", "dev": false,
                 "callSites": [{ "api": "useState", "file": "src/a.tsx", "line": 4 }] }] }
```
Direct dependencies only. `dev: true` packages are never scanned, so their empty
`callSites` means "not scanned", not "unused". `api` names what was used: a
call (`Command.option`, `jwt.sign`), a JSX component (`<Button>`), a base class
or interface (`extends React.Component`, `implements OnInit`) or a type
(`express.Request`). Plain JS is scanned too; `.vue`/`.svelte` files aren't.

### `plan`
```json
{ "repo": "/abs/path",
  "groups": [{ "id": "react@19.0.0+react-dom@19.0.0",
               "packages": [{ "name": "react", "from": "18.3.1", "to": "19.0.0",
                              "updateType": "major", "callSites": 12,
                              "vulnerabilities": [{ "id": "GHSA-…", "summary": "…",
                                                    "severity": "HIGH", "fixedIn": "19.0.1" }] }] }],
  "skipped": [{ "name": "eslint", "reason": "peer conflict: ...", "vulnerabilities": [] }] }
```
- A **group** is a set of packages whose peer dependencies mean none can move
  alone. Upgrade a group as a whole, never part of one.
- `to` is the *next* step, not the latest: the next major if one exists,
  otherwise the latest minor/patch. A jump across several majors takes several
  rounds - one major at a time, since migration guides and codemods are written
  that way.
- `--package` keeps only the groups (and skipped entries) that mention it.
- A package in `skipped` can't be planned right now; tell the user the reason
  instead of forcing it.
- The group `id` is what `changelog` and `codemod` take as `--group`.
- `vulnerabilities` lists known advisories (from OSV.dev) against the
  *installed* version. `fixedIn` is the nearest version that fixes it - it can
  be beyond `to`, in which case one round isn't enough: keep stepping until
  the installed version reaches `fixedIn`. `fixedIn: null` means no fix exists
  yet. `vulnerabilities: null` means the lookup failed, not "none".

### `changelog`
```json
{ "repo": "/abs/path",
  "packages": [{ "name": "react", "from": "18.3.1", "to": "19.0.0",
                 "source": "https://github.com/facebook/react", "releases": 3,
                 "file": "/Users/you/.apiweiser-cli/changelogs/react@18.3.1..19.0.0.md" }] }
```
- `file` is Markdown, one section per release, oldest first. Read it with your
  file tool - it can be long.
- `file: null`, `source` set: the package doesn't use GitHub releases. Look for
  `CHANGELOG.md` or a migration guide in the `source` repo.
- `source: null`: no GitHub repo on npm. Search the web for
  "`<name>` `<to>` migration guide".
- `error` set: the fetch failed for that package (rate limit, network). Retry
  later or fall back as above.

### `codemod`
```json
{ "repo": "/abs/path",
  "packages": [{ "name": "react", "from": "18.3.1", "to": "19.0.0", "callSites": 12,
                 "remote": "@apiweiser/react-18-to-19@1.2.0",
                 "codemodDir": "/Users/you/.apiweiser-cli/codemods/react/18_to_19",
                 "hasCodemod": true }] }
```
- `remote`: a published apiweiser codemod for exactly this upgrade.
- `codemodDir`: **the** place for this upgrade's codemod - use it, don't write
  codemods anywhere else, so the next repo with the same upgrade finds it.
- `hasCodemod`: a codemod already exists in `codemodDir`.
- `codemodDir: null`: 0 call sites, nothing to migrate.
- `error` set: the registry search failed; `codemodDir` is still valid.

## Upgrading

Follow these steps in order, one group at a time.

### 1. Scan and plan
```sh
apiweiser-cli scan --path .
apiweiser-cli plan --path . --package <name>     # or no --package for everything
```
Pick the group that contains the package the user asked for. If the user asked
for something broad ("upgrade what you can"), show them the groups - majors with
call sites are the work, patches and minors without call sites are usually
trivial - and let them choose before going on. Point out groups with
`vulnerabilities` first, by severity, and skipped packages that have them (they
are stuck on a vulnerable version - say why, from `reason`).

If the user asked for a version beyond the group's `to`, say it takes several
steps and do the first one.

### 2. Isolate the work
Work on a new branch or git worktree, not on the user's current changes. The
codemod CLI refuses a dirty working tree - never get around that with
`--allow-dirty`.

### 3. Read the release notes
```sh
apiweiser-cli changelog --path . --group <id>
```
Read each `file` (or follow the fallbacks above). Make a short list of the
breaking changes that touch this repo: compare them against the `api` names in
the `scan` call sites. Changes to APIs the repo doesn't call don't matter.

### 4. Find or write the codemods
```sh
apiweiser-cli codemod --path . --group <id>
```
For each package with a `codemodDir`, in this order:

1. **`remote` set** - dry-run it and check the diff covers the call sites:
   ```sh
   npx codemod run <remote> --target . --dry-run --no-interactive
   ```
   A matching name means the same version jump, not that it handles this
   repo's import styles. If the diff misses call sites, go on to 2/3.
2. **`hasCodemod: true`** - dry-run the local one the same way:
   ```sh
   npx codemod workflow run -w <codemodDir> --target . --dry-run --no-interactive
   ```
   If it misses call sites, **extend** it in `codemodDir`. Never delete or edit
   its existing test fixtures - other repos depend on them. Add new ones.
3. **Neither** - search the public registry (codemod.com has official recipes
   for big upgrades, e.g. React 19). If nothing fits, write a new codemod **in
   `codemodDir`** with the codemod skill (`/codemod`).

When writing or extending a codemod:
- Base it on the breaking changes from step 3 and the call sites from `scan`.
- Handle every common way the package is imported (default, namespace, named,
  `require`), not only the style this repo happens to use - it will be reused.
- Run the codemod's **entire** test suite and get it green before using it.

### 5. Upgrade and migrate
Install every package in the group at its `to` version, in one install, with
the repo's package manager (check the lockfile):
```sh
npm install react@19.0.0 react-dom@19.0.0
```
Install exactly the group's packages, nothing else. `plan` already includes
every package that has to move; tooling around the upgraded package (its
CLI, schematics, linters, TypeScript) stays where it is unless it's in the
group. If an install fails because another package has to move, rerun
`plan` with that package rather than adding it by hand.

Then apply the codemods (the same commands as in step 4, without `--dry-run`).

### 6. Verify
Run the repo's typecheck, linter, tests and build. Fix whatever the codemods
didn't cover by hand, using the breaking changes from step 3. Don't stop with
failures you caused; if something can't be fixed, explain it to the user.

A passing build doesn't show the behaviour is unchanged. If no test covers a
call site you changed, exercise it yourself: a short script that loads the
changed module and calls it, including the error paths the old code handled
(missing configuration, failed requests, invalid input). Release notes don't
list every behaviour change.

### 7. Finish
```sh
apiweiser-cli scan --path .
```
Rescan so apiweiser records the new versions - the next `plan` starts from them.

Then report to the user: the group and versions, the breaking changes that
mattered, which codemods ran (remote, existing, or new - and its `codemodDir`),
what you fixed by hand, and the verification results. Don't commit, push or
open a PR unless the user asks.

## Don'ts
- Don't upgrade part of a group, or two groups at once.
- Don't upgrade packages outside the group.
- Don't jump past `to` in one go.
- Don't write codemods outside `codemodDir`.
- Don't use `--allow-dirty`.
- Don't edit `~/.apiweiser-cli/` by hand - only through the CLI (codemods in
  `codemodDir` are the exception).
