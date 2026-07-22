<p align="center">
  <img src="packages/client/favicon.svg" width="64" alt="kolu icon" />
</p>

# kolu

kolu is a terminal app built for scale: real `xterm.js` tiles on an infinite 2D canvas, with a dock that never loses one — for `claude`, `codex`, `opencode`, or anything you run in a shell, especially many at once.

Unlike agent command centers that wrap a single model behind their own chat UI, kolu stays out of the agent's way: the terminal is the universal interface, so `claude`, `opencode`, or whatever ships next week works out of the box — and you can drop to a plain shell whenever you want. Two principles shape it — the [**Philosophy**](https://kolu.dev/philosophy) page has the full story:

- **Agent-agnostic.** No agent registry, no adapter, no vendor lock-in. Run any agent CLI once in a terminal and it picks up first-class features automatically.
- **Auto-detected, zero setup.** kolu populates its UI by watching what you already do — the repos you `cd` into, the agents you run, the sessions you save — not by asking you to configure it.

📖 **Full documentation lives at [kolu.dev](https://kolu.dev).** This README is a map; the canonical guides are there.

## Install & run

[Install Nix](https://nixos.asia/en/install) with flakes enabled, then run one command — the same command runs kolu _and_ updates it (`--refresh` busts Nix's flake cache so you always pull the latest commit):

```sh
nix --refresh run github:juspay/kolu       # serve on 127.0.0.1:7681
nix --refresh run github:juspay/kolu -- --host 0.0.0.0 --port 8080  # expose on LAN
```

Open <http://127.0.0.1:7681> (or the address you chose). The full walkthrough is [Quickstart](https://kolu.dev/quickstart) → [First five minutes](https://kolu.dev/first-five-minutes).

## What it does

Every capability below is documented in full on [kolu.dev](https://kolu.dev):

- **[Canvas](https://kolu.dev/canvas) & [tiles](https://kolu.dev/tiles)** — every terminal is a draggable, resizable `xterm.js` tile on an infinite, mode-less 2D canvas (WebGL, inline images, splits, font zoom, clickable `file:line` and folder links).
- **[The dock](https://kolu.dev/dock)** — a two-level left-edge navigator with per-repo grouping, a status indicator per row, recency ordering, and an activity-window filter; **[sleep & wake](https://kolu.dev/sessions)** parks a tile without keeping its PTY, agent, or GPU context alive.
- **[Agent detection](https://kolu.dev/agent-detection)** — live state (thinking · tool use · awaiting you · working · waiting) for **Claude Code, Codex, Grok, and OpenCode**, read straight from each agent's on-disk session.
- **[Worktrees & command palette](https://kolu.dev/concepts)** — creating a terminal in a repo branches a fresh git worktree; <kbd>Cmd/Ctrl+K</kbd> searches terminals, themes, and agent launches.
- **[Git & GitHub](https://kolu.dev/code-tab)** — auto-detected repo/branch/PR/CI, a Code-tab file browser with git-status tinting, rendered Markdown, inline HTML/SVG/PDF/image/video preview, and file comments.
- **[Theming](https://kolu.dev/theming)** · **[Clipboard & files](https://kolu.dev/clipboard)** — 200+ color schemes with inherit/shuffle; paste an image or drop a file and its path lands on the agent's input line.
- **[Power features](https://kolu.dev/power-features)** — transcript export, workspace screen recording, and driving kolu from the shell.
- **[Remote access](https://kolu.dev/remote-access)** & **[remote hosts](https://kolu.dev/remote-hosts)** — reach kolu over private HTTPS, and (alpha) run terminals on other machines as first-class tiles.


## Architecture

kolu splits the terminal problem across a stack of daemons that each survive a different failure: the **PWA client** and **kolu-server** are faces that come and go, while **[padi](https://kolu.dev/padi)** (the per-host workspace daemon) and **[kaval](https://kolu.dev/kaval)** (the PTY daemon) survive restarts and redeploys — so your shells and the agents in them keep running. Every layer talks over one typed reactive contract, **[@kolu/surface](https://kolu.dev/surface)**.

The full picture — the daemon stack, how the layers talk, the two data-flow loops, and the package map — is in **[Architecture](https://kolu.dev/architecture)**.

## Development

Requires [Nix](https://nixos.asia/en/install) with flakes enabled.

```sh
nix develop     # enter devshell
just dev        # run server + client with hot reload (fixed 7681/5173)
just dev-auto   # same, but on two random free ports — for a second instance
just dev-clean  # kill that slot's padi/kaval and wipe its state dir (see below)
just test       # e2e tests (full nix build)
```

`just dev-auto` is the safe way to run a second kolu (or to drive one from an agent) without colliding with an instance already holding the default ports; agents capturing evidence launch via the [`dev-server`](.apm/skills/dev-server/SKILL.md) skill. Bare `just dev` shares `$XDG_RUNTIME_DIR/kolu-dev-default/` across worktrees — if another worktree already holds that slot's padi, this branch adopts it. `just dev-clean` (optional port: `just dev-clean 7780`) SIGTERMs that slot's padi/kaval and removes the state + runtime dirs so the next `just dev` spawns a fresh padi from this tree.

## Contributing

Bug fixes, build/CI fixes, doc tweaks, and behavior-preserving refactors are welcome as direct PRs. **New user-facing features need a merged proposal first** — an [Atlas](docs/atlas/) note in the right category with `status: proposed`. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full split and the proposal frontmatter.

## CI

The pipeline (defined in [`ci/mod.just`](ci/mod.just)) is driven by [odu](https://github.com/juspay/odu) — the CI runner that grew up here, replaced [juspay/justci](https://github.com/juspay/justci), and graduated to its own repo (design history: the [mini-ci-vs-justci](docs/atlas/dist/mini-ci-vs-justci.html) Atlas note). kolu consumes it via an npins pin (`npins update odu` to bump) re-exported through this repo's flake, so the `nix run .#odu` invocations below work unchanged. It builds all flake outputs on x86_64-linux and aarch64-darwin, runs e2e tests, boots the packaged binary against `/api/health` as a runtime smoke, and posts GitHub commit statuses per `(recipe, platform)` pair. Remote lanes run over SSH against hosts from `~/.config/odu/hosts.json` (falls back to `~/.config/justci/hosts.json`), and a live run is attachable: `nix run .#odu -- attach` paints a dashboard over the run's typed surface on `.ci/odu.sock`. Agents drive CI through odu's MCP server — the single entry point (`mcp__odu__run` to start a run, `wait_for_settle` / `node_rerun` to watch and steer it, per-node logs read as MCP resources). For the x86_64-linux lane, `/do` **leases an idle box from a fixed pool of warm Incus containers** (`kolu-ci-1..8`, held by [`.apm/skills/ci/pu/lease.sh`](.apm/skills/ci/pu/lease.sh) as a background process and pinned into the run via the MCP's `hosts` argument; pool managed by `just ci::pool-ensure`) so the build starts with a hot Nix store and concurrent PRs don't contend on the substituter; see [`.agency/do.md`](.agency/do.md).

The DAG is shaped to keep the critical path short: `e2e`, `smoke`, and `home-manager` each build the one store path they need (`.#koluBin`, `.#default`, kolu-via-override) rather than depending on the full-output `nix` node, so the ~2-min e2e suite runs **concurrently** with the big build instead of after it (Nix store locking dedups the shared drv). `nix` still runs as a gate, so typecheck/website/packaging coverage is unchanged. See [`docs/ci-workflow-ralph-report.md`](docs/ci-workflow-ralph-report.md) for the critical-path model.

Workspace typechecking runs as a flake check (`checks.x86_64-linux.typecheck`), so the all-outputs build is the type gate. Note that `nix build .#default` on its own does **not** typecheck — the client is bundled by Vite and the server runs under `tsx`, both transpile-only — so a green app build is not a type-proof.

Only the runner posts GitHub commit statuses; the `just` shortcuts below stay entirely local.

```sh
nix run .#odu -- run                  # multi-platform fanout + commit statuses (strict by default)
nix run .#odu -- run --progress json  # + live NDJSON per-node feed on stdout (for agents/tools driving CI in the background)
nix run .#odu -- attach               # attach a live dashboard to a run in progress
just ci::attach                                  # same as `nix run .#odu -- attach`
just ci                                          # local single-platform pipeline, no statuses
just ci::e2e                                     # one recipe, no statuses
```

`--progress json` streams one line per node transition the instant it happens (`{node, recipe, platform, status, exit_code?, log?}`), so a tool driving CI in the background surfaces a failing recipe immediately — while sibling lanes keep running — instead of waiting for the run to finish. This is how `/do` reacts to failures fast; see [`.agency/do.md`](.agency/do.md).

## Deployment (home-manager)

A home-manager module runs kolu as a systemd user service on Linux and as a launchd LaunchAgent on macOS:

```nix
{
  imports = [ kolu.homeManagerModules.default ];
  services.kolu = {
    enable = true;
    package = kolu.packages.${system}.default;
    host = "127.0.0.1"; # default
    port = 7681;         # default
  };
}
```

See [`nix/home/example/`](nix/home/example/) for a full configuration — a NixOS VM test exercises the systemd path on Linux, and a standalone home-manager activation build exercises the launchd path on Darwin.

kolu's RPC surface is unauthenticated and same-origin-gated on both transports (see [Architecture → Talking over the wire](https://kolu.dev/architecture)), so it serves only its own origin out of the box. If you front it with a reverse proxy or `tailscale serve` whose browser origin differs from the `Host` kolu receives, list that origin in `services.kolu.allowedOrigins` (which sets the `KOLU_ALLOWED_ORIGINS` env var) so the browser clears the same-origin check:

```nix
services.kolu.allowedOrigins = [ "https://box.tailnet.ts.net" ];
```

On macOS, the LaunchAgent writes stdout to `~/Library/Logs/kolu.out.log` and stderr to `~/Library/Logs/kolu.err.log`, so crashes and startup failures leave service logs alongside other user logs.

### Diagnosing memory leaks

If kolu grows unbounded (V8 heap climbing over hours), set `services.kolu.diagnostics.dir` to an absolute path. Each restart gets its own timestamped subdir there, with a baseline heap snapshot at T+5min, periodic `"diag"` stats lines (memory bands + `terminals`/`publisherSize`/`claudeSessions`/`pendingSummaryFetches`), and automatic near-OOM snapshots via V8's `--heapsnapshot-near-heap-limit`. `kill -USR2 <pid>` captures an on-demand snapshot into the same dir. Diff two snapshots offline with [memlab](https://facebook.github.io/memlab/docs/cli/CLI-commands/) to name the retainer. Unset = zero overhead; the code path is fully gated.

## Website

The marketing site, docs, and blog at <https://kolu.dev> live in [`website/`](website/) — Astro + Tailwind, its own zero-input flake, deployed to GitHub Pages via `.github/workflows/pages.yml`. **The docs under [`website/src/content/docs/`](website/src/content/docs/) are the canonical, user-facing description of kolu** — this README points into them.

```sh
just website::dev          # live preview with HMR
just website::nix-build    # reproducible build
```

See [`website/README.md`](website/README.md) for authoring posts and deploy details.

---

Named after [கோலு](<https://en.wikipedia.org/wiki/Golu_(festival)>), the tradition of arranging figures on tiered steps.
