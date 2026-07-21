---
name: ci
description: Run this repo's CI end-to-end — the kolu-specific operational procedure layered on top of the odu runner. Covers the odu MCP front door, the banned opt-out flags, mandatory two-platform (linux + darwin) coverage, the linux warm-pool lease flow, darwin host arbitration, live fail-fast surfacing, the flaky-test tracker, and the green-gate. Triggers on "run CI", "drive CI", "re-run the pipeline", "close the red check", "warm the pool". For the underlying runner mechanics (subcommands, flags, modes, the socket surface) use the `/odu` skill.
---

# CI

**Drive CI through the odu MCP server — it is the single front door.** The runner is **odu** ([github.com/juspay/odu](https://github.com/juspay/odu), npins-pinned and re-exported as `nix run .#odu`), which replaced justci — same status contexts, same per-SHA logs, same flag table. Start and watch a run with the MCP tools, not a shell wrapper: `mcp__odu__run` (spawns the background coordinator), `mcp__odu__wait_for_settle` (block until settle / first red node — it fails loud when no run is live, and its verdict is stamped with the run's `sha7#seq` identity; pass `expected_sha` to hard-check it), the `surface://collections/logs/{id}` MCP **resource** (drill into a failure — there is no log tool), `mcp__odu__node_rerun` (close a red check). Use the `/odu` skill for the underlying runner mechanics (subcommands, flags, modes, the socket surface). Two Kolu-specific operational notes layered on top of it:

> **Banned flags: never pass `--no-post`, `--no-strict`, or `--no-snapshot`.** CI on this repo is **always strict and always posts** GitHub commit statuses. A run that doesn't post statuses doesn't update the PR's checks — so it isn't CI, it's a private dry-run that leaves the PR looking unverified. Every CI invocation here (PR runs *and* the master pool-warming runs below) runs strict and posts. If you catch yourself reaching for an opt-out flag to "avoid disturbing the checks," that's exactly the run the PR needs.

**Push before CI.** odu's remote lanes `git fetch` the pinned HEAD SHA from origin (no git-bundle transport) — an unpushed commit cannot run on the pool box or rasam. The `/do` flow pushes before the CI step anyway; keep it that way.

**Every CI run covers both platforms — `x86_64-linux` *and* `aarch64-darwin`.** kolu builds on both; a linux-only run is not CI, it leaves the macOS lane's required checks unposted. Pin both lanes explicitly in `mcp__odu__run` (see the flow below) rather than relying on a machine-local hosts file — that way a run is two-platform by construction on any machine, not just one where `~/.config/odu/hosts.json` happens to list the darwin host. **A platform you don't explicitly pin silently drops from the fanout**, so before reporting CI green, confirm the settled run actually *carried* both platforms — a darwin-only or linux-only green is a false single-platform green, not full CI.

**Darwin build host: coordinator-arbitrated — two boxes, each with a caveat.** When a coordinator is running the campaign, ASK IT before every darwin dispatch (single-tenant rule); solo, pick per the caveats:
- **`rasam`** (`aarch64-darwin=nix-infra@rasam.tail12b27.ts.net`; Apple Silicon T6020, 24 cores, 128 GB): **co-tenanted by a vira CI daemon** (discovered 2026-07-16) that schedules multi-hour builds of other projects at will — check `ps axo pid,etime,command | grep 'nix build'` before dispatching, and expect load-class flakes (and possible ssh-transport death) if you share it mid-build. Its fseventsd has also run pegged for weeks between reboots.
- **`sincereintent`** (`aarch64-darwin=srid@sincereintent` — BARE tailnet name on a different tailnet, the `.tail12b27.ts.net` suffix does NOT resolve there, and it's `srid@`, not `nix-infra@`): UN-retired for kolu CI by srid (2026-07-16) and since proven by a 5× zero-retry certification. Caveat: a stale-FSEvents history — treat fs-watch-class reds (iframe-refresh, file-watch waitFors) as suspect box environment, report before chasing.

**A companion repo's darwin lane uses `--host`, never inline `$ODU_HOSTS`.** A `@kolu/surface` change drags a downstream repo's CI along (e.g. the drishti PR `surface.md` requires), and that repo's CI is the shelled-out `nix run … odu -- run` path, not `mcp__odu__run`. Its own `hosts.json` may name a *different*, possibly-dark darwin host (drishti's `zest`); pin the override with **`--host aarch64-darwin=<the arbitrated darwin host — see above>`** (per the `/odu` skill) — **never** by exporting inline JSON into `$ODU_HOSTS`, which odu reads as a *file path*, not a value: an inline `$ODU_HOSTS='{…}'` is **silently ignored**, the lane falls back to the repo's on-disk `zest`, and you burn a full CI run on the dead host. If you must set `$ODU_HOSTS`, write a real hosts *file* and point at it.

**Linux build host: a leased pool box per run.** The linux lane runs on one of a **fixed pool of long-lived warm Incus boxes** — `kolu-ci-1 .. kolu-ci-8` — *leased* for the run's duration, never created or destroyed on the hot path. Since the MCP owns the run, the lease can no longer wrap it; [`.apm/skills/ci/pu/lease.sh`](pu/lease.sh) holds the box as a **separate background process** and you pass its box pin to `mcp__odu__run`. The three-step flow:

```sh
pr=$(gh pr view --json number --jq .number)

# 1) Acquire + HOLD a box in the background (Bash run_in_background). It writes
#    .ci/pu-lease.env and prints PU_LEASE_HOST=x86_64-linux=<box> (empty on the
#    saturated → cold-ephemeral → hosts.json fallback), then blocks holding it.
.apm/skills/ci/pu/lease.sh acquire "$pr"   # ← run this in the background

# 2) Read the linux pin and start the run THROUGH the MCP. Pin BOTH lanes and
#    request BOTH platforms, so every CI run covers linux *and* macOS — never
#    silently linux-only because a machine-local hosts.json lacks the darwin
#    entry: the leased linux box, plus the arbitrated darwin host (see above).
host=$(. .ci/pu-lease.env; echo "$PU_LEASE_HOST")
#    mcp__odu__run  platforms=["x86_64-linux", "aarch64-darwin"]
#                   hosts=["$host", "aarch64-darwin=<arbitrated darwin host>"]
#                   (if $host is empty — pool saturated — drop it but KEEP the darwin pin)
#    mcp__odu__wait_for_settle          (then read the log resource / node_rerun as needed)

# 3) Release the box (frees the flock; or just stop the backgrounded task).
.apm/skills/ci/pu/lease.sh release
```

The lease auto-releases even on a hard crash: stop the backgrounded `acquire` (or end the session) and its open fd dies → the box's `flock` frees within seconds (a `read -t TTL` half-open backstop and a `MAX_HOLD` leak backstop cover the rest). An empty `PU_LEASE_HOST` means the pool was saturated/unreachable and `lease.sh` either took a cold ephemeral box (recorded in `.ci/pu-lease.env`) or left it to `hosts.json` — in that case drop the `$host` pin but **keep the rasam `aarch64-darwin` pin** so the macOS lane still runs.

A warm leased box keeps `ci::nix` ~20s (vs ~180s on a cold box re-realising the closure) and, pulling nothing from the substituter, never triggers the concurrent-load contention that stalls cold boxes when several PRs run at once (juspay/kolu#1173). Box lifecycle is the [`pu`](.claude/skills/pu/SKILL.md) skill; runner mechanics are the [`odu`](.claude/skills/odu/SKILL.md) skill; the MCP face is the [`odu-mcp`](.claude/skills/odu-mcp/SKILL.md) skill.

*Why a lease, not a fork:* the lock lives on the box (`flock`) and is held over the ssh data channel, so it auto-releases the instant the run ends — even on a hard crash (verified). This replaces the old fork-a-golden-per-run model, whose `pu fork` was unreliable — non-deterministic cross-gateway placement left the forked box unreachable (juspay/kolu#1204). Measurements and the full rationale: [`docs/pu-box-ci-ralph-report.md`](docs/pu-box-ci-ralph-report.md).

**Keep the pool warm and healthy.** A pool box warms on its first real CI run and stays warm across leases. Bring the pool up to strength (and repair any missing/unhealthy slot) with `just ci::pool-ensure`; inspect with `just ci::pool-status`. Keep stores hot by periodically running the linux lane against `master` on idle slots (e.g. after a merge) — `mcp__odu__run` with `platforms=["x86_64-linux"]` and `hosts=["x86_64-linux=kolu-ci-<N>"]` (strict and posting, like every run here; warming targets a specific idle box deliberately, so no lease is needed). (The old `kolu-ci-golden` fork template is retired — the pool boxes are themselves the warm hosts.)

**Live failure surfacing — fail fast on the MCP, don't drain the pipeline.** `mcp__odu__wait_for_settle` returns the instant a node goes red (`fail_fast` defaults true) with `{settled, passed, failed[], errored[]}` — so you learn about a failure while sibling lanes are still running. **Don't wait for the whole run to finish, and don't poll `gh pr checks` in a loop.** The moment `wait_for_settle` returns a non-empty `failed[]`/`errored[]`, drill in: read the red node's log via the `surface://collections/logs/{id}` MCP resource (or read the `.ci/<sha7>/x86_64-linux/<recipe>.log` path directly — the failing recipe's full output is already on disk). Begin the fix → fmt → commit → retry-CI loop as soon as you have a confirmed failure; you needn't let the rest of the pipeline drain first. (`gh pr checks` / `nix run .#odu -- protect --dry-run` remain the source of truth for the *final* green-gate below — the MCP is for reacting fast, the checks are for confirming done.) A node in `errored` (as opposed to `failed`) means infrastructure death — a lane's ssh link dropped or the coordinator was interrupted; `mcp__odu__node_rerun` those rather than hunting for a test bug.

**`pu` misbehaves → log it on [juspay/kolu#1204](https://github.com/juspay/kolu/issues/1204) with full diagnostics.** Whenever `pu` fails to do its job — `create`/`fork` errors out, a box lands with no egress (`nix run` hangs on "Resolving timed out"), a fork lands cross-gateway and is unreachable, retries keep landing on dead hosts, or `connect`/`destroy` misbehaves — don't just silently fall back. **Post a comment on the central pu-issues log [#1204](https://github.com/juspay/kolu/issues/1204)** so the `pu`/Incus admin can read across sessions and fix the underlying host permanently instead of every run papering over it. **This applies in every session, not only `/do`** — any time `pu` misbehaves, drop a #1204 comment. Gather everything the admin needs to pin the bad physical host, then continue per the fallback above (a diagnostic comment must never block the run).

```sh
# $host is the box name; $stage is the pu subcommand that misbehaved (create|connect|destroy|egress)
{
  echo "## ⚠️ \`pu\` misbehaved — Incus admin attention needed"
  echo
  echo "- **PR:** #$pr &nbsp; **branch:** \`$(git rev-parse --abbrev-ref HEAD)\` &nbsp; **commit:** \`$(git rev-parse --short HEAD)\`"
  echo "- **Stage:** \`pu $stage\` &nbsp; **box:** \`$host\` &nbsp; **when:** $(date -u +%FT%TZ)"
  echo
  echo "**Box placement (\`pu list\` — NAME + physical LOCATION that needs fixing):**"
  echo '```'; pu list 2>&1 | grep -E "NAME|$host"; echo '```'
  echo "**\`pu $stage\` stderr:**"
  echo '```'; cat /tmp/pu-$host.err 2>/dev/null; echo '```'
  # Box-side network state — only if the box came up enough to SSH into
  echo "**Box network state (resolv.conf / routes / egress / gateway TCP):**"
  echo '```'
  pu connect "$host" -- '
    echo "== /etc/resolv.conf =="; cat /etc/resolv.conf
    echo "== ip route ==";        ip route
    echo "== egress probe ==";    timeout 15 curl -sS -o /dev/null -w "https HTTP %{http_code}\n" https://api.github.com || echo "egress FAILED"
    echo "== gateway TCP ==";     gw=$(ip route | awk "/default/{print \$3; exit}"); timeout 5 bash -c "echo > /dev/tcp/$gw/443" && echo "gw $gw:443 ok" || echo "gw $gw:443 FAILED"
  ' 2>&1
  echo '```'
} | gh issue comment 1204 --repo juspay/kolu --body-file -
```

To capture each stage's stderr for the excerpt above, tee it when you invoke `pu` — e.g. `pu create "$host" 2> >(tee /tmp/pu-$host.err >&2)`.

**Flake → update the [Flaky Test Tracker](docs/atlas/src/content/atlas/flaky-test-tracker.mdx) Atlas note in the SAME PR** (published at <https://kolu.dev/atlas/flaky-test-tracker.html>) — never defer it to a later cleanup. Add a row when your CI surfaces a flake (columns are exactly the tracker's schema: scenario, `recipe@platform` lane, the assertion/timeout symptom, the PR it reproduced in, and status); flip a row to `fixed` (and strike it) when the PR fixes one; and regenerate + commit `docs/atlas/dist/` in the same change. Logging/updating alongside the PR is the obligation; an agent works the backlog from time to time. *(The old GitHub flaky-tests log — issue #320 — is retired: flakes live in the Atlas note now.)*

**Evidence required → all GitHub status checks green per `odu protect`.** CI is done only when every required status check is green on the PR's current `HEAD`. Source the required list from `nix run .#odu -- protect --dry-run` — it prints the `<recipe>@<platform>` contexts the canonical DAG produces, which are exactly the contexts branch protection gates on. Verify with `gh pr checks`; a green from a positional retry counts (final state matters).
