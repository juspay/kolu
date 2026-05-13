# mcp-chrome-devtools

A drop-in launcher for the [Chrome DevTools MCP server](https://github.com/ChromeDevTools/chrome-devtools-mcp), packaged for [APM](https://microsoft.github.io/apm/).

`bin/serve` resolves Playwright's bundled Chrome-for-Testing and Node.js directly through Nix — no `shell.nix`, no `flake.nix`, no `nix-shell` wrapper. Self-contained: one bash file, one apm.yml entry. Override the `nixpkgs` source per consumer via the `NIXPKGS_FLAKE` env var or the flake registry.

## Usage

Add as a local-path APM dependency:

```yaml
# your-project/apm.yml
dependencies:
  apm:
    - ./mcp-chrome-devtools
```

`apm install` aggregates the MCP entry from this package's `apm.yml` into your runtime configs (`.mcp.json`, `.codex/config.toml`, `opencode.json`).

## Requirements

Nix with flakes enabled (`experimental-features = nix-command flakes`).

## Details

See [`.apm/skills/mcp-chrome-devtools/SKILL.md`](./.apm/skills/mcp-chrome-devtools/SKILL.md) for the override mechanisms, the Chrome ⇔ Puppeteer version-drift caveat, and the upgrade procedure.
