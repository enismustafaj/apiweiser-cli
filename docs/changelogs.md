# Changelogs

`apiweiser-cli changelog --path <repo> --group <id>` - for each package in a
group from `plan`, writes its release notes between the installed version and
the target to a Markdown file, and prints where:

```json
{
  "name": "react",
  "from": "18.3.1",
  "to": "19.0.0",
  "source": "https://github.com/facebook/react",
  "releases": 3,
  "file": "~/.apiweiser-cli/changelogs/react@18.3.1..19.0.0.md"
}
```

No LLM: the agent calling the command reads the notes itself - summarizing
inside the tool would cost a second model call and lose detail.

Per package:

1. **Installed version** - `DependenciesRepository.find(repo, name)`; a
   package `scan` didn't record fails the command.
2. **Source** - `ChangelogSourcesRepository.findUrl(name)`, or, the first
   time, `NpmRegistryLookup` (below), saved with `insert` for every later run.
3. **Releases** - `GitHubReleaseFetcher.fetchRange` (below).
4. **File** - only when there are releases; `file: null` otherwise.

A failure for one package (rate limit, network) sets `error` on that package
instead of failing the command - the rest of the group still comes back.

## `NpmRegistryLookup.findChangelogSource(packageName)`

`GET https://registry.npmjs.org/<name>/latest`, reads the manifest's
`repository` field, and normalizes whatever shape it's in (`git+https://`,
`git+ssh://git@`, `git@github.com:`, `github:owner/repo`, or a bare
`owner/repo` — npm's documented default-to-GitHub shorthand) down to
`owner/repo`. Returns the **GitHub API** releases endpoint —
`https://api.github.com/repos/<owner>/<repo>/releases` — not the HTML
releases page, because the API endpoint is actually fetchable JSON. The
command's `source` field turns it back into `https://github.com/<owner>/<repo>`.

**A trailing `#<subdirectory>`** (npm's shorthand for `repository.directory`,
for a package published from a subfolder of a larger repo - found via a
real one, `ext`, whose `repository.url` is
`git+https://github.com/medikoo/es5-ext.git#ext`) gets stripped before the
`.git` suffix is stripped, not after - `.git$` doesn't match
`.git#ext`, so doing it in the other order left `ext` swept into the repo
name (`medikoo/es5-ext.git#ext`), a URL that always 404s.

**Verified against 769 real dependencies** (a full scan of
[sindresorhus/got](https://github.com/sindresorhus/got)): 768 resolved
(99.9%). The one miss, `micro-spelling-correcter`, has no `repository`
field in its npm metadata at all — there's nothing to derive from, for
anyone.

Three outcomes, each meaning something different to the caller:

| Response                          | Return   | Meaning                              |
| --------------------------------- | -------- | ------------------------------------ |
| `404`                             | `null`   | Package genuinely not found          |
| `200`, no resolvable `repository` | `null`   | No GitHub source exists — definitive |
| anything else (`429`, `5xx`, ...) | _throws_ | Transient failure, not "no data"     |

That last distinction matters: early on, any non-`200` response was
treated as `null`, indistinguishable from "no repository field". A burst
of testing inadvertently rate-limited itself against the npm registry, and
the resulting `null`s were misread as real coverage gaps (a measured
"resolved: 694/769" that looked like a regression, but was actually just
unhandled 429s). Now only a real 404 (or clean 200 with no usable data)
returns `null`; everything else throws.

## `GitHubReleaseFetcher.fetchRange(releasesUrl, fromVersion, toVersion)`

Every release strictly after `fromVersion` and up to and including
`toVersion`, **sorted by version** - not GitHub's date order, since
maintenance lines (express 4.x) keep releasing after the next major's
pre-releases. A package's single latest release can look harmless while an
earlier major in the same range broke something, so the whole range comes
back, not just the newest.

- **Tags** aren't always plain `vX.Y.Z` - real ones include monorepo-style
  tags like `styled-components@6.5.3` and `pinia@2.0.12`. Each is parsed
  with `semver.coerce(tag, { includePrerelease: true })`; a tag that doesn't
  parse is skipped.
- **Pre-releases are skipped** unless the target is one. Without
  `includePrerelease`, coerce read `5.0.0-alpha.1` as `5.0.0`, so express's
  2014 alphas landed inside a 4.17 → 5.3 range.
- **Paging**: up to 20 pages of 100, stopping once a page reaches back past
  `fromVersion`. Found on next.js, whose first page can be all newer
  `-canary.N` releases, burying the real range on a later page.
- **Rate limit**: GitHub allows 60 unauthenticated requests an hour.
  `GITHUB_TOKEN`, if set, is sent as `Authorization: Bearer` (5,000/hour).
  It's optional - a rate-limited package just gets an `error`.

## The Markdown file

`~/.apiweiser-cli/changelogs/<name>@<from>..<to>.md` (a scoped name's `/`
becomes `__`) - outside the repo, so it never shows up in `git status`, and
named by package and range, not repo, since the same jump has the same notes
anywhere. Rewritten on every run.

```md
# react 18.3.1 → 19.0.0

Source: https://github.com/facebook/react

## v19.0.0

https://github.com/facebook/react/releases/tag/v19.0.0

<notes>
```

A release's own headings are pushed two levels down, so its `## What's
Changed` sits under our `## <tag>` instead of beside it (express's file had
66 `##` headings for 33 releases). Fenced code is left alone - a `# ...` line
there is a shell comment, not a heading.

## `fetchWithTimeout`

Every `fetch()` here (`NpmRegistryLookup`, `GitHubReleaseFetcher`, and
`OsvClient` for `plan`) goes through `src/http.ts`'s `fetchWithTimeout`
(60s, `AbortSignal.timeout`). `fetch()` has no default timeout: a
non-responding endpoint once hung a run indefinitely, with zero CPU
activity. Now it fails like any other error.
