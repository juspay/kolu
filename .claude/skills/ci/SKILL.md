---
name: ci
description: Run this repo's CI end-to-end — the kolu-specific procedure on top of the odu runner: the odu MCP front door, banned opt-out flags, mandatory two-platform coverage, venue-pool leasing, fail-fast surfacing, e2e timing evidence, and the green-gate. Triggers on "run CI", "drive CI", "re-run the pipeline", "close the red check", "warm the pool". Runner mechanics live in the `/odu` skill.
---

# CI

**Drive CI through the odu MCP server — the single front door.** The runner is
**odu** (npins-pinned by `ci/flake.nix`, `nix run ./ci#odu`): `mcp__odu__run`
spawns the coordinator, `mcp__odu__wait_for_settle` blocks until settle or first
red node (its verdict is stamped `sha7#seq`; pass `expected_sha` to hard-check),
the `surface://collections/logs/{id}` resource drills into a failure,
`mcp__odu__node_rerun` closes a red check. Runner mechanics: `/odu` skill.

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

**Every run covers both platforms.** Pin them explicitly —
`platforms=["x86_64-linux", "aarch64-darwin"]` — never trust a machine-local
default: a platform you don't name **silently drops**; a named platform with no
pool entry is **refused loudly** (juspay/odu#46). Before reporting green,
confirm the settled run actually carried both — a single-platform green is a
false green.

**Darwin hosts: read `hosts.json`, never this skill.** The darwin fleet is
volatile (this file hard-named the live box three times and was stale each
time) — `~/.config/odu/hosts.json` (`nix run ./ci#odu -- hosts`) is the only
source of truth; copy entries verbatim when pinning (user@ and tailnet suffixes
differ). Durable rules: under a coordinator, ask it before every darwin
dispatch (single-tenant); treat fs-watch-class reds on darwin as suspect box
environment and report before chasing; a dead pool entry silently stalls the
whole darwin lane — report it for removal rather than waiting it out.

**A companion repo's darwin lane uses `--host aarch64-darwin=<box>`, never
inline `$ODU_HOSTS`** — odu reads `$ODU_HOSTS` as a *file path*, so inline JSON
is silently ignored and burns a run on a dead host.

**Linux lane: odu leases natively** from the warm Incus pool
(`kolu-ci-1..8` in `hosts.json`) — picks a free box, holds it for the run,
releases on settle. No manual leasing. Saturated pool waits in line
(`no_wait: true` to fail fast instead); `nix run ./ci#odu -- hosts` shows
free/busy. To keep the *same* hot box across fix→rerun cycles, take an
agent-held lease with `mcp__odu__lease` first and `mcp__odu__release` when
done. Pool upkeep: `just ci::pool-ensure` / `just ci::pool-status`; warm idle
slots by running the linux lane against master with a `hosts=` pin (strict and
posting, like every run).

**Fail fast on the MCP; don't drain the pipeline.** `wait_for_settle` returns
on the first red node with `{failed[], errored[]}` — read the red node's log
(the log resource, or `.ci/<sha7>/<platform>/<recipe>.log`) and start the
fix → fmt → commit → retry loop immediately; don't poll `gh pr checks` in a
loop. `errored` (vs `failed`) means infrastructure death — `node_rerun` it
rather than hunting a test bug.

**`pu` misbehaves → log it on
[juspay/kolu#1204](https://github.com/juspay/kolu/issues/1204)** via
`.apm/skills/ci/pu/diagnose.sh <stage> <host>` (best-effort, never blocks the
run). Capture the stage's stderr:
`pu create "$host" 2> >(tee /tmp/pu-$host.err >&2)`.

**After a green two-platform settle, post e2e metrics to the PR.** Source of
truth: the run ledger `.ci/<sha7>/runs/<seq>.json` for each `ci::e2e@<platform>`
node's recipe-wall `durationMs` and host (never Cucumber's internal timer), and
the LAST `^e2e: workers=` line in `.ci/<sha7>/<platform>/ci::e2e.log` for
resolved parallelism. Maintain **one** comment keyed by the
`<!-- kolu-ci-e2e-metrics -->` marker (edit if present, create if absent) with
the run identity `<sha7>#<seq>` and a table of
`platform · host · workers · cores · cap · e2e duration`. Fail loud rather than
comment if any ingredient is missing. Post only after the full run settles
green, before reporting the gate.

**The green-gate: every required status check green on the PR's current
`HEAD`.** Source the required list from `just ci::protect --dry-run` **with
both explicit `--platform` flags** — without them odu derives platforms from
the machine-local `hosts.json` and can emit a single-platform subset, a false
green. Verify with `gh pr checks` (a green from a retry counts).

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
