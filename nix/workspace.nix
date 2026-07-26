# Stable workspace build inputs shared by Kolu and its independently evaluated
# example flakes. Keep these below the app composer: callers need the source and
# dependency closure, not Kolu's wrappers, remote-agent policy, or daemon
# identities.
{ pkgs }:
let
  # App version — the SINGLE source of truth is packages/server/package.json.
  version = (pkgs.lib.importJSON ../packages/server/package.json).version;

  # INVARIANT: this fileset must include every workspace package that has a
  # `typecheck` script. packages/tests is intentionally absent: it has none.
  # Exported as `fileset` so the agent-source assemble (surface-daemon
  # mkProvenAgentSource) can union the same package set with the Nix/npins
  # machinery without re-listing every package.
  fileset = pkgs.lib.fileset.unions [
    ../package.json
    ../pnpm-workspace.yaml
    ../pnpm-lock.yaml
    ../tsconfig.base.json
    ../packages/surface
    ../packages/surface-map
    ../packages/surface-mcp
    ../packages/surface-remote
    ../packages/surface-app
    ../packages/surface-daemon
    ../packages/surface-daemon-supervisor
    ../packages/solid-pierre
    ../packages/solid-markdown
    ../packages/solid-pwa-install
    ../packages/solid-fileview
    ../packages/solid-browser
    ../packages/solid-statepip
    ../packages/common
    ../packages/daemon-test-gate
    ../packages/integrations
    ../packages/nonempty
    ../packages/shared
    ../packages/terminal-themes
    ../packages/theme
    ../packages/memorable-names
    ../packages/terminal-vocab
    ../packages/terminal-protocol
    ../packages/kaval
    ../packages/kaval-tui
    ../packages/kolu-cli
    ../packages/kolu-mcp
    ../packages/padi
    ../packages/padi-tui
    ../packages/port-forward
    ../packages/port-scan
    ../packages/vazhi
    ../packages/server
    ../packages/client
    ../packages/transcript-core
    ../packages/transcript-html
    ../packages/artifact-sdk
    ../packages/serve-dir
    ../packages/heap-diag
    ../packages/html-escape
    ../packages/shell-quote
    ../packages/url-shape
    ../packages/log
    ../packages/xterm-kit
  ];
  src = pkgs.lib.fileset.toSource {
    root = ../.;
    inherit fileset;
  };

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu";
    inherit version src;
    # Pin the package-manager major: nixpkgs' unversioned pnpm alias advances
    # independently, while this workspace and lockfile use pnpm 10 semantics.
    pnpm = pkgs.pnpm_10;
    # Platform-independent. `just ci::pnpm-hash-fresh` forces this fetcher to
    # re-execute so a changed lockfile cannot ride a stale binary-cache result.
    hash = "sha256-e0bxLIKWHjsQovUtK6ROA89MZgttm6xrWjnkuTAOaFw=";
    fetcherVersion = 3;
  };
in
{
  inherit version src fileset pnpmDeps;
}
