# Capture recipes — loaded on demand from the evidence skill

How the harness records (wired in `packages/tests/support/hooks.ts`, gated on
`KOLU_EVIDENCE`): off by default; with `KOLU_EVIDENCE=1` the e2e harness sets
Playwright `recordVideo` at a dense 1280×720 viewport (full 1920×1080 floats the
UI small — tighten `EVIDENCE_VIEWPORT` in `hooks.ts` if a surface still reads
small), adds `slowMo`, keeps animations on, and saves the page's `.webm`
scenario-named to `packages/tests/reports/videos/` in the `After` hook. The same
hooks file also has a `page.screenshot()` mechanism, and every recorded run
leaves a frame-accurate `.webm` you can pull a still from.

## Provision

```sh
host="kolu-pr-<N>"
branch="$(git rev-parse --abbrev-ref HEAD)"
pu create "$host"                          # see the pu skill (incl. egress check)
pu connect "$host" -- "git clone --depth 1 -b $branch https://github.com/juspay/kolu ~/kolu"
```

## Video — run a scenario by name (the harness records it)

Run exactly the way CI runs e2e: inside the Nix dev shell, `KOLU_EVIDENCE=1`,
scenario selected by `--name` (regex over the scenario title, no feature-file
edit). `just test-quick` builds the client and spawns the server from source —
no separate serve step. Send a one-line runner script to dodge nested
ssh/devshell quoting:

```sh
scenario="Editing an HTML file refreshes the iframe preview live"
pu connect "$host" -- "cat > ~/run-evidence.sh" <<SH
cd ~/kolu && nix develop -c bash -lc "KOLU_EVIDENCE=1 just test-quick features/<file>.feature --name '$scenario'"
SH
pu connect "$host" -- "bash ~/run-evidence.sh"
# → ~/kolu/packages/tests/reports/videos/<scenario-slug>.webm
```

For a "before" clip or before↔after pair, run the same scenario on a second box
cloned at the base ref.

## Screenshot

**Still from a clip** — when any scenario (even one you didn't write) drives the
browser through the state: run it under `KOLU_EVIDENCE=1`, then extract the
frame at the payoff moment:

```sh
pu connect "$host" -- 'bash -lc "
  WEBM=\$(ls ~/kolu/packages/tests/reports/videos/*.webm | head -1)
  nix shell nixpkgs#ffmpeg -c ffmpeg -y -ss 3 -i \$WEBM -vframes 1 /tmp/cap/<slug>.png
"'   # -ss <seconds> = when the state is on screen; bump until the frame is right
```

**Drive the state live** — for a state no scenario reaches, use the
chrome-devtools MCP (`nix-chrome-devtools-mcp` skill): serve kolu on the box
(`nix develop -c just test-quick` leaves it serving), stage any on-disk
precondition with plain shell (e.g. `ln -s /etc/passwd ~/kolu/<ws>/leak`), then
`navigate_page` / `click` / `wait_for` / `take_screenshot`. Reach the box over
the `pu connect` port forward, or run the MCP browser on the box.

## Transcode

```sh
pu connect "$host" -- 'bash -lc "
  WEBM=\$(ls ~/kolu/packages/tests/reports/videos/*.webm | head -1)
  nix shell nixpkgs#ffmpeg -c ffmpeg -y -i \$WEBM \
    -vf \"setpts=PTS/2,fps=12,scale=1100:-1:flags=lanczos\" -loop 0 /tmp/cap/<slug>.gif
  nix shell nixpkgs#ffmpeg -c ffmpeg -y -i \$WEBM -filter:v setpts=PTS/2 -an /tmp/cap/<slug>.mp4
"'
```

Speed up (`setpts=PTS/2`–`/3`) so agent-latency dead time doesn't drag; add a
brief dwell step at the payoff if a beat gets lost.

## Host & post

```sh
scp -F ~/.pu-state/"$host"/ssh_config "$host":/tmp/cap/<slug>.png /tmp/<slug>.png
gh release view evidence-assets >/dev/null    # must exist; fail loudly if not
gh release upload evidence-assets /tmp/<slug>.png /tmp/<slug>.gif /tmp/<slug>.mp4 --clobber
```

Embed: `![](https://github.com/<OWNER>/<REPO>/releases/download/evidence-assets/<slug>.png)`
(PNG and animated GIF both render inline from a release URL). Before↔after: two
labelled stills side by side. `<video>` tags are stripped from comments — for an
HD clip link the shared player:
`▶ HD: https://juspay.github.io/video-evidence/evidence.html?repo=<OWNER>/<REPO>&v=<slug>.mp4`

## Terminal / TUI (vhs)

Record the terminal itself with [`vhs`](https://github.com/charmbracelet/vhs)
(`nix run nixpkgs#vhs`; bundles chromium on Linux). A `.tape` types into a real
pty and emits GIF + MP4 (one `Output` line per format):

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
Type "2"          # drive the TUI's keys
Sleep 3s
Type "q"
Sleep 1200ms
```

Run vhs inside the project's nix devshell so its spawned shell inherits the
toolchain:

```sh
pu connect "$host" -- 'cd ~/app && nix develop -c bash -lc "cd /tmp/cap && nix run nixpkgs#vhs -- demo.tape"'
```

Gotchas:

- `Output` paths must be **relative** — vhs mis-lexes absolute paths ("Invalid
  command"); run from the output dir.
- scp the `.tape` to the box rather than heredoc it through nested ssh quoting.
- No reliable `Screenshot` command (vhs 0.10) — pull a still with
  `ffmpeg -ss N -i demo.mp4 -vframes 1 still.png`.
- Crop dead space / trim waits with ffmpeg (`crop=`, `-ss`), then regenerate the
  GIF with a `palettegen`/`paletteuse` pass.
- Ephemeral pu boxes can't ssh each other — a capture that itself ssh's
  somewhere runs from your machine, not a second box.
- macOS: vhs needs chromium (Linux-only in nixpkgs) — drive the Mac from a Linux
  box over the app's remote/ssh mode, or use `asciinema` + `agg`.
