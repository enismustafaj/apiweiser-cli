# How upgrades are grouped

This document explains how apiweiser decides **which dependency upgrades go
together** into one change request (one codemod, one install, one pull
request), and why.

## The problem

Some packages can't be upgraded on their own. A package can declare
**peer dependencies**: other packages it expects the project to provide,
in a certain version range. npm refuses to install a combination where a
peer range isn't satisfied (the `ERESOLVE` error).

Real example: upgrading `@angular/core` from 5 to 20 failed because
`@angular/core@20` requires `rxjs` `^6.5.3 || ^7.4.0`, and the project still
had `rxjs@5`. Upgrading `@angular/core` alone can never work - `rxjs` has to
move in the same install.

The opposite direction breaks things too: upgrading `rxjs` alone to 7 fails
if the installed `@angular/core@5` only accepts `rxjs ^5.5.0`.

So upgrades that depend on each other are put into one **group**, and each
group becomes one change request.

An earlier version grouped packages by name prefix (everything under
`@angular/…` together). That missed real relationships - `rxjs` and
`zone.js` are required by Angular but aren't `@angular/…` packages - and it
grouped unrelated packages that merely share a prefix (`@types/react` and
`@types/node`). Grouping now follows the actual peer requirements.

## What the algorithm works with

1. **Renovate's suggestions.** For each dependency, Renovate proposes the
   versions it could be upgraded to - one per major version (e.g. for
   `@angular/forms 5.2.9`: `5.2.11`, `6.1.10`, `7.2.16`, … `22.2.0`). These
   are the only versions the algorithm will ever choose. It never invents a
   version Renovate didn't offer.
   - **Security fixes are the exception to "one per major".** When a
     dependency has a known vulnerability, Renovate offers only the lowest
     version that fixes it, however far away (e.g. `@angular/core 5.2.9 →
20.0.0`, because no 6.x–19.x release fixes its advisories). That then
     is the only option for that package, so the security fix takes
     priority.
2. **What's installed now** - every package in the project and its current
   version, recorded when the project was scanned.
3. **Peer requirements** - for any package version, which peers it needs and
   in which ranges, looked up in the npm registry. This works for versions
   that aren't installed yet, which is what's needed to check an upgrade
   before doing it.

## Step 1: choose one version per package

Renovate usually offers several versions per package. Exactly one is chosen
as the package's **next step**:

- the **lowest version that moves to a new major**, or
- if no offered version moves to a new major, the **highest version within
  the current major**.

| Installed              | Offered                    | Chosen   | Why                                        |
| ---------------------- | -------------------------- | -------- | ------------------------------------------ |
| `rxjs 5.5.7`           | `5.5.12`, `6.6.7`, `7.8.2` | `6.6.7`  | the next major, not the latest             |
| `@angular/forms 5.2.9` | `5.2.11`, `22.2.0`         | `22.2.0` | the only version that moves to a new major |
| `chalk 5.0.0`          | `5.1.0`, `5.3.0`           | `5.3.0`  | nothing crosses a major, so the highest    |

Why one major at a time: migration guides, changelogs and codemods are
written per major version, so each step is a well-understood migration, and
a codemod built for "5 → 6" can be reused by every project that goes
through that step. Once that upgrade is merged, the next daily run sees the
new installed version and proposes the next step (6 → 7). A patch within the
current major is skipped when a major step exists, because the major
release already includes it.

## Step 2: build a group around one package

Starting from one package at its chosen version, the algorithm keeps adding
whatever that upgrade forces in, until nothing new is needed. It checks two
directions for every package that's in the group.

### Forward: what does the new version need?

For each peer the new version requires:

- **The peer is already in the group** → its chosen version must satisfy
  the range. If it doesn't, that's a conflict (see below).
- **The installed version already satisfies the range** → nothing to do;
  the peer stays out.
- **The peer isn't installed at all** → nothing to do; npm installs missing
  peers itself and picks a fitting version.
- **Otherwise** the peer has to move too. It joins the group at the
  **lowest version Renovate offers that satisfies the range** (the smallest
  step that works). If no offered version satisfies it, that's a conflict.

Optional peers follow the same rules: npm still enforces their range when
they're installed.

### Reverse: what breaks if this package moves?

For each installed package that lists this one as a peer:

- **Its accepted range still includes the new version** → nothing to do.
- **It's already in the group** → the range of its _new_ version is what
  counts. If that doesn't accept the new version, it's a conflict.
- **Otherwise** it has to move too. It joins at the **lowest version
  Renovate offers whose own peer range accepts the new version** (a version
  that no longer requires this peer at all also counts). If none does,
  that's a conflict.

Only packages the project depends on directly are considered here, because
only those can be upgraded - Renovate only suggests upgrades for them.

### Keep going

Every package that joins is checked the same way, in both directions, so
the group grows until it's complete. Once a version is chosen for a package
it's never changed again.

### Example

Project: `@angular/core 5.2.9`, `@angular/forms 5.2.9`, `rxjs 5.5.7`.
Starting point: `@angular/core 6.1.10`.

```
@angular/core 6.1.10
  forward: needs rxjs ^6.0.0
           installed rxjs 5.5.7 doesn't fit
           Renovate offers rxjs 5.5.12, 6.6.7, 7.8.2 → lowest that fits: 6.6.7
           → rxjs 6.6.7 joins
  reverse: @angular/forms 5.2.9 only accepts @angular/core 5.2.9
           lowest forms version that accepts core 6.1.10: 6.1.10
           → @angular/forms 6.1.10 joins

rxjs 6.6.7            forward: no peers.      reverse: nothing else breaks.
@angular/forms 6.1.10 forward: core is in the group at 6.1.10 ✓, rxjs at 6.6.7 ✓

Group: @angular/core 6.1.10, rxjs 6.6.7, @angular/forms 6.1.10
```

## Conflicts

A **conflict** means there's no combination npm would accept using only the
versions Renovate offered. The group is not raised; it's skipped, with a
reason naming the package and range that broke it. It predicts the
`ERESOLVE` failure before spending a coding-agent session and a pull request
on it. It's not an error in the tool, just an upgrade that isn't possible
yet.

There are four ways to get one:

1. **No offered version fits a needed peer.** Real example:
   `@angular/core 20.0.0` needs `zone.js ~0.15.0`, the project has
   `0.8.20`, and Renovate only offers `0.16.3` (it treats `0.x` as one
   stream and offers only the newest).
2. **The group already chose a version that doesn't fit.** A member needs
   `rxjs ^7`, but the group already holds `rxjs 6.6.7` because another member
   needed `^6`.
3. **An installed package breaks and no offered version of it fits.**
   Bumping `rxjs` to 7 breaks the installed `@angular/core`, and none of the
   offered `@angular/core` versions accepts `rxjs 7`.
4. **The registry doesn't know a version** that would be part of the group,
   so its requirements can't be checked.

**Limitation - choices are never revisited.** The algorithm always takes the
lowest version that fits and doesn't go back to try a higher one. In case 2,
a higher `rxjs` (7.8.2) might have satisfied both members, but the group
reports a conflict instead. This is rare in practice and keeps the
algorithm simple; trying alternatives (backtracking) can be added if it
turns out to matter.

## Step 3: plan every package

Step 2 builds one group from one starting point. To plan the whole project,
every package (at its version from step 1) is used as a starting point, in
the order Renovate listed them. Two rules keep the result consistent:

### A package already in a group isn't raised again

If `rxjs` was pulled into the Angular group, its own suggestion is not
raised separately later - it's already being upgraded as part of that group.
Two separate pull requests for the same package would conflict with each
other.

### Overlapping groups are merged

An **overlap** happens when a new starting package's group reaches into a
group that was already built - it needs a package that an earlier group
already took.

Real example (excalidraw-clone):

```
Earlier group:  @mui/material 6.5.0, @mui/icons-material 6.5.0
                (MUI 6 still accepts React 18, so React didn't need to join)

Next starting point: react 19.0.0
  reverse: the installed MUI 5 only accepts React 17 or 18
           → needs MUI at a version that accepts React 19
           → but MUI is already in the earlier group     ← overlap
```

The first version of the algorithm skipped such packages. On a real project
that skipped exactly the most important upgrades: React 19 and ESLint 9 were
both dropped this way, even though they fit perfectly with the groups they
touched (MUI 6 accepts React 19).

Instead, the groups are now **merged**:

1. Rebuild the group, starting from **all members of the earlier group, at
   the versions it already chose**, plus the new starting package.
2. Run the normal forward and reverse checks over all of them.
3. If the rebuilt group reaches into **another** earlier group, add that
   group's members too and rebuild again. Repeat until it reaches no further
   groups.
4. The merged group replaces the groups it absorbed, at the position of the
   first one. All its packages now belong to it.

```
Rebuild from: @mui/material 6.5.0, @mui/icons-material 6.5.0, react 19.0.0
  reverse(react 19): MUI is in the group at 6.5.0 and accepts React 19 ✓
                     react-dom 18 only accepts React 18 → react-dom 19.0.0 joins
Result: one group - MUI 6.5.0 (both packages), react 19.0.0, react-dom 19.0.0
```

The earlier group keeps the versions it chose. A group that was already
valid is never quietly changed into something different.

### When a merge conflicts

If the new package needs a **different** version of something the earlier
group already chose, the rebuild reports a conflict. Then:

- the earlier group stays **exactly as it was**, and
- the new package is skipped, with the conflict as the reason.

```
Earlier group: @angular/core 6.1.10
New starting point: ngx-toastr 9.0.0, which needs @angular/core ^7.0.0
Rebuild: @angular/core is in the group at 6.1.10, which doesn't satisfy ^7
  → conflict: Angular stays at 6.1.10, ngx-toastr is skipped
```

This isn't lost for good: once the Angular upgrade is merged, the next
daily run plans `ngx-toastr` again against the new installed versions.

### Merging several groups at once

A new package can reach into more than one earlier group. All of them are
merged into one, in the position of the first:

```
Groups so far:  [a 2.0.0]   [chalk 5.3.0]   [b 2.0.0]
New: c 2.0.0, which needs a ^2 and b ^2
Result:         [a 2.0.0, b 2.0.0, c 2.0.0]   [chalk 5.3.0]
```

## The result

Planning produces:

- **Groups** - each one becomes a single change request: one coding-agent
  session builds one codemod for all its packages, all of them are installed
  in one command, and one pull request is opened.
- **Skipped packages, each with a reason** - conflicts, and packages whose
  requirements couldn't be checked because the registry was unavailable
  (only that package is skipped; the rest of the plan continues).

## Pseudocode

The same algorithm, step by step.

### Inputs

```
suggestions : list of (package, installedVersion, offeredVersion)   -- Renovate, one row per offered version
installed(p)        → installed version of p, or none                -- from the scan
directDeps()        → packages the project depends on directly
peersOf(p, v)       → [(peer, range)] that p@v requires, or UNKNOWN  -- npm registry
```

### Step 1: one version per package

```
function NEXT_LEAP(rows of one package):
    current := major(installedVersion)
    offered := rows' offeredVersions, ignoring unparseable ones, sorted ascending
    if offered is empty: return first row
    crossing := first v in offered where major(v) > current
    return crossing if found, else last(offered)        -- next major, else highest in same major
```

### Step 2: build one group (from one or more starting packages)

```
function BUILD_GROUP(seeds, candidates):                 -- candidates: package → offered versions
    group := map package → chosen version, filled with seeds (their versions are fixed)
    queue := seeds
    while queue not empty:
        member := queue.pop_front()
        for each (p, v) in FORWARD(member) ∪ REVERSE(member):   -- forward first, then reverse
            group[p] := v
            queue.push(p@v)
        if a CONFLICT was raised: return CONFLICT(reason, group so far)
    return OK(group)


function FORWARD(m@v):                                   -- what does m's new version need?
    peers := peersOf(m, v)
    if peers is UNKNOWN: CONFLICT("registry doesn't list m@v")
    add := []
    for each (q, range) in peers:
        if q in group:
            if group[q] satisfies range: continue
            CONFLICT("m@v needs q range, group already has q@group[q]")
        if installed(q) is none: continue                -- npm installs missing peers itself
        if installed(q) satisfies range: continue        -- already fits, stays out
        pick := lowest version in candidates[q] satisfying range
        if none: CONFLICT("m@v needs q range; installed …, offered …")
        add.append(q@pick)
    return add


function REVERSE(m@v):                                   -- what breaks if m moves to v?
    add := []
    for each d in directDeps() whose installed version lists m as a peer with range r:
        if v satisfies r: continue                       -- still accepted
        if d in group:
            if ACCEPTS(d@group[d], m@v): continue        -- its *new* version decides
            CONFLICT("d@group[d] doesn't accept m@v")
        pick := lowest version x in candidates[d] where ACCEPTS(d@x, m@v)
        if none: CONFLICT("d accepts m r, not v, and no offered d version does")
        add.append(d@pick)
    return add


function ACCEPTS(d@x, m@v):
    peers := peersOf(d, x)
    if peers is UNKNOWN: return false
    if d@x doesn't list m as a peer: return true         -- no longer requires it
    return v satisfies that range
```

Every `CONFLICT(...)` immediately stops `BUILD_GROUP`. A registry failure
(5xx, timeout) is **not** a conflict; it's passed on as an error.

### Step 3: plan every package, with merging

```
function PLAN(suggestions):
    candidates := package → all offered versions
    groups     := []                                     -- ordered list of groups
    owner      := package → the group it belongs to
    skipped    := []

    for each package P in Renovate order:
        if P in owner: continue                          -- already part of a group
        seed   := P @ NEXT_LEAP(rows of P)
        merged := []                                     -- earlier groups absorbed so far

        loop:                                            -- rebuild until nothing new is reached
            result := BUILD_GROUP(members of all groups in merged + [seed], candidates)
                      -- on registry error: skipped += (P, "couldn't check peers: …"); next package
            if result is CONFLICT: break
            reached := { owner[x] for x in result.members if x in owner } − merged
            if reached is empty: break
            merged := merged + reached

        if result is CONFLICT:
            skipped += (P, result.reason)                -- earlier groups stay untouched
            continue

        position := min index in groups of any group in merged, or end of list if merged is empty
        remove every group in merged from groups
        insert result.members into groups at position
        for each x in result.members: owner[x] := this group

    return groups, skipped
```

- A package with no peer issues ends up as a group of one: one
  `BUILD_GROUP` pass, nothing reached.
- An **overlap** is the case where `reached` isn't empty. The earlier
  groups' members are added as fixed seeds and the group is rebuilt.
- A **merge conflict** is when the new package needs a different version
  than an earlier group already chose. `result` is then a `CONFLICT`, the
  earlier groups are never removed, and only `P` is skipped.

## Known limitations

- **Choices are never revisited** (see Conflicts). A conflict could
  sometimes be avoided by picking a higher version.
- **Peers installed only indirectly cause false conflicts.** If a needed
  peer is installed only because some other package depends on it, Renovate
  never offers versions for it, so the group always conflicts - even though
  npm could install a fitting version on its own. Real example: `vite 6`
  needs `yaml ^2.4.2`, which is installed only indirectly at `1.10.2`. Not
  fixed yet.
- **Order still matters in one case.** A package skipped earlier in a run
  isn't retried when a later merge would have made it fit. The next daily
  run picks it up.
- **Only direct dependencies are checked in the reverse direction.** An
  indirectly installed package that peer-depends on an upgraded one isn't
  seen; `npm install` then fails loudly with `ERESOLVE`.
- **A registry outage affects the whole run.** The reverse check asks the
  registry about every direct dependency, so if the registry fails, every
  package in that run is skipped. The next daily run retries.
- **Merged groups can get large** (e.g. React + React DOM + MUI + type
  packages) - correct, since npm can't install them separately, but a bigger
  pull request to review.
