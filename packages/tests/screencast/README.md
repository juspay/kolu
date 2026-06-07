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

Each clip pins a **distinct predefined terminal theme** (reproducible — a name
from `packages/terminal-themes`), so the three look visually different.

| Recording | Theme | Clip | mp4 (H.264) | webm (VP9) | webp poster | Embedded on |
| --- | --- | --- | --- | --- | --- | --- |
| `new-terminal-demo` | Dracula | ~28s | ~2.0 MB | ~1.4 MB | ~29 KB | `/welcome` §02 |
| `dock-alert-demo` | Vaughn + Catppuccin Latte | ~29s | ~2.5 MB | ~1.7 MB | ~0.13 MB | `/` (home hero) |
| `code-review-demo` | Nord | ~15s | ~0.9 MB | ~0.7 MB | ~0.11 MB | `/welcome` §03 |

`dock-alert-demo` is the richest clip: it opens on an empty canvas, **clicks the
"+"** to create terminals (every on-camera click is telegraphed with a coral
arrow), runs **two agents in two repos** (claude in kolu, codex in drishti —
they group by repo in the dock), buries claude's tile behind codex's, shows the
dock flagging the buried agent that needs you, then clicks that dock row to raise
the tile and picks an option in claude's **AskUserQuestion** prompt. T2 uses a
**light theme** (Catppuccin Latte) to set it apart from T1's dark Vaughn.

`code-review-demo` is short and agent-free: a terminal in a repo → the **Code tab
→ "All files"** → open a source file (by file search — robust against the
virtualized Pierre tree) → select text → the inline **"+ Comment"** pill → leave
a note → **copy the tray as Markdown** for an agent. The comment-on-any-file →
agent loop in one tight clip.

> **Comment surfaces:** the comment seam mounts on the rendered Markdown preview
> (`prose`) and the source view (`text`) — both selectable from the parent — but
> NOT inside a rendered `.html` artifact (opaque-origin iframe; it uses the
> in-iframe SDK). Comment on source or the Markdown preview, never the iframe.
> Open files by **search** (`openFileBySearch`), not a direct tree-row click —
> the Pierre file tree is virtualized, so a root-level row (e.g. `README.md`) can
> fail to resolve, and a filename like `README` is ambiguous; a full-path search
> is reliable.

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

- `clearCanvas(world, beatMs?)` — kill any auto-restored terminal and beat on the
  empty canvas (the clean opening every clip starts from).
- `setupSingleTerminal(world)` — `clearCanvas` + create one themed terminal (via
  the keyboard shortcut) nudged clear of the dock. Returns the id.
- `createTerminalByClick(world, theme?, label?)` — create a terminal by **clicking
  the dock "+"** (telegraphed with a coral arrow), confirming the new-terminal
  palette with Enter ("In current directory"). The visible, on-camera way to open
  a terminal. Per-terminal `theme` override.
- `openOverlappingTerminal(world, { theme })` — `createTerminalByClick` + drag the
  new tile to a deterministic offset that **buries** the previous tile.
- `clickWithArrow(world, selector, label, dir?)` — arrow → hold → click → clear.
  Use for every on-camera mouse click so the viewer sees what's clicked.
- `launchAgentAndAsk(world, { command, prompt, … })` — launch an agent and ask it
  something; waits for the dock bucket `working → awaiting`, annotates, holds.
- `annotate(world, selector, label, dir)` / `clearAnnotations(world)` — coral
  arrow + label pointing at any element.
- `waitForDockBucket(world, bucket, timeout)` — wait (THROWS on timeout) for a dock
  row to reach `working`/`awaiting`/`idle`. Qualified on `dock-row` so it never
  matches a minimap rect.
- Agents: `CLAUDE_SONNET` (shows the account banner — name/email/plan),
  `CODEX_AUTONOMOUS` (identity-neutral). Both show a first-run **directory-trust
  prompt** on a fresh checkout — press Enter to accept ("Yes, I trust" / "Yes,
  continue") before typing the prompt, or it leaks to the shell.
- `pause`, `setActiveTheme`, `setTerminalThemeRpc`, `newTerminal`.

## Gotchas (learned the hard way)

- **`ffmpeg-full`, not `ffmpeg`** — plain nixpkgs ffmpeg is built `--disable-xlib`, so it has no x11grab device.
- **Fonts must be supplied to the capture Chrome** — under bare Xvfb, Chrome has no fonts unless `shell.nix` provides them. `shell.nix` builds a `makeFontsConf` (Noto + Noto Color Emoji + CJK + DejaVu + Liberation + Nerd-Fonts-Symbols) and exports `FONTCONFIG_FILE`; without it, emoji and powerline/Nerd glyphs (the shell prompt's git segment, agent banners) render as tofu boxes. Keep fonts **free-licensed** — an unfree font (e.g. `symbola`) makes the `nix-shell` build fail.
- **A full-screen agent TUI (codex) paints its own background** — so a light terminal theme shows mostly in the tile *chrome* (titlebar/border), not behind the agent's output.
- **The "+" opens the new-terminal palette, not a terminal directly** — `createTerminalByClick` clicks it, then presses Enter to confirm "In current directory". That row inherits the *active* terminal's cwd, so a second terminal opens in the first's directory until you `cd`.
- **No window manager under Xvfb** — so F11 / the Fullscreen API can't drop Chrome's chrome mid-clip. A browser→app transition needs two concatenated segments, not an in-clip toggle.
- **Dock won't track the agent unless kolu watches the REAL dirs.** `hooks.ts` omits the `KOLU_CLAUDE_*_DIR` + `KOLU_CODEX_DIR` overrides under `KOLU_X11CAP` so the server sees the launched agent (the mock-harness temp dirs would hide it). The dock's high-level state is `data-bucket` ("working"/"awaiting"), NOT the raw `data-agent-state` ("thinking"/"tool_use"/"waiting") — poll the bucket.
- **codex: don't use `--dangerously-bypass-approvals-and-sandbox` interactively** — it shows a danger-confirmation that the prompt then dismisses (codex exits). Use `--ask-for-approval never --sandbox read-only` (autonomous, safe, no confirm). It also has a slow typewriter intro — wait it out before typing.
- **`claude --dangerously-skip-permissions` does NOT skip the folder-trust gate** — only per-tool prompts. `launchAgentAndAsk` accepts the gate explicitly (claude); codex shows no gate (`acceptTrustGate: false`).
- **The app-mode session auto-restores a terminal** — even after the harness's session reset, a terminal reappears on reload. `setupSingleTerminal` `killAll`s it for a clean empty canvas; `transcodeToWeb({ trimStart })` then skips the (multi-second) load-in + killAll so the clip opens on the empty welcome.
- **`chrome: "app"` vs `"browser"`** — "app" launches a chromeless `--app=` window (the installed-PWA surface, used by the demo); "browser" keeps real tabs + address bar. A browser→app transition _within_ one clip isn't possible here (no WM to drop the chrome) — it'd need two concatenated segments.
