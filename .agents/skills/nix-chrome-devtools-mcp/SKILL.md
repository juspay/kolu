---
name: nix-chrome-devtools-mcp
description: Launch chrome-devtools-mcp from any Nix-using project. Ships a single executable launcher (bin/serve) that resolves Playwright's bundled Chrome-for-Testing and Node.js directly via Nix — no surrounding devshell required.
user-invocable: false
---

# chrome-devtools-mcp launcher

Drop-in launcher for declaring [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) as an MCP server in any Nix-using project. One bash file resolves all inputs through `nix build` / `nix shell` — no `shell.nix`, no `flake.nix`, no `nix-shell` wrapper in the MCP command.

## What this ships

| Path | Purpose |
|---|---|
| `bin/serve` | Self-contained launcher. Calls `nix build nixpkgs#playwright-driver.browsers` to resolve Chrome, then `nix shell nixpkgs#nodejs --command npx ...` to run a pinned `chrome-devtools-mcp` version. |

The apm.yml `mcp:` entry points directly at `bin/serve` (deployed to `.agents/skills/nix-chrome-devtools-mcp/bin/serve` — APM's [cross-tool convergence path](https://microsoft.github.io/apm/reference/targets-matrix/#skills-convergence)). No `command: nix-shell ...` wrapping required.

## Requirements

- Nix with flakes enabled (`experimental-features = nix-command flakes`).
- The consumer's flake registry resolves `nixpkgs` to something usable — true by default on any new-style Nix install.

## Overriding the nixpkgs source

`bin/serve` reads `$NIXPKGS_FLAKE` (default `nixpkgs`). Per-consumer override options:

- **Per process**: set `NIXPKGS_FLAKE=github:NixOS/nixpkgs/<rev>` in the consumer's environment before the MCP client launches the server.
- **System-wide**: `nix registry pin nixpkgs github:NixOS/nixpkgs/<rev>`.
- **Project-local pin**: in the consumer's root `apm.yml`, declare an overriding `mcp:` entry for `chrome-devtools` (root deps win the dedupe — see `apm-cli` `integration/mcp_integrator.py:159-182`). Pass any flake ref as the env var or hardcode args.

## Chrome version compatibility

`bin/serve` pins `chrome-devtools-mcp` to an explicit version. Each chrome-devtools-mcp release transitively pins a Puppeteer release, which expects a specific Chrome-for-Testing milestone. nixpkgs' `playwright-driver.browsers` provides a Chrome that may be a few major versions older than Puppeteer's expectation; CDP is largely backward-compatible, so the core operations (`navigate`, `evaluate`, `take_snapshot`, network/console inspection, screenshots) work, but Lighthouse-driven tooling (`performance_*` insights) is the most version-sensitive piece. If a chrome-devtools-mcp upgrade breaks against your nixpkgs Chrome, bump both ends together — pick a Playwright-driver revision whose Chrome milestone matches Puppeteer's expected version.

## Upgrading

1. `curl -s https://registry.npmjs.org/chrome-devtools-mcp/latest | jq -r .version` to see the current release.
2. Update the pinned version in `bin/serve`.
3. Test against your project's Chrome.
