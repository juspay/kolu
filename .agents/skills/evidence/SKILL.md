---
name: evidence
description: Capture production-like PR evidence (screenshots and video) by running the app on an ephemeral pu box and driving headless Chrome with Playwright — entirely off the user's machine, the way CI builds. Use when a change has visible UI impact and you want to post a `## Evidence` PR comment. Project-agnostic: it parameterizes on a `nix run`-style serve command, so it reuses across any project whose app boots that way. Covers the self-contained Playwright capture, video recording, ffmpeg transcode, GitHub-release hosting, and posting. Triggers on "post evidence", "screenshot the change", "PR evidence", "record a video of this", "capture the UI".
---

# evidence — PR screenshots & video, captured on a pu box

Capture runs on an ephemeral `pu` box (see the **pu** skill), not locally. `nix run`,
Chrome, Playwright, and ffmpeg all execute on the box — so evidence reflects a clean,
CI-like build of the PR's own commit and nothing touches the user's machine. The box
has its own loopback, so the app binds a plain port there with zero risk to anything
the user is running; no random-port dance, no `pkill`, no worktree juggling.

**Delegate to a subagent** (`Agent(subagent_type="general-purpose", model="sonnet")`)
so the main context stays clear of capture noise. Brief it with the box name, the
serve command, what to capture, a `<slug>`, and the PR number; have it return only the
markdown body it posted.

## Inputs the calling project supplies

- **Serve command** — a `nix run`-style line that boots the app on the box's loopback
  (e.g. `nix run --refresh 'github:owner/app?ref=$branch' -- --host 127.0.0.1 --port 7681`).
- **Health URL** and **app URL** (e.g. `http://127.0.0.1:7681/health`, `…/`).
- **Release name** for hosting binaries (e.g. `evidence-assets`).
- Any **app-specific scenario** steps (selectors to click, states to reproduce).

## 1. Provision & serve

```sh
host="<descriptive-name>"
pu create "$host"                                       # see the pu skill (incl. egress check)
pu connect "$host" -- "nohup <SERVE COMMAND> >/tmp/app.log 2>&1 &"
pu connect "$host" -- 'until curl -sf <HEALTH URL>; do sleep 2; done'
```

For a **"before"** shot, serve a second box from the base ref (e.g. `master`) — no
worktree, no stash.

## 2. Capture (Playwright on the box)

A self-contained `capture.mjs` drives headless Chromium with the **version-matched**
pair Nix provides — `nixpkgs#playwright-driver` (the `playwright-core` lib) +
`nixpkgs#playwright-driver.browsers` (Chrome-for-Testing). No MCP server, no npm
install. One run yields a PNG **and**, if you pass a video dir, a `.webm`.

```sh
pu connect "$host" -- "cat > /tmp/cap/capture.mjs" <<'MJS'
// argv: <url> <pngPath> [webmDir]   — runs entirely on the box.
import { chromium } from 'playwright-core';
const [url, pngPath, webmDir] = process.argv.slice(2);
const viewport = { width: 1366, height: 768 };               // landscape, DPR 1
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport, deviceScaleFactor: 1,
  ...(webmDir ? { recordVideo: { dir: webmDir, size: viewport } } : {}),
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

// === reproduce the relevant state here ===
// e.g. page.keyboard.press('Control+Enter'), page.click(sel), page.keyboard.type(cmd)
await page.waitForTimeout(2500);                             // let it settle

await page.screenshot({ path: pngPath });
await context.close();                                       // flushes the .webm
await browser.close();
MJS

pu connect "$host" -- 'bash -lc "
  mkdir -p /tmp/cap/node_modules /tmp/cap/vid
  DRV=\$(nix build --no-link --print-out-paths nixpkgs#playwright-driver)
  BR=\$(nix build --no-link --print-out-paths nixpkgs#playwright-driver.browsers)
  ln -sfn \$DRV /tmp/cap/node_modules/playwright-core
  PLAYWRIGHT_BROWSERS_PATH=\$BR NODE_PATH=/tmp/cap/node_modules \
    nix shell nixpkgs#nodejs -c node /tmp/cap/capture.mjs \
      <APP URL> /tmp/cap/<slug>.png /tmp/cap/vid
"'
```

## 3. Video (only when the change is about motion)

Pass a `webmDir` and **script real interaction** — a video that just sits still proves
nothing. Open the relevant surface, drive the steps back-to-back, let output stream.
Make it legible (the #1 quality issue):

- **Landscape viewport** — the script sets `1366×768` at DPR 1. The default headless
  window can be portrait and 2×-DPI, leaving content tiny in a tall empty frame.
- **Fill the frame** — maximize/expand the surface under test so it isn't a small tile
  floating in empty space.
- **High-contrast theme** so text reads.
- **Move briskly, then speed up** in transcode (`setpts=PTS/2`–`/3`) so agent-latency
  dead time doesn't make the clip drag.

Transcode on the box with `nix shell nixpkgs#ffmpeg`:

```sh
pu connect "$host" -- 'bash -lc "
  WEBM=\$(ls /tmp/cap/vid/*.webm | head -1)
  nix shell nixpkgs#ffmpeg -c ffmpeg -y -i \$WEBM \
    -vf \"setpts=PTS/2,fps=12,scale=1100:-1:flags=lanczos\" -loop 0 /tmp/cap/<slug>.gif
  nix shell nixpkgs#ffmpeg -c ffmpeg -y -i \$WEBM -filter:v setpts=PTS/2 -an /tmp/cap/<slug>.mp4
"'
```

## 4. Host & post

`gh pr comment` can't attach binaries, so copy artifacts back and upload to a
long-lived GitHub release:

```sh
scp -F ~/.pu-state/"$host"/ssh_config "$host":/tmp/cap/<slug>.png /tmp/kolu-evidence-<slug>.png
gh release view <RELEASE> >/dev/null 2>&1 || \
  gh release create <RELEASE> --prerelease --title "Evidence assets" --notes "Do not delete."
gh release upload <RELEASE> /tmp/kolu-evidence-<slug>.png --clobber
```

Embed inline (GitHub renders PNG **and** animated GIF from any release URL):

```
![](https://github.com/<OWNER>/<REPO>/releases/download/<RELEASE>/<slug>.png)
![](https://github.com/<OWNER>/<REPO>/releases/download/<RELEASE>/<slug>.gif)
```

A `<video>` tag in a comment is stripped, and GitHub only mints an inline player for
files dragged into the web composer — so the GIF is the at-a-glance proof. For an HD
clip, upload the `.mp4` to the same release and link the shared player
[`juspay/video-evidence`](https://github.com/juspay/video-evidence) (org-allowlisted
`repo` param, reused across projects):

```
▶ HD: https://juspay.github.io/video-evidence/evidence.html?repo=<OWNER>/<REPO>&v=<slug>.mp4
```

Use a single-quoted heredoc (`<<'EOF'`) when posting so backticks and `$` survive.
Keep the GIF under GitHub's ~10 MB inline limit (the speed-up + palette pass usually
do). **Tear the box down** when finished: `pu destroy "$host"`.
