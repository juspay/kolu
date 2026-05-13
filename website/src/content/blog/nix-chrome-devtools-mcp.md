---
title: "Give your coding agent a browser, on Nix"
description: "A practical setup guide: install Nix, add one dep to apm.yml, your AI agent (Claude Code / Codex / OpenCode) gets DOM inspection, screenshots, network traces, and heap snapshots."
pubDate: 2026-05-12
author: "Sridhar Ratnakumar"
---

_Install Nix, add one APM dep, and your agent — Claude Code, Codex, or OpenCode — gets a real Chrome to drive: DOM inspection, screenshots, network traces, heap snapshots._

If you've ever wanted your AI coding agent to actually **see your app running** — take a screenshot, dump the DOM, check the network panel, snapshot the JS heap — Google ships an MCP server for exactly that: [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp). It speaks the [Model Context Protocol](https://modelcontextprotocol.io/), so any compliant agent harness can plug into it.

Wiring it into your project used to be irritating — you needed a Chrome binary, a launcher script, and a per-runtime config block (one for Claude Code, another for Codex, another for OpenCode). This guide gets you to a working setup by leaning on two tools you may not yet be using together: **Nix** and **APM**.

> One-sentence pitches: **[Nix](https://nixos.org/)** gives you reproducible binaries — Chrome, Node, anything — without manual installers. **[APM](https://microsoft.github.io/apm/)** is the package manager for AI agent context: like `npm`, but the things you install are skills and MCP servers rather than libraries.

## Step 1 — Install Nix

Follow [nixos.asia/en/install](https://nixos.asia/en/install). The installer takes a minute on macOS or Linux. Verify:

```sh
nix --version
```

If you used the nixos.asia path, flakes are already enabled. If you installed Nix some other way, add this to `~/.config/nix/nix.conf`:

```ini
experimental-features = nix-command flakes
```

## Step 2 — Drop one dep into apm.yml

APM is a Python tool. You don't need to install it — Nix can pull [`uvx`](https://docs.astral.sh/uv/) on demand, and `uvx` in turn fetches APM from its Python package on first run:

```sh
nix shell nixpkgs#uv -c uvx --from apm-cli apm --version
```

In your project root, create `apm.yml`:

```yaml
name: my-project
version: 0.1.0
targets:
  - claude     # for Claude Code
  - codex      # for OpenAI Codex CLI
  - opencode   # for OpenCode CLI

dependencies:
  apm:
    - juspay/nix-chrome-devtools-mcp
```

Keep only the `targets` you actually use. Then install:

```sh
nix shell nixpkgs#uv -c uvx --from apm-cli apm install --target claude,codex,opencode
```

APM clones [`juspay/nix-chrome-devtools-mcp`](https://github.com/juspay/nix-chrome-devtools-mcp), deploys its launcher into `.agents/skills/nix-chrome-devtools-mcp/bin/serve`, and writes a per-runtime MCP config for each target — `.mcp.json` for Claude Code, `.codex/config.toml` for Codex, `opencode.json` for OpenCode.

## Step 3 — Verify

Open `.mcp.json` (or your runtime's equivalent). You should see a `chrome-devtools` server entry:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": ".agents/skills/nix-chrome-devtools-mcp/bin/serve",
      "args": [],
      "type": "stdio"
    }
  }
}
```

Launch your agent and ask:

> Open https://kolu.dev in a fresh page and tell me what's in the H1.

Under the hood the agent calls `mcp__chrome-devtools__new_page`, then `mcp__chrome-devtools__take_snapshot`, and inspects the DOM tree. A non-exhaustive shopping list of what's now available:

- `new_page`, `navigate_page`, `close_page` — page lifecycle
- `take_snapshot`, `take_screenshot` — DOM + image capture
- `evaluate_script` — run arbitrary JS, get the result back
- `list_console_messages`, `list_network_requests` — observability panes
- `take_memory_snapshot`, `performance_start_trace` — perf + heap

> **Tip — more skills.** Now that you have `apm.yml`, browse [`juspay/skills`](https://github.com/juspay/skills) for ready-made skills you can drop in next: `nix-flake`, `nix-haskell`, `nix-typescript`, `nix-playwright`, `vhs`, and more. Each is a one-liner under `dependencies.apm:` the same way `nix-chrome-devtools-mcp` is.

## What we actually use it for

The 90% use case for this MCP in our own workflow isn't ad-hoc browser automation — it's **PR evidence screenshots**, captured automatically when an agent ships UI work.

Our [`/do`](https://agency.srid.ca/) workflow (from [`srid/agency`](https://github.com/srid/agency)) ends with an `evidence` step: spawn a dev server on a free port, point `chrome-devtools-mcp` at the relevant routes, run `take_screenshot`, upload to a long-lived [`evidence-assets`](https://github.com/juspay/kolu/releases/tag/evidence-assets) GitHub release, embed the URLs in the PR comment. The reviewer sees exactly what changed without checking out the branch.

Three recent examples from Kolu PRs:

[**#835 — Worktree-naming leaf**](https://github.com/juspay/kolu/pull/835#issuecomment-4393613826). The agent captured the new pre-filled name input that appears between "New terminal → kolu" and the actual worktree spawn:

![Worktree-naming leaf with prefilled `peaked-rank` suggestion](/blog/kolu-evidence-worktree-name-leaf.png)

[**#866 — Show agent icons in New terminal command palette**](https://github.com/juspay/kolu/pull/866#issuecomment-4430710269). The agent took before/after of two distinct palettes that share the same icon builder, confirming both palettes render identically.

[**#867 — Let folders collapse while the Code tab filter stays active**](https://github.com/juspay/kolu/pull/867#issuecomment-4432265073). The agent reproduced a folder-collapse bug and built a three-step diagnostic table comparing `master` vs the fix, screenshots inline at each step. (Worth reading the comment — the structure is half the value.)

In both cases the agent invokes `mcp__chrome-devtools__new_page`, `mcp__chrome-devtools__take_screenshot`, and the rest of the tool list — the harness just sees those as additional capabilities. No human had to run a screenshot tool by hand or remember which routes to capture.

## Overrides (optional)

The launcher honours two env vars, set before you launch the agent:

| Var | Default | Effect |
|---|---|---|
| `NIXPKGS_FLAKE` | `nixpkgs` | which `nixpkgs` to pull Chrome + Node from. Override to bump the Chrome milestone — e.g. `NIXPKGS_FLAKE=github:NixOS/nixpkgs/nixpkgs-unstable`. |
| `CHROME_DEVTOOLS_MCP_VERSION` | `latest` | npm version of the MCP server itself. Pin to `0.26.0` (or any release) when you need reproducibility. |

## What's actually happening

`bin/serve` is twenty lines of bash. It runs `nix build nixpkgs#playwright-driver.browsers` to materialise Chrome-for-Testing (the same Chrome binary the Playwright project bundles), then `nix shell nixpkgs#nodejs --command npx -y chrome-devtools-mcp@latest --executable-path=$chrome` to start the server. All inputs are resolved through Nix; nothing gets dropped into your project tree as a side-effect.

> **Aside on provenance.** This package was extracted from [Kolu](https://kolu.dev)'s own `/perf-diagnose` skill — see [the WebGL-leak debugging post](/blog/xtermjs-perf/) for what we use it for. After iterating on the shape inside Kolu, we lifted it into its own repo under Apache 2.0 ([juspay/nix-chrome-devtools-mcp#1](https://github.com/juspay/nix-chrome-devtools-mcp/pull/1)) so any Nix-using AI-agent project can drop it in.

## Where next

- [`juspay/nix-chrome-devtools-mcp`](https://github.com/juspay/nix-chrome-devtools-mcp) — the package itself, plus README.
- [APM's docs](https://microsoft.github.io/apm/) — `apm.yml` schema, install / compile semantics.
- [`chrome-devtools-mcp` docs](https://github.com/ChromeDevTools/chrome-devtools-mcp#readme) — full tool list, configuration flags, troubleshooting.
