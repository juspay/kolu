# screencast — marketing-grade clips of a real kolu

This produces the short, crisp, looping clips embedded on `kolu.dev/welcome`
(`website/public/demo/<name>.{mp4,webm,webp}`). It drives a **real** kolu (the
e2e harness + step library) and records the screen, so the clips are
reproducible from source rather than hand-recorded.

> Plan of record + the full build journal (why it's built this way):
> `docs/atlas/src/content/atlas/welcome-live-screencast.mdx`. **Keep both that
> note and this README in sync when you change things here.**

## The two halves

| | What it is | Rule |
| --- | --- | --- |
| **`engine.ts`** | AGNOSTIC capture: Xvfb + headful Chrome (app-mode) + `ffmpeg -f x11grab` + transcode. Knows nothing about kolu. | A `@kolu/web-screencast` graduation candidate — **never import kolu domain here.** The dependency arrow points OUT. |
| **`recordings/`** | kolu DOMAIN: one file per clip (`<name>.recording.ts`) declaring `{ name, chrome, theme, display, drive(world) }`, plus shared `helpers.ts`. | Reuse the World step helpers; lean on `helpers.ts` for the common patterns. |

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
**locally** because the demo's climax needs an authenticated `claude` (a clean
box has none). Nix deps (`ffmpeg-full` + `Xvfb`) live in `./shell.nix`, layered
onto the e2e shell by the recipe — the top-level flake devShells are untouched.

## Add a recording

1. Create `recordings/<name>.recording.ts` exporting a `Recording`.
2. Register it in `recordings/index.ts`.
3. Add a `Scenario: <name>` to `features/recordings.feature`.
4. `just record <name>`, eyeball the frames, then embed in `welcome.astro`.

```ts
export const recording: Recording = {
  name: "my-demo",
  chrome: "app",            // "app" = chromeless PWA window · "browser" = real chrome
  theme: "Vaughn",          // pinned per recording (packages/terminal-themes)
  display: { hideRightPanel: true, hideMinimap: true }, // dock stays in for live status
  caption: "…",             // used by the embed/docs
  async drive(world) {
    await setupSingleTerminal(world);            // themed terminal, clear of the dock
    await world.terminalRun("…");
    await launchAgentAndAsk(world, { prompt: "…" }); // dock pulses while it works
  },
};
```

### `helpers.ts` (the reusable patterns — extend these, don't re-roll)

- `setupSingleTerminal(world)` — the single-terminal-demo opening: themed
  terminal nudged clear of the dock. Returns the id.
- `launchAgentAndAsk(world, { prompt })` — launch `CLAUDE_SONNET`, accept the
  folder-trust gate, submit a prompt, dwell while the dock tracks the agent.
- `newTerminal(world)` — create a terminal + pin the recording's theme (via the
  `setTheme` RPC; no palette flash).
- `pause`, `setActiveTheme`, `CLAUDE_SONNET`.

## Gotchas (learned the hard way)

- **`ffmpeg-full`, not `ffmpeg`** — plain nixpkgs ffmpeg is built `--disable-xlib`, so it has no x11grab device.
- **No window manager under Xvfb** — so F11 / the Fullscreen API can't drop Chrome's chrome mid-clip. A browser→app transition needs two concatenated segments, not an in-clip toggle.
- **Dock won't track the agent unless kolu watches the REAL `~/.claude/projects`.** `hooks.ts` omits the `KOLU_CLAUDE_*_DIR` overrides under `KOLU_X11CAP` so the server sees the launched claude (the mock-harness temp dirs would hide it).
- **`--dangerously-skip-permissions` does NOT skip the folder-trust gate** — only per-tool prompts. `launchAgentAndAsk` accepts the gate explicitly.
- **Trim the leading blank** — capture starts before the first navigation; `transcodeToWeb({ trimStart })` drops it.
- **app vs browser chrome** is intentional: the demo is the installed-PWA window; the install clip shows a real browser (you install *from* a browser).
