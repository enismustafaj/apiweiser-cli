# Codemods

`apiweiser-cli codemod --path <repo> --group <id>` - for each package in a
group from `plan`, where its codemod lives: an exact match in the
`@apiweiser` scope of codemod.com's registry, and its directory in the local
registry. The command only looks; the agent (see `skills/upgrade-dependency/SKILL.md`)
decides whether a codemod it finds covers this repo's call sites, and writes
or extends one when it doesn't.

```json
{
  "name": "react",
  "from": "18.3.1",
  "to": "19.0.0",
  "callSites": 12,
  "remote": "@apiweiser/react-18-to-19@1.2.0",
  "codemodDir": "~/.apiweiser-cli/codemods/react/18_to_19",
  "hasCodemod": true
}
```

A package with no call sites gets `codemodDir: null` and no registry search -
there's nothing to migrate. A failed search sets `error` on that package; its
`codemodDir` still comes back.

## `CodemodRegistry`

The local registry: one directory per `(packageName, fromVersion,
toVersion)` under `~/.apiweiser-cli/codemods/<packageName>/<key>/`. An entry
is just that directory - the agent scaffolds the codemod directly into it
(`codemod init`). `dirFor(...)` returns the path without creating it;
`hasCodemod` is whether it holds a `codemod.yaml`.

One entry per package, not per group: react 18→19's migration is the same
whichever group react landed in, while a group key (`@base-ui/react+date-fns`)
would almost never come up again.

**The key depends on whether the upgrade crosses a major-version boundary**:

- **Crosses a major** (e.g. `4.1.0` → `5.0.0`): keyed by **major version
  only** - `<packageName>/4_to_5/`. Measured directly: reusing/extending an
  existing entry costs ~69% less than a from-scratch build (35 turns/$0.79
  vs 86 turns/$2.52, same real node-fetch v2→v3 migration) - but real repos
  rarely pin the exact same patch version, so keying by full version made
  that cheap path rare in practice: a repo on `chalk@4.1.0` and one on
  `chalk@4.1.2`, both migrating to `5.x`, used to get two separate entries,
  both built from scratch.
- **Stays within the same major** (e.g. `2.4.5` → `2.7.0`): keyed by the
  **full, exact version pair** - `<packageName>/2.4.5_to_2.7.0/`. A major
  bump is documented by the package itself as one coherent breaking change
  regardless of which patch you're coming from; a same-major update isn't
  (a package can ship a breaking change without a major bump). Two
  different same-major updates could be entirely unrelated fixes -
  coarsening those together would point the agent at a prior entry that
  has nothing to do with the current one, not just an incomplete one.

Whether an existing entry is reusable as-is isn't a question this class
answers. A pure existence check can't tell whether a codemod already sitting
there covers the current repo's call sites, only whether _some_ codemod was
built for this key before - so that's left to the agent, which dry-runs it.
Proven for real: a node-fetch codemod built from one repo's call sites (which
never used `.buffer()`) correctly got extended - not blindly reused - when a
second repo's call sites included `response.buffer()`, a real v2 API the
first repo never exercised.

## Remote registry

Codemods published under the `@apiweiser` scope on
[codemod.com](https://codemod.com)'s registry are found by `CodemodSearch`:

```
npx codemod search <remoteName> --scope apiweiser --format json
```

`CodemodRegistry.remoteName(...)` is the same key as the local directory,
flattened into a dash-joined name (`react-18-to-19`; `@` and `/` stripped,
since a registry scope is its own field). Only an **exact** name match in the
`apiweiser` scope counts - a similar name is a different upgrade - and it
comes back as a spec `codemod run` takes as is
(`@apiweiser/react-18-to-19@1.2.0`). Searching needs no login.

A name match only means the same version jump, not that the codemod handles
this repo's import styles - the skill has the agent dry-run it against the
call sites before trusting it, the same way it treats a local entry.

Publishing to `@apiweiser` isn't part of the CLI: codemods reach the scope
through the `apiweiser/codemods` repo's own CI, so only reviewed codemods are
published.
