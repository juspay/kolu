---
name: evidence
description: >-
  Produce visual PR evidence — a screenshot or a video — whenever a change has
  on-screen impact. If exercising the change would make the screen look different
  (a rendered view, an error/empty/loading/blocked state, a panel, layout, an icon,
  motion, a live update) a visual artifact is MANDATORY, not optional. A change can
  be backend by cause and visible by effect: tests are never a substitute for a
  visual artifact when there is on-screen impact. Capture rides the project's own
  Cucumber + Playwright e2e harness on an ephemeral pu box (video of a flow, or a
  still pulled from the clip), or drives a live kolu with the chrome-devtools MCP
  for a state no scenario reaches. Then transcode (ffmpeg), host on a GitHub
  release, and post a `## Evidence` comment. Triggers on "post evidence",
  "screenshot the change", "PR evidence", "record a video of this", "capture the
  UI", "show it working", "prove it", or finishing any change whose effect is
  visible on screen.
---

# evidence — PR screenshots & video, recorded via the e2e harness on a pu box

## 0. The forcing function — run this gate FIRST, before any mechanics

Visual evidence is **mandatory** whenever a change has on-screen impact. Do not skip to the
machinery below until you have answered the gate.

**The gate (one behavioral question, no architecture judgment):**

> If someone exercised what this change affects, would the screen look DIFFERENT — before vs.
> after? A rendered view, an error / empty / loading / blocked state, a panel, layout, an icon,
> motion, or a live update?

```
                  ┌─────────────────────────────────────────────┐
                  │  Would the screen look DIFFERENT, before     │
                  │  vs. after, if someone exercised this?       │
                  └───────────────┬─────────────────────────────┘
                          NO ──────┤────── YES
                                   │
            ┌──────────────────────┘
            │                                         │
   State it, then skip:                     A visual artifact is MANDATORY.
   one line in the PR —                     Now: static or motion?
   "No visual impact:               ┌───────────────┴────────────────┐
    <why>." Silent skip          STATIC                            MOTION
   is NOT allowed.          end-state · single moment ·       transition · multi-step flow ·
                            before↔after comparison ·         live update · latency-to-payoff ·
                            blocked/error/empty state          animation · drag/resize
                                   │                                 │
                              SCREENSHOT (§A)                    VIDEO (§B)
```

- **YES → a visual artifact is mandatory.** Not "worth proving", not optional. Pick image or
  video by the rule below and produce it.
- **NO → state it, then skip.** A genuine no-visual change (pure internal refactor, build / CI /
  tooling, protocol-only change with no rendered surface) is the *only* legitimate skip — and even
  then you must write one explicit line in the PR: `No visual impact: <why>.` Skipping silently is
  not allowed. **Do not over-trigger:** a true no-visual change must stay skippable with that one
  line — the gate asks whether the *screen* differs, not whether any byte changed. If exercising
  the change leaves the screen identical, skip it with the one line; don't manufacture a tenuous
  pixel.

### Escape hatches that are NOT valid — these are closed

A real run skipped the artifact with each of these. None of them holds. (The run fixed a backend
path guard that followed symlinks, then posted the unit-test suite as the `## Evidence` comment.
The user rejected it: "unit tests prove the logic, but you want to SEE it in the actual Code
browser.")

- **"It's a backend change / there's no UI surface."** A change can be *backend by cause and
  visible by effect.* The symlink path guard is pure backend logic — yet when the fixed guard
  rejects a symlinked file the Code tab shows an **error / blocked state** instead of file
  contents. That on-screen difference is exactly what the gate asks about. Trace the effect to the
  screen, not the cause to a layer.
- **"No existing scenario exercises it."** That decides *how* you capture (drive it live — §A2's
  chrome-devtools path), never *whether* you capture. Absence of a scenario is not a skip.
- **"The test suite / the unit tests are the honest proof."** Tests prove the logic; they are
  **never** a substitute for a visual artifact when there is on-screen impact. They may *accompany*
  the artifact, never replace it. The user wants to **SEE** it in the actual app.
- **"I rebuilt the artifact from the code's own output / a formatter / a mock — close enough."** A
  *synthesized* artifact — formatter output pasted as if it were a recording, a hand-assembled table,
  a screenshot of mocked data, a clip of a stub — is a **fabrication**: the gate defeated while
  pretending to pass it, not evidence. The artifact must come from **really executing the change**
  end-to-end against real data, and before you post it you must **read the real output and confirm
  the feature actually works** — running it for real is also the cheapest place to catch "it doesn't
  work," because a fabricated artifact looks correct by construction and hides the very bug evidence
  exists to expose. A real run did exactly this: it posted *formatter output* as the `## Evidence`
  for a CLI `status` command **without ever invoking the binary**; when the user ran it the table
  was empty (a real resolution-race bug the fake artifact had concealed) — "It doesn't work LOL."
  Author's own verdict afterward: *"it was formatter output, not a real recording. That was wrong of
  me."* For a CLI/TUI this means an actual `vhs`/`asciinema` capture of the **real binary** against
  live data (see the vhs section), never a reconstruction of what its output *would* look like.

### Image vs. video — the decision rule

- **SCREENSHOT (image)** — a static end-state, a single moment, or a before↔after comparison: a
  rendered view, an error / empty / loading / blocked state, a panel that now appears, a layout or
  icon change. One frame tells the whole story. **When there's no motion, a screenshot is enough.**
- **VIDEO** — motion is the point: a transition, a multi-step flow, a live update, latency-to-
  payoff, an animation, a drag/resize. You need to *watch it happen.*

> **A value-over-time display is MOTION, never a single moment.** If the element's *job* is to
> change on its own — a running timer, "Running for" / relative-time / "last seen" string,
> countdown, live counter, progress that advances, a tick at some cadence — classify it VIDEO and
> *watch it tick*. A still of `Running for 0s` is structurally blind to the actual defect: a frozen
> clock and a live one are pixel-identical in one frame, so a screenshot can never prove the tick
> fires at the cadence the displayed precision implies (seconds shown ⇒ must update every second).
> Classify by what the element *does over time*, not by what the panel looks like at one instant.

Image and video are **co-equal first-class outputs.** A screenshot is a complete deliverable, not a
runner-up to video. (A before↔after of a *static* change is two stills; only reach for two clips
when the difference is itself motion — e.g. an animation-timing change.)

---

Capture runs on an ephemeral `pu` box (see the **pu** skill), not locally — so evidence
reflects a clean, CI-like build of the PR's own commit and nothing touches the user's
machine. The box has its own loopback, so the harness binds plain ports there with zero
risk to anything the user is running.

**Prefer the project's existing Cucumber + Playwright e2e harness — record an existing scenario by
name.** It drives every UI surface through a maintained step library, so the clip is produced by the
same code CI exercises and the `.feature` files stay pristine. That's why it's the default.

But **the artifact is what matters — never skip for lack of a canned path.** When the harness can't
reach the state (and no scenario is worth authoring from existing steps), be inventive: drive a live
kolu with the chrome-devtools MCP (§A2), pull a still from a recorded clip (§A1), use `vhs` for a
TUI, or hand-roll a one-off driver as a last resort. Be inventive when the harness genuinely doesn't
fit — not as a shortcut past a quick scenario that would do.

> **What "prefer the harness" does and doesn't mean.** The one thing worth avoiding is a *parallel
> video-capture harness* that duplicates the step library and drifts from CI — so for **video of a
> flow**, reuse the maintained steps (author a quick scenario rather than scripting a flow from
> scratch). Everything else is fair game: a **screenshot of a static state**, the ordinary setup a
> screenshot needs (starting the server, staging an on-disk precondition such as planting a symlink),
> pulling a still from a recorded clip, or driving a state live with the chrome-devtools MCP to
> `take_screenshot`. None of these are off-limits.

**Delegate to a subagent** (`Agent(subagent_type="general-purpose", model="sonnet")`) so
the main context stays clear of capture noise. Brief it with the box name, the branch, whether the
deliverable is an image or a video, the scenario to record (feature file + exact scenario name) or
the live state to drive, a `<slug>`, and the PR number; have it return only the markdown body it
posted.

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

The same hooks file already has a `page.screenshot()` mechanism (currently wired to on-failure
capture) — and every recorded run also leaves a frame-accurate `.webm` you can pull a still from.
So both the image path (§A) and the video path (§B) ride this one gated harness.

To capture a flow, pick the scenario that exercises it (or author a tiny one reusing existing
steps) and select it by name. One scenario per clip.

## 1. Provision & get the repo on the box

```sh
host="<descriptive-name>"                 # e.g. kolu-pr-<N>
branch="$(git rev-parse --abbrev-ref HEAD)"
pu create "$host"                          # see the pu skill (incl. egress check)
pu connect "$host" -- "git clone --depth 1 -b $branch https://github.com/juspay/kolu ~/kolu"
```

## A. Screenshot (image) path — for a static end-state

A screenshot is mandatory when the gate says YES and the change is static (an error / blocked /
empty state, a rendered view, a panel, a layout or icon change). "No scenario exists" is **not** an
exit — use whichever path fits:

**A1 — Pull a still from a recorded clip.** Best when a scenario already drives the browser *through*
the state you want to show — even mid-flow, and even an existing passing scenario you didn't write
(you do **not** have to author a scenario for this). Run it under `KOLU_EVIDENCE=1` exactly as in §B
(every passing run leaves a `.webm`), then extract the frame at the payoff moment with ffmpeg (the
same still trick the vhs/TUI section uses):

```sh
pu connect "$host" -- 'bash -lc "
  WEBM=\$(ls ~/kolu/packages/tests/reports/videos/*.webm | head -1)
  nix shell nixpkgs#ffmpeg -c ffmpeg -y -ss 3 -i \$WEBM -vframes 1 /tmp/cap/<slug>.png
"'   # -ss <seconds> = the moment the state is on screen; bump until the frame is right
```

**A2 — Drive the state live, then screenshot it.** For a state **no scenario reaches** (e.g. a guard
rejecting a symlinked file so the Code tab shows a blocked/error state, or a fresh empty-state on a
surface no `.feature` touches), drive a running kolu directly with the **chrome-devtools MCP** (the
`nix-chrome-devtools-mcp` skill is installed):

1. **Serve kolu from source on the box** the same way §B does — `nix develop -c just test-quick`
   builds the client and spawns the server, and leaves it serving; note the URL/port it prints
   (default `http://localhost:<port>`). Reach it from the MCP browser over the box's ssh tunnel
   (`pu connect` forwards a port), or run the MCP browser on the box.
2. **Stage the on-disk precondition the state needs** with a plain shell command on the box —
   ordinary setup, not a parallel capture harness (see the note above). For the symlink case:
   `pu connect "$host" -- 'ln -s /etc/passwd ~/kolu/<workspace>/leak'`. For an empty-state, seed or
   clear the relevant data the same way (e.g. open a fresh empty project / clear sessions).
3. **Reach the state and grab it:** `navigate_page` to the kolu URL, `click` / `fill` / `wait_for`
   to open the surface (e.g. open `leak` in the Code tab so the blocked/error state renders), then
   `take_screenshot`. Pull the PNG back and post it exactly as §4.

For a **before↔after** via this live path, run steps 1–3 twice — once on a box cloned at the base
ref (`master`), once on the PR box — and place the two PNGs side by side (§4).

A PNG embeds inline from a release URL the same way a GIF does (§4) — it is a complete deliverable.

## B. Video path — run the scenario by name (the harness records it)

Use video when motion is the point (transition, multi-step flow, live update, latency-to-payoff).
Run it on the box exactly the way CI runs e2e (`ci::e2e`): inside the Nix dev shell, with
`KOLU_EVIDENCE=1`. Select the scenario **by name** (`--name`, a regex over the scenario
title) — no feature-file edit. `just test-quick` builds the client and spawns the server
from source, so there is no separate serve step. Send a one-line runner script to dodge the
nested ssh/devshell quoting (`$scenario` expands locally into the script):

```sh
scenario="Editing an HTML file refreshes the iframe preview live"   # the scenario to record
pu connect "$host" -- "cat > ~/run-evidence.sh" <<SH
cd ~/kolu && nix develop -c bash -lc "KOLU_EVIDENCE=1 just test-quick features/<file>.feature --name '$scenario'"
SH
pu connect "$host" -- "bash ~/run-evidence.sh"
# → ~/kolu/packages/tests/reports/videos/<scenario-slug>.webm
```

For a **"before"** clip (or a before↔after still pair), run the same scenario on a second box
cloned at the base ref (e.g. `master`).

## 3. Legibility (the #1 quality issue)

- **Dense viewport.** The harness records at 1280×720, matched to `recordVideo.size`. The
  full 1920×1080 desktop leaves the terminal tile + side panel tiny in a sea of canvas — if
  a surface still reads small, tighten the viewport further (in `hooks.ts`'s
  `EVIDENCE_VIEWPORT`) or use a scenario step that maximizes the tile, rather than recording
  at full width.
- **Motion stays on** under `KOLU_EVIDENCE` (the determinism init script is skipped), so
  transitions actually show.
- **Brisk, then speed up** in transcode (`setpts=PTS/2`–`/3`) so agent-latency dead time
  doesn't drag; add a brief dwell step at the payoff if a beat gets lost.

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
GitHub release. (A screenshot from §A is a `.png` — upload and embed it the same way.)

```sh
scp -F ~/.pu-state/"$host"/ssh_config "$host":/tmp/cap/<slug>.png /tmp/evidence-<slug>.png
scp -F ~/.pu-state/"$host"/ssh_config "$host":/tmp/cap/<slug>.gif /tmp/evidence-<slug>.gif
scp -F ~/.pu-state/"$host"/ssh_config "$host":/tmp/cap/<slug>.mp4 /tmp/evidence-<slug>.mp4
gh release view <RELEASE> >/dev/null 2>&1 || \
  gh release create <RELEASE> --prerelease --title "Evidence assets" --notes "Do not delete."
gh release upload <RELEASE> /tmp/evidence-<slug>.png /tmp/evidence-<slug>.gif /tmp/evidence-<slug>.mp4 --clobber
```

Embed inline (GitHub renders PNG **and** animated GIF from any release URL):

```
![](https://github.com/<OWNER>/<REPO>/releases/download/<RELEASE>/<slug>.png)
![](https://github.com/<OWNER>/<REPO>/releases/download/<RELEASE>/<slug>.gif)
```

For a **before↔after** comparison, post the two stills side by side (a small two-cell table or two
`![]()` images labelled "Before" / "After").

A `<video>` tag in a comment is stripped, and GitHub only mints an inline player for files
dragged into the web composer — so the GIF (or the PNG, for a static state) is the at-a-glance
proof. For an HD clip, upload the `.mp4` to the same release and link the shared player
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
