# chrome-devtools-mcp-nix (example)

Staging-ground example of a **reusable Nix flake** that runs
[`chrome-devtools-mcp`](https://www.npmjs.com/package/chrome-devtools-mcp)
as a stdio MCP server. Consumers point their Claude Code `.mcp.json` at
`nix run`; the flake provides a pinned `npx` invocation with `nodejs` in
the closure.

This lives inside the kolu repo so the shape can be iterated on before
being extracted to its own repo (e.g. `github:srid/chrome-devtools-mcp-nix`).

## Design

One concern per boundary (volatility-based decomposition, Parnas/Lowy):

| Concern                                            | Owner            |
| -------------------------------------------------- | ---------------- |
| Launch `chrome-devtools-mcp` with a pinned version | **this flake**   |
| Provide a Chrome binary at `--executable-path`     | **the consumer** |

Chrome provisioning is deliberately _not_ bundled — different consumers
have different answers (Playwright browsers, system Chrome, a container,
a devshell-provided binary). Bundling any one of them would leak a
project-specific choice into a shared interface. The flake forwards all
CLI arguments to `chrome-devtools-mcp`, so the consumer passes
`--executable-path=...` directly.

`@latest` is also avoided on purpose. The version is pinned in
`flake.nix` (`mcpVersion`) so consumers inherit a tested combination;
bump deliberately rather than drifting on every invocation.

## Consumer usage

### `.mcp.json`

Simplest form — consumer already has Chrome on `$PATH`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "nix",
      "args": [
        "run",
        "github:srid/chrome-devtools-mcp-nix",
        "--",
        "--headless=true",
        "--isolated=true"
      ]
    }
  }
}
```

With a custom Chrome binary:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "nix",
      "args": [
        "run",
        "github:srid/chrome-devtools-mcp-nix",
        "--",
        "--headless=true",
        "--isolated=true",
        "--executable-path=/opt/chrome/chrome"
      ]
    }
  }
}
```

### With a resolver (Playwright-style, like kolu)

When the Chrome path isn't fixed (e.g. Playwright's Chrome-for-Testing,
whose path varies per platform and nixpkgs revision), wrap the `nix run`
in a shell that resolves the binary first. Kolu does this in
`agents/ai.just:83-89`: finds `chrome-linux64/chrome` or
`chrome-mac-*/Google Chrome for Testing.app/...` under
`$PLAYWRIGHT_BROWSERS_PATH`, then execs the MCP with
`--executable-path="$chrome"`. Same pattern, just substitute
`nix run github:srid/chrome-devtools-mcp-nix --` for the `npx` call.

## Running locally from this checkout

```sh
nix run ./examples/chrome-devtools-mcp-nix -- --help
```

## Bumping the pinned version

Edit `mcpVersion` in `flake.nix`. CI should run smoke tests against the
new version before merging.

## When this moves to its own repo

Once extracted, the consumer's `.mcp.json` stanza becomes the final
form shown above. Nothing changes about the interface — which is the
point of putting the boundary here.

Deferred items to wire up in the extracted repo:

- **CI smoke-test** on the pinned version — `nix run . -- --help` (or a
  non-interactive equivalent) so a bad `mcpVersion` bump fails CI
  instead of a consumer's `nix run`.
- **Offline / hermetic fetch strategy** — the wrapper currently relies
  on `npx -y` hitting npm at runtime. For air-gapped or strict-hermetic
  Nix consumers, a `buildNpmPackage`/`fetchurl`-based offline bundle
  would be a third volatility axis (npm-fetch strategy) separable from
  version pinning and binary provisioning.

APM ([microsoft/apm#655](https://github.com/microsoft/apm/pull/655))
will eventually let an APM package declare the MCP stanza and have
`apm install` render it into the consumer's `.mcp.json`. That solves
config distribution; this flake solves binary provisioning. Both layers
are needed and orthogonal.
