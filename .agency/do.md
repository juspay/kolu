# /do config

`/do` reads this file at the steps that need a project-defined command (check, fmt, test, ci, docs) and at the evidence step.

## Check command

`just check` — fast static-correctness gate. Runs `pnpm typecheck` plus `biome lint` across the workspace. CI's `ci::typecheck` runs the typecheck half and `ci::biome` runs the lint half. `just lint` is a standalone recipe that mirrors `ci::biome`.

## Format command

`just fmt` — runs `biome format --write` over the workspace plus `nixpkgs-fmt` over `.nix` files. Biome v2 is now the sole JS/TS/JSON/CSS formatter (Prettier was retired in [#710](https://github.com/juspay/kolu/issues/710)). Config lives in `biome.jsonc` at the repo root.

## Test command

Invoke the `/test` skill. It selects relevant `.feature` files from the git diff and runs `just test-quick`.

## CI command

Use the `/ci` skill for the runner mechanics (subcommands, flags, modes, retry shape). Two Kolu-specific operational notes layered on top of it:

> **Banned flags: never pass `--no-post`, `--no-strict`, or `--no-snapshot`.** CI on this repo is **always strict and always posts** GitHub commit statuses. A run that doesn't post statuses doesn't update the PR's checks — so it isn't CI, it's a private dry-run that leaves the PR looking unverified. Every CI invocation here (PR runs *and* the master pool-warming runs below) runs strict and posts. If you catch yourself reaching for an opt-out flag to "avoid disturbing the checks," that's exactly the run the PR needs.

**Linux build host: a leased pool box per run.** Static darwin (`sincereintent`) lives in `~/.config/justci/hosts.json`; the linux lane runs on one of a **fixed pool of long-lived warm Incus boxes** — `kolu-ci-1 .. kolu-ci-8` — *leased* for the run's duration, never created or destroyed on the hot path. [`ci/pu/run.sh`](../ci/pu/run.sh) wraps the whole justci invocation: it leases an idle pool box, pins justci's linux lane to it with `--host`, and releases on exit. Just call it with the PR number and your justci args:

```sh
pr=$(gh pr view --json number --jq .number)
ci/pu/run.sh "$pr" --progress json     # lease idle kolu-ci-N → run linux lane on it → release; cold-create then hosts.json fallback
ci/pu/report.sh "$pr"                   # after the run: post a PR comment — which box ran CI, per-recipe + lane-wall timings, pool status
```

[`ci/pu/report.sh`](../ci/pu/report.sh) reads the sidecar `ci/pu/run.sh` leaves in `.ci/pu-run.env` (leased box, commit, verdict, wall) plus the per-recipe timings in `.ci/pc.log`, and posts a metrics comment so every run records *which* pool box served it, how long each recipe took, and the live pool status. Run it once the lane finishes (it's cheap; safe to skip if `pu` is unavailable).

A warm leased box keeps `ci::nix` ~20s (vs ~180s on a cold box re-realising the closure) and, pulling nothing from the substituter, never triggers the concurrent-load contention that stalls cold boxes when several PRs run at once (juspay/kolu#1173). The wrapper forwards justci's stdout (so the `--progress json` stream below works unchanged) and falls back — saturated/unreachable pool → cold ephemeral `pu create` → `hosts.json` — so CI is never blocked. Box lifecycle is the [`pu`](../.apm/skills/pu/SKILL.md) skill; runner mechanics are the [`ci`](../.claude/skills/ci/SKILL.md) skill.

*Why a lease, not a fork:* the lock lives on the box (`flock`) and is held over the ssh data channel, so it auto-releases the instant the run ends — even on a hard crash (verified). This replaces the old fork-a-golden-per-run model, whose `pu fork` was unreliable — non-deterministic cross-gateway placement left the forked box unreachable (juspay/kolu#1204). Measurements and the full rationale: [`docs/pu-box-ci-ralph-report.md`](../docs/pu-box-ci-ralph-report.md).

**Keep the pool warm and healthy.** A pool box warms on its first real CI run and stays warm across leases. Bring the pool up to strength (and repair any missing/unhealthy slot) with `just ci::pool-ensure`; inspect with `just ci::pool-status`. Keep stores hot by periodically running the linux lane against `master` on idle slots (e.g. after a merge): `nix run github:juspay/justci -- run --platform x86_64-linux --host x86_64-linux=kolu-ci-<N>` (strict and posting, like every run here). (The old `kolu-ci-golden` fork template is retired — the pool boxes are themselves the warm hosts.)

**Live failure surfacing — consume the `--progress json` stream.** The CI step runs in the background (the `/do` skill backgrounds it), and `--progress json` makes the runner emit one NDJSON line to stdout per node transition the instant process-compose reports it: `{node, recipe, platform, status, exit_code?, log?}` with `status ∈ running|success|failed|skipped|errored`. **Don't wait for the run to finish, and don't poll `gh pr checks` in a loop.** Tail the backgrounded output and react the moment a node turns `failed`/`errored` — while sibling lanes are still running:

```sh
# Against the backgrounded CI output (the /do skill's task output file):
grep -o '{.*}' "$ci_output" | jq -c 'select(.status=="failed" or .status=="errored")'
# → {"node":"biome@x86_64-linux","recipe":"biome","platform":"x86_64-linux","status":"failed","exit_code":1,"log":".ci/<sha>/x86_64-linux/biome.log"}
```

The instant such a line appears, read its `log` path (`.ci/<sha>/<platform>/<recipe>.log`) to diagnose — the failing recipe's full output is already on disk before the other lanes finish. Extract JSON objects (`grep -o '{.*}'`) rather than matching line starts: process-compose shares the inherited stdout and emits its own `[<recipe>@<platform>]` log lines plus an xterm title escape that can prefix the very first JSON line. Begin the fix → fmt → commit → retry-CI loop as soon as you have a confirmed failure; you needn't let the rest of the pipeline drain first. (`gh pr checks` / `justci protect --dry-run` remain the source of truth for the *final* green-gate below — the stream is for reacting fast, the checks are for confirming done.) The `CI=true` prefix is gone: justci is strict by default now, and the var is a harmless no-op.

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

**Flake → comment on [#320](https://github.com/juspay/kolu/issues/320)** with scenario/platform/error excerpt/PR.

**Evidence required → all GitHub status checks green per `justci protect`.** `/do` is done only when every required status check is green on the PR's current `HEAD`. Source the required list from `justci protect --dry-run` — it prints the `<recipe>@<platform>` contexts the canonical DAG produces, which are exactly the contexts branch protection gates on. Verify with `gh pr checks`; a green from a positional retry counts (final state matters).

## Documentation

Keep these docs in sync:

- **`README.md`** (top-level) — user-facing changes, architecture prose, transport-resilience description.
- **`packages/surface/README.md`** — the `@kolu/surface` framework reference. The "How Kolu uses this framework" section is a concrete inventory of every cell, collection, and stream descriptor plus the raw-oRPC procedures that stay outside the framework. Update it whenever a new descriptor lands or whenever a contract entry's classification changes (added mutation, retired stream, …).
- **`website/src/pages/index.astro`** — the kolu.dev marketing page. Its hero terminal + canvas-strip mockups (dock cards, split tile with `claude` + `just test`, codex apply_patch tile, opencode planning tile, Code-tab tree + preview) approximate the running Kolu app. When a user-facing surface changes shape — a new dock-row affordance, a renamed agent integration, a different split layout, a new chip state, a new Code-tab tab, a new theme name worth name-dropping — refresh the mockup so the marketing visual doesn't drift from the product. Drive the running app via `chrome-devtools` MCP if you want a reference screenshot to model from — launch it with the [`dev-server`](../.apm/skills/dev-server/SKILL.md) skill (`just dev-auto` on two random free ports, remembered for the session), never `just dev` on the fixed defaults that collide with production.

## PR evidence

Post a `## Evidence` PR comment when **any** of these holds — the trigger is "is there behavior worth proving?", not "does a pixel change?":

1. **Visible UI impact** — capture screenshots, or **video** when the change is about motion (an animation, a transition, a multi-step interaction a still can't convey). Use judgment — server-only diffs sometimes ripple into rendering.
2. **Behavioral / round-trip changes** — the diff touches a persistence, restore, session, autosave, debounce/coalesce, or reconnect path, and the proof is *"state survives an interaction or a restart,"* not a pixel change. Capture the before→after **behavior** — often with **zero visual diff** (e.g. resize → stop kolu → start → restore session → the panel returns at the resized width). A video of the round-trip is the proof the fix didn't break recoverability.
3. **Bug fixes generally** — the default for a fix is *"demonstrate the fixed behavior."* The bug was often a storm, a lost write, or a hang, so a before/after or survives-restart clip is the evidence **even when nothing looks different**. Don't skip evidence just because a fix has no visual diff; skip only when the behavior genuinely can't be observed (e.g. a pure internal refactor with no externally visible effect).

**Capture by recording an e2e scenario — the [`evidence`](../.apm/skills/evidence/SKILL.md) skill owns the procedure** (it builds on the [`pu`](../.apm/skills/pu/SKILL.md) skill; everything runs on an ephemeral `pu` box, off-machine, the way CI runs e2e). Kolu's e2e suite (`@cucumber/cucumber` + Playwright) already drives every UI surface through a maintained step library, so you capture a clip by *recording a scenario* — selected **by name**, with no edit to the feature file — never a hand-rolled Playwright script. Pick the scenario that exercises the change (or author a tiny one reusing existing steps); on the box the skill runs it with `KOLU_EVIDENCE=1`, which makes `packages/tests/support/hooks.ts` record the `.webm` (recordVideo + slowMo, animations left on), then transcodes (ffmpeg → GIF/mp4), uploads to the `evidence-assets` release, and links the shared Pages player.

```sh
KOLU_EVIDENCE=1 just test-quick features/<file>.feature --name "<scenario name>"
# → packages/tests/reports/videos/<scenario>.webm
```

Rationale + the ecosystem survey: [`docs/atlas/src/content/atlas/video-evidence.mdx`](../docs/atlas/src/content/atlas/video-evidence.mdx).

**Capturing a state no scenario reaches (live chrome-devtools path).** When the evidence skill's "drive the state live" step (§A2) runs on *your machine* rather than a `pu` box, launch kolu with the [`dev-server`](../.apm/skills/dev-server/SKILL.md) skill — it boots on two random free ports via `just dev-auto`, remembers them for the session, and hands chrome-devtools the right client URL. This is mandatory: an agent that ran a bare `just dev` for evidence on [#1109](https://github.com/juspay/kolu/issues/1109) bound production's fixed ports and disrupted the live `kolu.service`. Never run the app for evidence any other way; never touch the systemd unit.

### Agent-state scenarios

When the change touches the Dock, terminal, or any UI surface that reflects agent activity, the capture has to show real states — a blank Dock proves nothing. Kolu's opencode integration is first-class: have the scenario you're recording open a terminal and run opencode in it (an `I run "…"` step); the preexec hook surfaces state in the Dock within ~300ms (states: `thinking`, `tool_use`, `awaiting_user`, `waiting`; bucketed in the Dock as `working ▸`, `awaiting ⏵`, `idle ☾`).

```sh
# Inside a Kolu terminal on the box — no global install needed
nix run github:juspay/AI#opencode
```

Drive distinct states by prompt:

- **thinking / tool_use** (`working ▸`, pulsing border) — send a reasoning- or tool-heavy prompt (`explain the architecture of this repo`, `list every file in src/`); capture during the spinner.
- **awaiting_user** (`awaiting ⏵`, breathing border) — request an action that needs confirmation (e.g. an edit opencode wants to apply).
- **waiting / idle** (`idle ☾`) — let the reply finish; the row drops to the idle bucket.

For PRs whose changes affect one state, a single representative capture is fine; capture each when the change spans multiple. The default evidence for any Dock-touching change is **a screenshot of the Dock showing an agent state with a visible opencode reply** — that single frame proves the pipeline (terminal → provider → Dock) is alive end-to-end.
