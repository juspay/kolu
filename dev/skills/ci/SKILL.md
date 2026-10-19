---
name: ci
description: Run this repo's CI end-to-end — kolu's policy on top of the odu runner: banned opt-out flags, x86_64-linux pinning, pool upkeep, fail-fast surfacing, e2e timing evidence, and the green-gate. Triggers on "run CI", "drive CI", "re-run the pipeline", "close the red check", "warm the pool". Runner mechanics live in the `/odu` skill.
---

# CI

Run CI through **odu**; its verbs, flags, MCP front door and venue leasing are
the `/odu` skill. This skill is what kolu adds on top.

**Banned flags: never `--no-post`, `--no-strict`, `--no-snapshot`.** CI here is
always strict and always posts commit statuses — a run that doesn't post isn't
CI, it's a private dry-run that leaves the PR unverified.

**Push before CI** — remote lanes `git fetch` the pinned SHA from origin; an
unpushed commit can't run.

**Sync master before CI, every run, whoever is driving.** Fetch and merge
`origin/<default>` unless it's already an ancestor
(`git merge-base --is-ancestor`). The changelog is `merge=union` and never
conflicts; a real conflict is yours to resolve now. Never merge while a
gauntlet round is mid-commit — it races the index.

**Every run is `x86_64-linux` ONLY.** Pin it explicitly —
`platforms=["x86_64-linux"]` — never trust a machine-local default: a platform
you don't name **silently drops**, and an unpinned run picks up whatever
`hosts.json` happens to list. A linux green IS the green this repo gates on;
master's required-status set is linux-only.

**Never run `aarch64-darwin` unless the user asks for it in THIS
conversation.** Not "to be safe", not because a change looks platform-shaped.
Darwin's Nix closure is built by `.github/workflows/nix-cache.yml` on every
push — that lane is GitHub's to drive, not yours.

**Kolu's Linux pool:** `just ci::pool-ensure` / `just ci::pool-status` keep the
warm `kolu-ci-1..N` boxes healthy; odu leases them natively. Warm idle slots by
running the linux lane against master with a `hosts=` pin (strict and posting,
like every run).

**Fail fast:** read the first red node's log (the log resource, or
`.ci/<sha7>/<platform>/<recipe>.log`) and start the fix → fmt → commit → retry
loop immediately. Re-invoke the wait rather than parking a background watcher
over the ledger; a watcher that only detects settle forfeits first-red.

**`pu` misbehaves → log it on
[juspay/kolu#1204](https://github.com/juspay/kolu/issues/1204)** via
`dev/skills/ci/pu/diagnose.sh <stage> <host>` (best-effort, never blocks the
run). Capture the stage's stderr:
`pu create "$host" 2> >(tee /tmp/pu-$host.err >&2)`.

**After a green settle, post e2e metrics to the PR.** Source of
truth: the run ledger `.ci/<sha7>/runs/<seq>.json` for each `ci::e2e@<platform>`
node's recipe-wall `durationMs` and host (never Cucumber's internal timer), and
the LAST `^e2e: workers=` line in that node's own log (an unsharded lane's is
`.ci/<sha7>/<platform>/ci::e2e.log`) for resolved parallelism. Maintain
**one** comment keyed by the
`<!-- kolu-ci-e2e-metrics -->` marker (edit if present, create if absent) with
the run identity `<sha7>#<seq>` and a table of
`platform · host · workers · cores · cap · shards · e2e duration`. Fail loud
rather than comment if any ingredient is missing. Post only after the full run
settles green, before reporting the gate.

**`ci::e2e` is sharded, so the ledger carries shard nodes and the comment has
rows for them.** `[metadata("odu:shard=4")]` lets odu borrow up to four free
pool slots on Linux; the slices are ledger nodes `ci::e2e[k-of-N]@<platform>`
(their burst dependency copies are `ci::e2e[k-of-N]::ci::install` and
`…::ci::nix`), and they fold into the ONE logical `ci::e2e@<platform>` node
whose duration is the slowest slice. So:

- the `shards` column is **obtained/ceiling** (`3/4`) — read the obtained count
  from the shard nodes present in the ledger, never assume four;
- add **one row per shard** (`host · workers · cores · duration`) under the
  logical row. A sharded `ci::e2e.log` holds only odu's fold bracket
  (`[odu] N shards started…`), so each shard's `^e2e: workers=` and
  `e2e: shard=<k>/<N>` lines come from its OWN
  `.ci/<sha7>/<platform>/ci::e2e[k-of-N].log`;
- a darwin lane (only ever present when explicitly requested) has a
  single-host pool: `1/4` and exactly one row;
- re-run ONE shard node (`ci::e2e[2-of-3]@x86_64-linux`), not the logical
  context: re-running the fold would re-run every slice.

**The green-gate: every required status check green on the PR's current
`HEAD`.** Source the required list from `just ci::protect --dry-run` — the
script pins `x86_64-linux` itself, so no `--platform` flag is needed (pass
`--platform aarch64-darwin` only on a run you were explicitly asked to take to
darwin). Verify with `gh pr checks` (a green from a retry counts).

**Code-scanning alerts block merge too, and `gh pr checks` doesn't show them.**
Query **by PR number, never by branch ref** — code scanning here is GitHub's
default setup, which analyses only the default branch and `refs/pull/<n>/*`, so
a `ref=refs/heads/<branch>` query answers "no alerts" about a ref nobody
scanned (measured on #2017: branch ref → 0, `pr=2017` → an open HIGH):

```
gh api "repos/{owner}/{repo}/code-scanning/alerts?state=open&pr=<n>" \
  --jq '.[] | "\(.rule.security_severity_level) \(.rule.id) \(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line)"'
```

Fix every alert on code this PR introduced; name (don't silently ignore) any
pre-existing alert on untouched code.
