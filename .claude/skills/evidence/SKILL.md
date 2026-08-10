---
name: evidence
description: >-
  Produce visual PR evidence — a screenshot or video — whenever a change has
  on-screen impact. Tests are never a substitute; a change can be backend by
  cause and visible by effect. Capture via the project's e2e harness on a pu
  box, or by driving a live kolu with the chrome-devtools MCP; host on a GitHub
  release and post a `## Evidence` comment. Triggers on "post evidence",
  "screenshot the change", "record a video of this", "show it working", "prove
  it", or finishing any change whose effect is visible on screen.
---

# evidence — PR screenshots & video

## The gate — answer this first

> If someone exercised what this change affects, would the screen look
> DIFFERENT — before vs. after?

- **YES → a visual artifact is mandatory.** Static (end-state, single moment,
  before↔after) → **screenshot**. Motion (transition, flow, live update,
  animation) → **video**. A value-over-time element — a running timer, live
  counter, anything whose *job* is to change on its own — is motion: a frozen
  clock and a live one are pixel-identical in one frame, so watch it tick.
  A screenshot is a complete deliverable, not a runner-up to video.
- **NO → skip with one explicit PR line: `No visual impact: <why>.`** Silent
  skips are not allowed; neither is manufacturing a tenuous pixel for a change
  whose screen truly doesn't differ.

Excuses that don't hold (each was tried on a real PR and rejected):

- **"Backend change, no UI surface."** Backend by cause can be visible by
  effect — trace the effect to the screen, not the cause to a layer.
- **"No scenario exercises it."** That decides *how* you capture, never
  *whether*.
- **"It's a CLI/TUI — here's a transcript."** A terminal is an on-screen
  surface, and a pasted transcript is not a visual artifact. Record the real
  binary with vhs/asciinema.
- **"The tests prove it."** Tests accompany the artifact, never replace it.
- **"I reconstructed the output — close enough."** A synthesized artifact
  (formatter output posted as a recording, mocked data, a stub's clip) is a
  fabrication, and it hides the very bug evidence exists to expose. The
  artifact comes from really executing the change end-to-end against real
  data — and read the real output to confirm the feature works before posting.

## Capture

Runs on an ephemeral **pu box** (see the pu skill), never locally, so evidence
reflects a clean CI-like build of the PR's commit.

**Prefer the existing Cucumber + Playwright e2e harness** — `KOLU_EVIDENCE=1`
turns on video recording (see `packages/tests/support/hooks.ts`) and you select
a scenario by name. It's the default because the clip comes from the same code
CI runs. The one thing to avoid building is a *parallel capture harness* that
duplicates the step library; everything else is fair game when the harness
can't reach the state: pull a still from a recorded clip, drive a live kolu
with the chrome-devtools MCP and `take_screenshot`, `vhs` for a TUI, ordinary
shell setup for on-disk preconditions. Never skip for lack of a canned path.

**Delegate capture to a subagent** so the main context stays clear: brief it
with the box, branch, image-or-video, the scenario or live state, a `<slug>`,
the PR number, and the release tag; it returns the markdown it posted.

Commands, harness details, transcode settings, and vhs gotchas:
**[CAPTURE.md](CAPTURE.md)**.

## Host & post

- **`evidence-assets` is the one fixed release tag.** It already exists; verify
  it does, never create another, never derive a tag from the PR number.
- **The local filename IS the asset name** — copy back as `/tmp/<slug>.png`,
  not a decorated name, or every `…/download/evidence-assets/<slug>.png` embed
  404s.
- GIF embeds inline (keep under GitHub's ~10 MB limit); MP4 links via the
  shared player (`juspay.github.io/video-evidence`). PNG embeds like a GIF.
- Use a single-quoted heredoc when posting so backticks and `$` survive.
- **Tear the box down** when finished: `pu destroy "$host"`.
