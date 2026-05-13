---
title: "chrome-devtools MCP for Nix-based AI agents, in one line"
description: "Drop one dep into apm.yml and apm install wires chrome-devtools-mcp into every runtime — Claude Code, Codex, OpenCode. Chrome and Node resolve via Nix. No devshell required."
pubDate: 2026-05-12
author: "Sridhar Ratnakumar"
---

_Drop one dep into apm.yml and `apm install` wires `chrome-devtools-mcp` into every runtime — Claude Code, Codex, OpenCode. Chrome and Node resolve through Nix. No devshell required._

[`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) is the official MCP server for AI agents that need to drive a real Chrome — DOM inspection, network capture, heap snapshots, performance traces. It's what powers [Kolu](https://kolu.dev)'s `/perf-diagnose` skill — the one that caught the [WebGL leak](/blog/xtermjs-perf/) a few weeks back.

The official install path is `npx -y chrome-devtools-mcp@latest --executable-path=…`. That `--executable-path` flag is mandatory in headless / containerized / Nix environments where Puppeteer's auto-download doesn't fly. So every consumer who wanted this MCP had to:

1. Get a Chrome-for-Testing binary onto disk somehow.
2. Hand-write a launcher in bash (because Chrome's filesystem layout differs across Linux + macOS).
3. Mirror the launcher invocation across `.mcp.json` (Claude Code), `.codex/config.toml` (Codex), `opencode.json` (OpenCode), and any new runtime that ships next month.

Three copies of the same thing, each one stale-prone. That was Kolu's setup until last week.

## The new shape

[**`juspay/nix-chrome-devtools-mcp`**](https://github.com/juspay/nix-chrome-devtools-mcp) packages all three concerns — Chrome resolution, the launcher, the multi-runtime config wiring — into a single [APM](https://microsoft.github.io/apm/) dep. Consumer side, the entire integration is one line in [`apm.yml`](https://microsoft.github.io/apm/reference/manifest-schema/):

```yaml
dependencies:
  apm:
    - juspay/nix-chrome-devtools-mcp
```

`apm install` does the rest. The launcher gets deployed to `.agents/skills/nix-chrome-devtools-mcp/bin/serve` (a path checked into your repo, so it's available immediately after `git clone` — no install-step race for new contributors). The MCP server declaration in the package's own `apm.yml` is aggregated into every supported runtime's native config via APM's [transitive MCP collection](https://github.com/microsoft/apm/blob/main/src/apm_cli/integration/mcp_integrator.py).

You write one line. APM emits `.mcp.json`, `.codex/config.toml`, `opencode.json`, and whatever new harness adds itself to the matrix.

## How the launcher resolves Chrome

`bin/serve` is twenty lines of bash. It calls Nix directly — no `shell.nix`, no `flake.nix` on the consumer's side:

```bash
nixpkgs="${NIXPKGS_FLAKE:-nixpkgs}"
mcp_version="${CHROME_DEVTOOLS_MCP_VERSION:-latest}"

browsers=$(nix build --no-link --print-out-paths \
    "${nixpkgs}#playwright-driver.browsers")

# locate Chrome:
#   Linux: chrome-linux64/chrome
#   macOS: chrome-mac-*/Google Chrome for Testing.app/Contents/MacOS/...

exec nix shell "${nixpkgs}#nodejs" --command \
    npx -y "chrome-devtools-mcp@${mcp_version}" \
    --headless=true --isolated=true \
    --executable-path="$chrome"
```

The Chrome binary comes from [`pkgs.playwright-driver.browsers`](https://search.nixos.org/packages?query=playwright-driver) — a nixpkgs attribute that ships a known-good Chrome-for-Testing under a deterministic store path. `nix build --print-out-paths` realises the store path (cached after first run) and prints it. `nix shell --command` makes Node available on PATH and execs the MCP server with the resolved Chrome.

Two env vars are the override surface:

| Var | Default | Effect |
|---|---|---|
| `NIXPKGS_FLAKE` | `nixpkgs` | flake-ref for the Chrome + Node toolchain. Override to bump the Chrome milestone (Lighthouse-sensitive workflows). |
| `CHROME_DEVTOOLS_MCP_VERSION` | `latest` | npm dist-tag or version of the MCP server. Pin to a specific version (e.g. `0.26.0`) when you need reproducibility. |

The whole launcher is **self-contained** in the sense that matters — no surrounding `nix develop` or `nix-shell` wrapping required. The MCP client just executes `.agents/skills/nix-chrome-devtools-mcp/bin/serve` from your project root and the launcher resolves everything else through `nix build` / `nix shell`.

## Try it

Add the dep to your project's `apm.yml`, run `apm install` (or your project's wrapper — `just ai::apm` in Kolu's case), and your next agent session will have a `chrome-devtools` MCP server ready to drive Chrome on demand. Probe it: ask the agent to open a page, take a screenshot, dump the console, snapshot the heap.

Requirements: Nix with flakes enabled (`experimental-features = nix-command flakes`). If you need to get there, [nixos.asia/en/install](https://nixos.asia/en/install) is the path.

Repo: <https://github.com/juspay/nix-chrome-devtools-mcp>.
