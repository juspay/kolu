# /do config

`/do` reads this file at the steps that need a project-defined command (check, fmt, test, ci, docs) and at the evidence step.

## Check command

`just check` — fast static-correctness gate. Runs `pnpm typecheck` plus `biome lint` across the workspace. CI's `ci::typecheck` runs the typecheck half and `ci::biome` runs the lint half. `just lint` is a standalone recipe that mirrors `ci::biome`.

## Format command

`just fmt` — runs `biome format --write` over the workspace plus `nixpkgs-fmt` over `.nix` files. Biome v2 is now the sole JS/TS/JSON/CSS formatter (Prettier was retired in [#710](https://github.com/juspay/kolu/issues/710)). Config lives in `biome.jsonc` at the repo root.

## Test command

Invoke the `/test` skill. It selects relevant `.feature` files from the git diff and runs `just test-quick`.

## CI command

Invoke the `/ci` skill. It runs `just ci` via the Monitor tool and cross-checks posted GitHub commit statuses against `just ci::_contexts` so missing steps can't silently pass.

## Documentation

Keep these docs in sync:

- **`README.md`** (top-level) — user-facing changes, architecture prose, transport-resilience description.
- **`packages/surface/README.md`** — the `@kolu/surface` framework reference. The "How Kolu uses this framework" section is a concrete inventory of every cell, collection, and stream descriptor plus the raw-oRPC procedures that stay outside the framework. Update it whenever a new descriptor lands or whenever a contract entry's classification changes (added mutation, retired stream, …).

## PR evidence

When the change has visible UI impact, post a `## Evidence` PR comment with screenshots. Use judgment — server-only diffs sometimes ripple into rendering.

**Delegate to a subagent** (`Agent(subagent_type="general-purpose", model="sonnet")`) so the main context stays clear of MCP and screenshot noise. Brief it with: the dev-server URL, what scenarios to capture, a `/tmp/kolu-evidence-<slug>.png` filename, and the PR number. Have it return only the markdown body it posted.

### Dev server

Spawn a dedicated dev server on a **free random port** (the user may have one on 5173 already). Hold the port number in a shell variable for the subagent and kill the process at the end:

```sh
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); p=s.getsockname()[1]; s.close(); print(p)')
# Override the client port — read packages/client/vite.config.ts and the
# `client`/`dev` recipes to find the right flag/env (e.g. `pnpm dev -- --port $PORT`).
just dev &  # adjusted for the port override
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null' EXIT
```

For bug fixes that need a "before" shot, run a second server from a `git worktree` on `master` (different free port). Never stash the PR branch.

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
