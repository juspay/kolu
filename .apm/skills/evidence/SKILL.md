---
name: evidence
description: >-
  Capture production-like PR evidence (screenshots and video) on an ephemeral pu
  box by recording the project's own Cucumber + Playwright e2e harness — tag a
  scenario `@evidence`, run it with `KOLU_EVIDENCE=1`, and the harness records the
  clip while reusing every step definition. Entirely off the user's machine, the
  way CI runs e2e. Then transcode (ffmpeg), host on a GitHub release, and post a
  `## Evidence` comment. Use when a change has visible or behavioral impact worth
  proving. Triggers on "post evidence", "screenshot the change", "PR evidence",
  "record a video of this", "capture the UI".
---

# evidence — PR screenshots & video, recorded via the e2e harness on a pu box

Capture runs on an ephemeral `pu` box (see the **pu** skill), not locally — so evidence
reflects a clean, CI-like build of the PR's own commit and nothing touches the user's
machine. The box has its own loopback, so the harness binds plain ports there with zero
risk to anything the user is running.

**Capture is the project's existing Cucumber + Playwright e2e harness — you record a
tagged scenario, never a hand-rolled one-off script.** The harness already drives every
UI surface through a maintained step library, so the clip is produced by the same code CI
exercises, and there is no parallel capture script to keep in sync. (There is no
`capture.mjs` fallback — if a surface isn't reachable by an e2e scenario, write the
scenario.)

**Delegate to a subagent** (`Agent(subagent_type="general-purpose", model="sonnet")`) so
the main context stays clear of capture noise. Brief it with the box name, the branch, the
`@evidence` scenario (feature file + tag), a `<slug>`, and the PR number; have it return
only the markdown body it posted.

## How the harness records (wired in `packages/tests/support/hooks.ts`, gated on `KOLU_EVIDENCE`)

Off by default — normal runs pay nothing. With `KOLU_EVIDENCE=1` the e2e harness:

- sets Playwright `recordVideo` on the browser context (`size` = the evidence viewport, so
  the capture is 1:1 with no downscaling);
- records at a **denser 1280×720 viewport** (the normal 1920×1080 desktop floats the UI
  small in empty canvas — see Legibility);
- adds `slowMo` so the lead-up is watchable;
- **skips the animations-off init script** (motion is the point of a video);
- saves the page's `.webm` scenario-named to `packages/tests/reports/videos/` in the
  `After` hook (grabs `page.video()` before `context.close()`, `saveAs` after).

To capture a surface, tag the scenario that exercises it `@evidence` (or author a tiny one
reusing existing steps). One `@evidence` scenario per clip.

## 1. Provision & get the repo on the box

```sh
host="<descriptive-name>"                 # e.g. kolu-pr-<N>
branch="$(git rev-parse --abbrev-ref HEAD)"
pu create "$host"                          # see the pu skill (incl. egress check)
pu connect "$host" -- "git clone --depth 1 -b $branch https://github.com/juspay/kolu ~/kolu"
```

## 2. Capture — run the `@evidence` scenario (the harness records it)

Run it on the box exactly the way CI runs e2e (`ci::e2e`): inside the Nix dev shell, with
`KOLU_EVIDENCE=1`. `just test-quick` builds the client and spawns the server from source,
so there is no separate serve step.

```sh
pu connect "$host" -- 'cd ~/kolu && nix develop -c bash -lc \
  "KOLU_EVIDENCE=1 just test-quick features/<file>.feature --tags @evidence"'
# → ~/kolu/packages/tests/reports/videos/<scenario>.webm
```

For a **"before"** clip, run the same `@evidence` scenario on a second box cloned at the
base ref (e.g. `master`).

## 3. Legibility (the #1 quality issue)

- **Dense viewport.** The harness records at 1280×720, matched to `recordVideo.size`. The
  full 1920×1080 desktop leaves the terminal tile + side panel tiny in a sea of canvas — if
  a surface still reads small, tighten the viewport further (in `hooks.ts`'s
  `EVIDENCE_VIEWPORT`) or use a scenario step that maximizes the tile, rather than recording
  at full width.
- **Motion stays on** under `KOLU_EVIDENCE` (the determinism init script is skipped), so
  transitions actually show.
- **Brisk, then speed up** in transcode (`setpts=PTS/2`–`/3`) so agent-latency dead time
  doesn't drag; add an `@evidence`-gated dwell step at the payoff if a beat gets lost.

Transcode on the box with `nix shell nixpkgs#ffmpeg` (GIF for inline, MP4 for HD):

```sh
pu connect "$host" -- 'bash -lc "
  WEBM=\$(ls ~/kolu/packages/tests/reports/videos/*.webm | head -1)
  nix shell nixpkgs#ffmpeg -c ffmpeg -y -i \$WEBM \
    -vf \"setpts=PTS/2,fps=12,scale=1100:-1:flags=lanczos\" -loop 0 /tmp/cap/<slug>.gif
  nix shell nixpkgs#ffmpeg -c ffmpeg -y -i \$WEBM -filter:v setpts=PTS/2 -an /tmp/cap/<slug>.mp4
"'
```

## 4. Host & post

`gh pr comment` can't attach binaries, so copy artifacts back and upload to a long-lived
GitHub release:

```sh
scp -F ~/.pu-state/"$host"/ssh_config "$host":/tmp/cap/<slug>.gif /tmp/evidence-<slug>.gif
scp -F ~/.pu-state/"$host"/ssh_config "$host":/tmp/cap/<slug>.mp4 /tmp/evidence-<slug>.mp4
gh release view <RELEASE> >/dev/null 2>&1 || \
  gh release create <RELEASE> --prerelease --title "Evidence assets" --notes "Do not delete."
gh release upload <RELEASE> /tmp/evidence-<slug>.gif /tmp/evidence-<slug>.mp4 --clobber
```

Embed inline (GitHub renders PNG **and** animated GIF from any release URL):

```
![](https://github.com/<OWNER>/<REPO>/releases/download/<RELEASE>/<slug>.gif)
```

A `<video>` tag in a comment is stripped, and GitHub only mints an inline player for files
dragged into the web composer — so the GIF is the at-a-glance proof. For an HD clip, upload
the `.mp4` to the same release and link the shared player
[`juspay/video-evidence`](https://github.com/juspay/video-evidence) (org-allowlisted `repo`
param, reused across projects):

```
▶ HD: https://juspay.github.io/video-evidence/evidence.html?repo=<OWNER>/<REPO>&v=<slug>.mp4
```

Use a single-quoted heredoc (`<<'EOF'`) when posting so backticks and `$` survive. Keep the
GIF under GitHub's ~10 MB inline limit (the speed-up + palette pass usually do). **Tear the
box down** when finished: `pu destroy "$host"`.

## Terminal / TUI evidence (vhs)

For a **terminal app** (CLI / TUI) the e2e-harness path above doesn't apply — record the
terminal itself with [`vhs`](https://github.com/charmbracelet/vhs) (`nix run nixpkgs#vhs`;
bundles chromium on Linux). vhs runs a `.tape` script that types into a real pty and emits
**GIF + MP4** from one file (one `Output` line per format).

A `.tape` that recorded a TUI dashboard and drove its keys:

```
Output demo.gif
Output demo.mp4
Set Shell "bash"
Set FontSize 13
Set Width 1180
Set Height 480
Hide
Type "cd <project dir> && clear"
Enter
Sleep 800ms
Show
Type "<command, e.g. just run>"
Enter
Sleep 4s
Type "2"          # drive the TUI's keys (here: attach to node 2)
Sleep 3s
Type "q"
Sleep 1200ms
```

Run vhs **inside the project's nix devshell** so the shell it spawns inherits the toolchain
(`just`/`pnpm`/`tsx`/…):

```sh
pu connect "$host" -- 'cd ~/app && nix develop -c bash -lc "cd /tmp/cap && nix run nixpkgs#vhs -- demo.tape"'
```

Gotchas (learned capturing the mini-ci TUI):

- **`Output` paths must be relative.** vhs mis-lexes absolute paths (`Output /tmp/x.gif` → "Invalid command") — run vhs from the output dir and use bare filenames.
- **scp the `.tape`** to the box rather than heredoc it through nested ssh quoting.
- **No reliable `Screenshot`** command (vhs 0.10) — pull a still with `ffmpeg -ss N -i demo.mp4 -vframes 1 still.png`.
- **Crop dead space / trim the wait** with ffmpeg before the GIF: `-vf crop=W:H:0:0` drops empty rows, `-ss <start>` trims pre-dashboard setup; regenerate the GIF from the cropped MP4 with a `palettegen`/`paletteuse` pass for a tight, legible loop.
- **Remote / ssh captures run from a host that can reach the target.** Ephemeral pu boxes can't ssh each other, so a capture that itself ssh's somewhere (the app's own remote mode) runs from your machine, not a second box.
- **macOS:** vhs needs chromium (Linux-only in nixpkgs), so you can't record *on* a Mac. Capture darwin behaviour by driving it from a Linux box over the app's remote/ssh mode (runner executes on the Mac, TUI renders on Linux), or use `asciinema` + `agg` (no browser) for a native-darwin recording.

Host + embed exactly as §4 (GIF inline, MP4 via the player).
