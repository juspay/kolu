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

**Ephemeral linux build host per run.** Static darwin (`sincereintent`) lives in `~/.config/ci/hosts.json`; the linux lane uses a throwaway Incus container per CI invocation so prior runs' nix-store cruft can't poison the verdict.

```sh
pr=$(gh pr view --json number --jq .number)
host="kolu-pr-$pr"
pu create "$host"                                                       # name is positional; writes ~/.pu-state/$host/ssh_config (included by ~/.ssh/config)
CI=true nix run github:juspay/ci -- run --host x86_64-linux="$host"     # --host wins over hosts.json on collision; darwin keeps using sincereintent
pu destroy "$host"
```

**Flake → comment on [#320](https://github.com/juspay/kolu/issues/320)** with scenario/platform/error excerpt/PR.

**Evidence required → all GitHub status checks green per `justci protect`.** `/do` is done only when every required status check is green on the PR's current `HEAD`. Source the required list from `justci protect --dry-run` — it prints the `<recipe>@<platform>` contexts the canonical DAG produces, which are exactly the contexts branch protection gates on. Verify with `gh pr checks`; a green from a positional retry counts (final state matters).

## Documentation

Keep these docs in sync:

- **`README.md`** (top-level) — user-facing changes, architecture prose, transport-resilience description.
- **`packages/surface/README.md`** — the `@kolu/surface` framework reference. The "How Kolu uses this framework" section is a concrete inventory of every cell, collection, and stream descriptor plus the raw-oRPC procedures that stay outside the framework. Update it whenever a new descriptor lands or whenever a contract entry's classification changes (added mutation, retired stream, …).
- **`website/src/pages/index.astro`** — the kolu.dev marketing page. Its hero terminal + canvas-strip mockups (dock cards, split tile with `claude` + `just test`, codex apply_patch tile, opencode planning tile, Code-tab tree + preview) approximate the running Kolu app. When a user-facing surface changes shape — a new dock-row affordance, a renamed agent integration, a different split layout, a new chip state, a new Code-tab tab, a new theme name worth name-dropping — refresh the mockup so the marketing visual doesn't drift from the product. Drive the running app via `chrome-devtools` MCP if you want a reference screenshot to model from (`just dev-auto` boots Kolu on two free ports with HMR and prints the client URL).

## PR evidence

When the change has visible UI impact, post a `## Evidence` PR comment with screenshots — or **video** when the change is about motion (an animation, a transition, a multi-step interaction a still can't convey; see _Video evidence_ below). Use judgment — server-only diffs sometimes ripple into rendering.

**Delegate to a subagent** (`Agent(subagent_type="general-purpose", model="sonnet")`) so the main context stays clear of MCP and screenshot noise. Brief it with: the dev-server URL, what scenarios to capture, a `/tmp/kolu-evidence-<slug>.png` filename, and the PR number. Have it return only the markdown body it posted.

### Dev server

Spawn a dedicated dev server on **two random, unique free ports** — one for the server, one for the client. **Never** reuse the defaults `7681`/`5173`: the user is very likely running their own (production) kolu there, and a port clash or a careless cleanup will take it down. Run `just dev` with both ports explicit (or `just dev-auto`, which picks two free ports for you — it sources `python3` from nix, so it works outside the devshell):

```sh
# Two free, unique ports (python3 via nix — no global install needed).
read -r SP CP < <(nix shell nixpkgs#python3 --command python3 -c 'import socket; a=socket.socket(); a.bind(("",0)); b=socket.socket(); b.bind(("",0)); print(a.getsockname()[1], b.getsockname()[1]); a.close(); b.close()')
just dev SERVER_PORT="$SP" CLIENT_PORT="$CP" &   # prints "→ client http://localhost:<port>"; pass that URL to the subagent
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null' EXIT
```

**Kill only the PID you spawned.** At the end, `kill "$DEV_PID"` and nothing else. **Never** `pkill -f vite`, `pkill -f src/index.ts`, or any pattern match — those also match the user's production kolu and will kill it.

For bug fixes that need a "before" shot, run a second instance on its own two ports from a `git worktree` on `master` (no collision with the PR-branch instance). Never stash the PR branch.

### Capture, host, post

The subagent drives `chrome-devtools` MCP — `new_page` at `http://localhost:$PORT/`, reproduces the relevant state, `take_screenshot` to `/tmp/kolu-evidence-<slug>.png`.

`gh pr comment` can't attach binaries, so upload to a long-lived `evidence-assets` GitHub release and embed the download URL inline:

```sh
gh release view evidence-assets >/dev/null 2>&1 || \
  gh release create evidence-assets --prerelease \
    --title "Evidence assets (auto-uploaded by /do)" --notes "Do not delete."
gh release upload evidence-assets /tmp/kolu-evidence-<slug>.png --clobber
```

URL pattern: `https://github.com/juspay/kolu/releases/download/evidence-assets/<filename>`. Use the single-quoted heredoc pattern (`<<'EOF'`) when posting so backticks and `$` survive unescaped.

### Video evidence

For motion the subagent records the page instead of (or alongside) a still. The `chrome-devtools` MCP exposes `screencast_start` / `screencast_stop` — `screencast_start` with `filePath: /tmp/kolu-evidence-<slug>.mp4`, drive the interaction, then `screencast_stop`. (Capability ships in the [`nix-chrome-devtools-mcp`](https://github.com/juspay/nix-chrome-devtools-mcp) launcher, which runs the server with `--experimentalScreencast` and ffmpeg on PATH.)

Two reasons not to just attach the `.mp4`: GitHub renders an inline video *player* only for files dragged into the web composer (a `user-attachments` URL `gh` can't mint), and a `<video>` tag in a comment is stripped. So:

- **Inline (the at-a-glance proof):** transcode to an animated GIF — GitHub renders a GIF inline from any release URL, exactly like the PNG flow above.

  ```sh
  nix shell nixpkgs#ffmpeg --command ffmpeg -i /tmp/kolu-evidence-<slug>.mp4 \
    -vf "fps=12,scale=900:-1:flags=lanczos" -loop 0 /tmp/kolu-evidence-<slug>.gif
  gh release upload evidence-assets /tmp/kolu-evidence-<slug>.gif --clobber
  ```

  Embed with `![](https://github.com/juspay/kolu/releases/download/evidence-assets/<slug>.gif)`.

- **HD + audio (optional):** upload the `.mp4` to the same release and link to the shared player — [`juspay/video-evidence`](https://github.com/juspay/video-evidence) hosts a GitHub Pages `<video>` page that streams the clip from kolu's own release:

  ```
  ▶ HD: https://juspay.github.io/video-evidence/evidence.html?repo=juspay/kolu&v=<slug>.mp4
  ```

  Clips stay on kolu's `evidence-assets` release; the player is project-agnostic (the `repo` param is org-allowlisted), so it is reused across juspay projects with no per-project hosting.

### Agent-state scenarios

When the change touches the Dock, terminal, or any UI surface that reflects agent activity, the capture has to show real states — a blank Dock proves nothing. Kolu's opencode integration is first-class: run opencode inside a Kolu terminal and the preexec hook surfaces state in the Dock within ~300ms (states: `thinking`, `tool_use`, `awaiting_user`, `waiting`; bucketed in the Dock as `working ▸`, `awaiting ⏵`, `idle ☾`).

```sh
# Inside a Kolu terminal — no global install needed
nix run github:juspay/AI#opencode
```

Drive distinct states by prompt:

- **thinking / tool_use** (`working ▸`, pulsing border) — send a reasoning- or tool-heavy prompt (`explain the architecture of this repo`, `list every file in src/`); capture during the spinner.
- **awaiting_user** (`awaiting ⏵`, breathing border) — request an action that needs confirmation (e.g. an edit opencode wants to apply).
- **waiting / idle** (`idle ☾`) — let the reply finish; the row drops to the idle bucket.

For PRs whose changes affect one state, a single representative capture is fine; capture each when the change spans multiple. The default evidence for any Dock-touching change is **a screenshot of the Dock showing an agent state with a visible opencode reply** — that single frame proves the pipeline (terminal → provider → Dock) is alive end-to-end.
