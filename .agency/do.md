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

**Capture runs on a `pu` box, not locally — exactly like CI.** `nix run`, Chrome, and Playwright all execute on an ephemeral Incus container; nothing touches the user's machine. This kills the whole class of local footguns: the box has its own loopback, so kolu binds the default `7681` there with **zero** risk to the user's production kolu — no random-port dance, no `pkill` that might match the user's process, no `git worktree` juggling for "before" shots. Reuse the same provisioning the CI step already documents (`pu create`).

**Delegate to a subagent** (`Agent(subagent_type="general-purpose", model="sonnet")`) so the main context stays clear of capture noise. Brief it with: the box name, what scenarios to capture, a `<slug>`, and the PR number. Have it return only the markdown body it posted.

### Provision the box & serve kolu

Build and serve the **PR's own commit** from the pushed branch, on the box's loopback. (By the evidence step `/do` has already pushed, so the branch flake-ref resolves; `--refresh` busts the flake cache so the box pulls the latest commit.)

```sh
pr=$(gh pr view --json number --jq .number)
branch=$(git rev-parse --abbrev-ref HEAD)
host="kolu-pr-$pr-evidence"
pu create "$host"                                                      # writes ~/.pu-state/$host/ssh_config

# Serve the PR build on the box's own 7681 (the box has no other kolu — 7681 is safe here).
pu connect "$host" -- "nohup nix run --refresh 'github:juspay/kolu?ref=$branch' \
  -- --host 127.0.0.1 --port 7681 >/tmp/kolu.log 2>&1 &"
pu connect "$host" -- 'until curl -sf http://127.0.0.1:7681/api/health; do sleep 2; done'
```

For a **"before"** shot, point a second box at `github:juspay/kolu` (master) — no flake ref, no worktree, no stash.

### Capture (Playwright on the box)

Chrome and Playwright run on the box too. A self-contained `capture.mjs` drives headless Chromium with the **version-matched** pair Nix already provides — `nixpkgs#playwright-driver` (the `playwright-core` lib) + `nixpkgs#playwright-driver.browsers` (the Chrome-for-Testing build the launcher resolves). One run yields a PNG **and** a `.webm`; no MCP server, no npm install.

```sh
# Write the capture script onto the box.
pu connect "$host" -- "cat > /tmp/cap/capture.mjs" <<'MJS'
// argv: <url> <pngPath> [webmDir] [recordMs]   — runs entirely on the box.
import { chromium } from 'playwright-core';
const [url, pngPath, webmDir, recordMsArg] = process.argv.slice(2);
const recordMs = Number(recordMsArg ?? 0);
const viewport = { width: 1366, height: 768 };               // landscape, DPR 1
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport, deviceScaleFactor: 1,
  ...(webmDir ? { recordVideo: { dir: webmDir, size: viewport } } : {}),
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
// …reproduce the relevant state here: page.click(), page.keyboard.type(), etc.
await page.waitForTimeout(2500);                              // let the canvas settle
await page.screenshot({ path: pngPath });
if (recordMs > 0) await page.waitForTimeout(recordMs);
await context.close();                                        // flushes the .webm
await browser.close();
MJS

# Resolve the Nix pair and run it (browsers via PLAYWRIGHT_BROWSERS_PATH, lib via NODE_PATH).
pu connect "$host" -- 'bash -lc "
  mkdir -p /tmp/cap/node_modules /tmp/cap/vid
  DRV=\$(nix build --no-link --print-out-paths nixpkgs#playwright-driver)
  BR=\$(nix build --no-link --print-out-paths nixpkgs#playwright-driver.browsers)
  ln -sfn \$DRV /tmp/cap/node_modules/playwright-core
  PLAYWRIGHT_BROWSERS_PATH=\$BR NODE_PATH=/tmp/cap/node_modules \
    nix shell nixpkgs#nodejs -c node /tmp/cap/capture.mjs \
      http://127.0.0.1:7681/ /tmp/cap/<slug>.png /tmp/cap/vid 6000
"'
```

### Host & post

Copy artifacts back over the box's `ssh_config`, then upload to a long-lived `evidence-assets` GitHub release (`gh pr comment` can't attach binaries):

```sh
scp -F ~/.pu-state/"$host"/ssh_config "$host":/tmp/cap/<slug>.png /tmp/kolu-evidence-<slug>.png

gh release view evidence-assets >/dev/null 2>&1 || \
  gh release create evidence-assets --prerelease \
    --title "Evidence assets (auto-uploaded by /do)" --notes "Do not delete."
gh release upload evidence-assets /tmp/kolu-evidence-<slug>.png --clobber
```

URL pattern: `https://github.com/juspay/kolu/releases/download/evidence-assets/<filename>`. Use the single-quoted heredoc pattern (`<<'EOF'`) when posting so backticks and `$` survive unescaped. **Tear the box down** when finished: `pu destroy "$host"`.

### Video evidence

For motion, pass a `webmDir` + `recordMs` to `capture.mjs` above — Playwright's `recordVideo` writes a `.webm` on the box. Transcode and copy back with `nix shell nixpkgs#ffmpeg` **on the box**:

**Make the recording legible — this is the #1 quality issue:**

- **Landscape viewport.** The script sets `1366×768` at DPR 1. The default headless window can be portrait and 2×-DPI, which leaves the content tiny in a tall, mostly-empty frame.
- **Maximize the terminal.** Click the chrome-bar **Maximize terminal** in the script (`page.click(...)`, canvas → maximized) so the terminal fills the frame. Recording *canvas* mode captures a small tile floating in empty space — the most common "why am I squinting" mistake.
- **High-contrast theme** (e.g. Melange Dark) so the text reads.
- **Move briskly, then speed up.** Do setup (create terminal, maximize, open the Code panel) *before* the recorded stretch so only the meaningful steps land in the clip; then speed the output up (`setpts=PTS/2`–`/3`) so agent-latency dead time doesn't make it drag.

Two reasons not to just attach the `.mp4`: GitHub renders an inline video *player* only for files dragged into the web composer (a `user-attachments` URL `gh` can't mint), and a `<video>` tag in a comment is stripped. So:

- **Inline (the at-a-glance proof):** transcode to an animated GIF — GitHub renders a GIF inline from any release URL, exactly like the PNG flow above.

  ```sh
  pu connect "$host" -- 'bash -lc "
    WEBM=\$(ls /tmp/cap/vid/*.webm | head -1)
    nix shell nixpkgs#ffmpeg -c ffmpeg -y -i \$WEBM \
      -vf \"setpts=PTS/2,fps=12,scale=1100:-1:flags=lanczos\" -loop 0 /tmp/cap/<slug>.gif
    nix shell nixpkgs#ffmpeg -c ffmpeg -y -i \$WEBM -filter:v setpts=PTS/2 -an /tmp/cap/<slug>.mp4
  "'
  scp -F ~/.pu-state/"$host"/ssh_config "$host":/tmp/cap/<slug>.gif /tmp/kolu-evidence-<slug>.gif
  gh release upload evidence-assets /tmp/kolu-evidence-<slug>.gif --clobber
  ```

  Keep it under GitHub's ~10 MB inline limit (the `setpts` speed-up + a palette pass usually land a minute-long capture well under that). Embed with `![](https://github.com/juspay/kolu/releases/download/evidence-assets/<slug>.gif)`.

- **HD (optional):** copy the sped-up `.mp4` back too, upload it to the same release, and link to the shared player — [`juspay/video-evidence`](https://github.com/juspay/video-evidence) hosts a GitHub Pages `<video>` page that streams the clip from kolu's own release:

  ```
  ▶ HD: https://juspay.github.io/video-evidence/evidence.html?repo=juspay/kolu&v=<slug>.mp4
  ```

  Clips stay on kolu's `evidence-assets` release; the player is project-agnostic (the `repo` param is org-allowlisted), so it is reused across juspay projects with no per-project hosting.

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
