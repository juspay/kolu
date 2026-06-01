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

**Ephemeral linux build host per run.** Static darwin (`sincereintent`) lives in `~/.config/ci/hosts.json`; the linux lane uses a throwaway Incus container per CI invocation so prior runs' nix-store cruft can't poison the verdict. (Box lifecycle — create/connect/destroy, the no-egress retry — is the [`pu`](../.apm/skills/pu/SKILL.md) skill.) If `pu create` fails (e.g. no-egress), drop the `--host` flag and let justci fall back to `hosts.json` resolution for the linux lane rather than blocking the run.

```sh
pr=$(gh pr view --json number --jq .number)
host="kolu-pr-$pr"
if pu create "$host"; then                                                             # name is positional; writes ~/.pu-state/$host/ssh_config (included by ~/.ssh/config)
  nix run github:juspay/ci -- run --progress json --host x86_64-linux="$host"           # --host wins over hosts.json on collision; darwin keeps using sincereintent
  pu destroy "$host"
else                                                                                    # pu provisioning failed (e.g. no-egress) — drop --host and let hosts.json resolve the linux lane
  nix run github:juspay/ci -- run --progress json
fi
```

**Live failure surfacing — consume the `--progress json` stream.** The CI step runs in the background (the `/do` skill backgrounds it), and `--progress json` makes the runner emit one NDJSON line to stdout per node transition the instant process-compose reports it: `{node, recipe, platform, status, exit_code?, log?}` with `status ∈ running|success|failed|skipped|errored`. **Don't wait for the run to finish, and don't poll `gh pr checks` in a loop.** Tail the backgrounded output and react the moment a node turns `failed`/`errored` — while sibling lanes are still running:

```sh
# Against the backgrounded CI output (the /do skill's task output file):
grep -o '{.*"node":.*}' "$ci_output" | jq -c 'select(.status=="failed" or .status=="errored")'
# → {"node":"biome@x86_64-linux","recipe":"biome","status":"failed","exit_code":1,"log":".ci/<sha>/x86_64-linux/biome.log"}
```

The instant such a line appears, read its `log` path (`.ci/<sha>/<platform>/<recipe>.log`) to diagnose — the failing recipe's full output is already on disk before the other lanes finish. Extract JSON objects (`grep -o '{.*}'`) rather than matching line starts: process-compose shares the inherited stdout and emits its own `[<recipe>@<platform>]` log lines plus an xterm title escape that can prefix the very first JSON line. Begin the fix → fmt → commit → retry-CI loop as soon as you have a confirmed failure; you needn't let the rest of the pipeline drain first. (`gh pr checks` / `justci protect --dry-run` remain the source of truth for the *final* green-gate below — the stream is for reacting fast, the checks are for confirming done.) The `CI=true` prefix is gone: justci is strict by default now, and the var is a harmless no-op.

**`pu` misbehaves → comment on the PR with full diagnostics.** Whenever `pu` fails to do its job — `create` errors out, a box lands with no egress (`nix run` hangs on "Resolving timed out"), retries keep landing on dead hosts, or `connect`/`destroy` misbehaves — don't just silently fall back. Post a PR comment so the `pu`/Incus admin can fix the underlying host permanently instead of every run papering over it. Gather everything the admin needs to pin the bad physical host, then drop `--host` and continue per the fallback above (a diagnostic comment must never block the run).

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
} | gh pr comment "$pr" --body-file -
```

To capture each stage's stderr for the excerpt above, tee it when you invoke `pu` — e.g. `pu create "$host" 2> >(tee /tmp/pu-$host.err >&2)`.

**Flake → comment on [#320](https://github.com/juspay/kolu/issues/320)** with scenario/platform/error excerpt/PR.

**Evidence required → all GitHub status checks green per `justci protect`.** `/do` is done only when every required status check is green on the PR's current `HEAD`. Source the required list from `justci protect --dry-run` — it prints the `<recipe>@<platform>` contexts the canonical DAG produces, which are exactly the contexts branch protection gates on. Verify with `gh pr checks`; a green from a positional retry counts (final state matters).

## Documentation

Keep these docs in sync:

- **`README.md`** (top-level) — user-facing changes, architecture prose, transport-resilience description.
- **`packages/surface/README.md`** — the `@kolu/surface` framework reference. The "How Kolu uses this framework" section is a concrete inventory of every cell, collection, and stream descriptor plus the raw-oRPC procedures that stay outside the framework. Update it whenever a new descriptor lands or whenever a contract entry's classification changes (added mutation, retired stream, …).
- **`website/src/pages/index.astro`** — the kolu.dev marketing page. Its hero terminal + canvas-strip mockups (dock cards, split tile with `claude` + `just test`, codex apply_patch tile, opencode planning tile, Code-tab tree + preview) approximate the running Kolu app. When a user-facing surface changes shape — a new dock-row affordance, a renamed agent integration, a different split layout, a new chip state, a new Code-tab tab, a new theme name worth name-dropping — refresh the mockup so the marketing visual doesn't drift from the product. Drive the running app via `chrome-devtools` MCP if you want a reference screenshot to model from (`just dev-auto` boots Kolu on two free ports with HMR and prints the client URL).

## PR evidence

Post a `## Evidence` PR comment when **any** of these holds — the trigger is "is there behavior worth proving?", not "does a pixel change?":

1. **Visible UI impact** — capture screenshots, or **video** when the change is about motion (an animation, a transition, a multi-step interaction a still can't convey). Use judgment — server-only diffs sometimes ripple into rendering.
2. **Behavioral / round-trip changes** — the diff touches a persistence, restore, session, autosave, debounce/coalesce, or reconnect path, and the proof is *"state survives an interaction or a restart,"* not a pixel change. Capture the before→after **behavior** — often with **zero visual diff** (e.g. resize → stop kolu → start → restore session → the panel returns at the resized width). A video of the round-trip is the proof the fix didn't break recoverability.
3. **Bug fixes generally** — the default for a fix is *"demonstrate the fixed behavior."* The bug was often a storm, a lost write, or a hang, so a before/after or survives-restart clip is the evidence **even when nothing looks different**. Don't skip evidence just because a fix has no visual diff; skip only when the behavior genuinely can't be observed (e.g. a pure internal refactor with no externally visible effect).

**The mechanics live in the [`evidence`](../.apm/skills/evidence/SKILL.md) skill** (which builds on the [`pu`](../.apm/skills/pu/SKILL.md) skill): capture runs on an ephemeral `pu` box — `nix run`, Chrome, Playwright, and ffmpeg all off-machine, exactly like CI. Drive it through that skill and plug in kolu's parameters:

- **Serve** the PR's own commit on the box's loopback (`/do` has already pushed by the evidence step, so the branch flake-ref resolves; `--refresh` busts the flake cache):
  ```sh
  branch=$(git rev-parse --abbrev-ref HEAD)
  nix run --refresh "github:juspay/kolu?ref=$branch" -- --host 127.0.0.1 --port 7681
  ```
  Health is `http://127.0.0.1:7681/api/health`; the app is at `/`. The box has its own loopback, so plain `7681` is safe — no clash with the user's kolu. For a **"before"** shot, serve a second box from `github:juspay/kolu` (master).
- **Host & player:** upload to the `evidence-assets` release; HD clips use the shared player with `repo=juspay/kolu`.
- **Legibility:** maximize the terminal in the capture script with `page.click('[data-testid="maximize-toggle"]')`; pick a high-contrast theme (e.g. Melange Dark).

### Agent-state scenarios

When the change touches the Dock, terminal, or any UI surface that reflects agent activity, the capture has to show real states — a blank Dock proves nothing. Kolu's opencode integration is first-class: from inside `capture.mjs`, open a terminal and run opencode in it; the preexec hook surfaces state in the Dock within ~300ms (states: `thinking`, `tool_use`, `awaiting_user`, `waiting`; bucketed in the Dock as `working ▸`, `awaiting ⏵`, `idle ☾`).

```sh
# Inside a Kolu terminal on the box — no global install needed
nix run github:juspay/AI#opencode
```

Drive distinct states by prompt:

- **thinking / tool_use** (`working ▸`, pulsing border) — send a reasoning- or tool-heavy prompt (`explain the architecture of this repo`, `list every file in src/`); capture during the spinner.
- **awaiting_user** (`awaiting ⏵`, breathing border) — request an action that needs confirmation (e.g. an edit opencode wants to apply).
- **waiting / idle** (`idle ☾`) — let the reply finish; the row drops to the idle bucket.

For PRs whose changes affect one state, a single representative capture is fine; capture each when the change spans multiple. The default evidence for any Dock-touching change is **a screenshot of the Dock showing an agent state with a visible opencode reply** — that single frame proves the pipeline (terminal → provider → Dock) is alive end-to-end.
