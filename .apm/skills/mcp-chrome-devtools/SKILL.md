---
name: mcp-chrome-devtools
description: Launch chrome-devtools-mcp from a Nix devshell, sharing Playwright's bundled Chrome-for-Testing. Ships an executable launcher (bin/serve) keyed off $PLAYWRIGHT_BROWSERS_PATH plus an opt-in shell.nix for projects that don't already have Playwright in their devshell.
user-invocable: false
---

# chrome-devtools-mcp launcher

Drop-in artifacts for declaring [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) as an MCP server in any Nix-using project.

## Files

| Path | Purpose |
|---|---|
| `bin/serve` | Resolves Chrome under `$PLAYWRIGHT_BROWSERS_PATH` (Linux + macOS layouts) and execs `npx -y chrome-devtools-mcp@<version>`. Reads only the env var — no Nix logic. |
| `shell.nix` | Optional convenience devshell that pins Playwright's Chrome-for-Testing. Override `pkgs` to use your own nixpkgs revision. |

The seam between them is `$PLAYWRIGHT_BROWSERS_PATH`. Any shell that sets the env var can drive `bin/serve` — including a project's existing e2e devshell, in which case `shell.nix` is unused.

## Usage A — reuse an existing Playwright devshell (zero duplication)

If your project already has a devshell that sets `PLAYWRIGHT_BROWSERS_PATH` (e.g. `nix develop .#e2e`), point your MCP config at `bin/serve` directly:

```yaml
# apm.yml
dependencies:
  mcp:
    - name: chrome-devtools
      transport: stdio
      command: nix
      args:
        - develop
        - .#e2e
        - --command
        - .agents/skills/mcp-chrome-devtools/bin/serve
```

No second Chrome in the Nix store; the e2e suite and MCP server share one binary.

## Usage B — use the bundled shell.nix (fresh projects)

If your project does not have Playwright wired into Nix yet:

```yaml
# apm.yml
dependencies:
  mcp:
    - name: chrome-devtools
      transport: stdio
      command: nix-shell
      args:
        - .agents/skills/mcp-chrome-devtools/shell.nix
        - --run
        - .agents/skills/mcp-chrome-devtools/bin/serve
```

To override the bundled nixpkgs pin, edit `shell.nix` to import your project's nixpkgs.

## Chrome version compatibility

`bin/serve` pins `chrome-devtools-mcp` to an explicit version. Each chrome-devtools-mcp release transitively pins a Puppeteer release, which expects a specific Chrome-for-Testing milestone. nixpkgs' `playwright-driver.browsers` provides a Chrome that may be a few major versions older than Puppeteer's expectation; CDP is largely backward-compatible, so the core operations (`navigate`, `evaluate`, `take_snapshot`, network/console inspection, screenshots) work, but Lighthouse-driven tooling (`performance_*` insights) is the most version-sensitive piece. If a chrome-devtools-mcp upgrade breaks against your nixpkgs Chrome, bump both ends together — pick a Playwright-driver revision whose Chrome milestone matches Puppeteer's expected version.

## Upgrading

1. `curl -s https://registry.npmjs.org/chrome-devtools-mcp/latest | jq -r .version` to see the current release.
2. Update the pinned version in `bin/serve`.
3. Test against your project's Chrome — start the MCP server, exercise the tools that matter to you.
