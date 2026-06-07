# screencast — marketing-grade clips of a real kolu

This produces the short, crisp, looping clips embedded on `kolu.dev/welcome`
(`website/public/demo/<name>.{mp4,webm,webp}`). It drives a **real** kolu (the
e2e harness + step library) and records the screen, so the clips are
reproducible from source rather than hand-recorded.

> Plan of record + the full build journal (why it's built this way):
> `docs/atlas/src/content/atlas/welcome-live-screencast.mdx`. **Keep both that
> note and this README in sync when you change things here.**

## The two halves

|                   | What it is                                                                                                                                   | Rule                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **`engine.ts`**   | AGNOSTIC capture: Xvfb + headful Chrome (app-mode) + `ffmpeg -f x11grab` + transcode. Knows nothing about kolu.                              | A `@kolu/web-screencast` graduation candidate — **never import kolu domain here.** The dependency arrow points OUT. |
| **`recordings/`** | kolu DOMAIN: one file per clip (`<name>.recording.ts`) declaring `{ name, chrome, theme, display, drive(world) }`, plus shared `helpers.ts`. | Reuse the World step helpers; lean on `helpers.ts` for the common patterns.                                         |

`step_definitions/recording_steps.ts` is the dispatcher (`When I record
"<name>"`); `features/recordings.feature` lists one scenario per recording;
`support/hooks.ts` (gated on `KOLU_X11CAP`) orchestrates the engine around the
Cucumber lifecycle.

## Capture

```sh
just record                    # all recordings
just record new-terminal-demo  # one, by name
```

Per do.md this is meant to run on a **pu box**; today the clips are captured
**locally** because the demo's climax launches a **real, authenticated agent**
(the `new-terminal-demo` runs `codex` — a clean box has no logged-in CLI). Nix
deps (`ffmpeg-full` + `Xvfb`) live in `./shell.nix`, layered onto the e2e shell
by the recipe — the top-level flake devShells are untouched.

### Time + size

- **~85s per recording** end-to-end on a warm checkout (`just record <name>`):
  client build + server start + the scripted flow (including a **real** agent
  query, which dominates) + x11grab + the ffmpeg transcode (mp4 + webm encode in
  parallel). A cold checkout is slower (nix fetches + a full client build).
  Because the agent's answer is a live LLM call, the run time (and clip length)
  **varies a few seconds run-to-run**.
- Each clip is 2560×1440; the three artifacts (`<name>.{mp4,webm,webp}`) live in
  `website/public/demo/` and are committed (the site needs them at build time).

**Per recording** (clip duration drives the file sizes; measured, expect ±a few
seconds since the agent's answer is live):

| Recording | Clip | mp4 (H.264) | webm (VP9) | webp poster |
| --- | --- | --- | --- | --- |
| `new-terminal-demo` | ~32s | ~2.4 MB | ~1.4 MB | ~29 KB |

## Add a recording

1. Create `recordings/<name>.recording.ts` exporting a `Recording`.
2. Register it in `recordings/index.ts`.
3. Add a `Scenario: <name>` to `features/recordings.feature`.
4. `just record <name>`, eyeball the frames, then embed in `welcome.astro`.

```ts
export const recording: Recording = {
  name: "my-demo",
  chrome: "app", // "app" = chromeless PWA window · "browser" = real chrome
  theme: "Vaughn", // pinned per recording (packages/terminal-themes)
  display: { hideRightPanel: true, hideMinimap: true }, // dock stays in for live status
  async drive(world) {
    await setupSingleTerminal(world); // themed terminal, clear of the dock
    await world.terminalRun("…");
    await launchAgentAndAsk(world, { prompt: "…" }); // dock pulses while it works
  },
};
```

### `helpers.ts` (the reusable patterns — extend these, don't re-roll)

- `setupSingleTerminal(world)` — the single-terminal-demo opening: clears any
  auto-restored terminal (clean empty canvas), beats on it, then creates one
  themed terminal nudged clear of the dock. Returns the id.
- `launchAgentAndAsk(world, { command, prompt, … })` — launch an agent and ask
  it something; waits for the dock bucket `working → awaiting`, glows the
  awaiting row, then holds. `CODEX_AUTONOMOUS` (codex, identity-neutral — no
  email/name banner) is the default agent; `CLAUDE_SONNET` exists but shows the
  account banner. Codex needs `acceptTrustGate: false` + a generous `bootMs`
  (slow typewriter intro); claude needs `acceptTrustGate: true`.
- `newTerminal(world)` — create a terminal + pin the recording's theme (via the
  `setTheme` RPC; no palette flash).
- `pause`, `setActiveTheme`, `CODEX_AUTONOMOUS`, `CLAUDE_SONNET`.

## Gotchas (learned the hard way)

- **`ffmpeg-full`, not `ffmpeg`** — plain nixpkgs ffmpeg is built `--disable-xlib`, so it has no x11grab device.
- **No window manager under Xvfb** — so F11 / the Fullscreen API can't drop Chrome's chrome mid-clip. A browser→app transition needs two concatenated segments, not an in-clip toggle.
- **Dock won't track the agent unless kolu watches the REAL dirs.** `hooks.ts` omits the `KOLU_CLAUDE_*_DIR` + `KOLU_CODEX_DIR` overrides under `KOLU_X11CAP` so the server sees the launched agent (the mock-harness temp dirs would hide it). The dock's high-level state is `data-bucket` ("working"/"awaiting"), NOT the raw `data-agent-state` ("thinking"/"tool_use"/"waiting") — poll the bucket.
- **codex: don't use `--dangerously-bypass-approvals-and-sandbox` interactively** — it shows a danger-confirmation that the prompt then dismisses (codex exits). Use `--ask-for-approval never --sandbox read-only` (autonomous, safe, no confirm). It also has a slow typewriter intro — wait it out before typing.
- **`claude --dangerously-skip-permissions` does NOT skip the folder-trust gate** — only per-tool prompts. `launchAgentAndAsk` accepts the gate explicitly (claude); codex shows no gate (`acceptTrustGate: false`).
- **The app-mode session auto-restores a terminal** — even after the harness's session reset, a terminal reappears on reload. `setupSingleTerminal` `killAll`s it for a clean empty canvas; `transcodeToWeb({ trimStart })` then skips the (multi-second) load-in + killAll so the clip opens on the empty welcome.
- **`chrome: "app"` vs `"browser"`** — "app" launches a chromeless `--app=` window (the installed-PWA surface, used by the demo); "browser" keeps real tabs + address bar. A browser→app transition _within_ one clip isn't possible here (no WM to drop the chrome) — it'd need two concatenated segments.
