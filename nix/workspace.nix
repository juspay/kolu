# Stable workspace build inputs shared by Kolu and its independently evaluated
# example flakes. Keep these below the app composer: callers need the source and
# dependency closure, not Kolu's wrappers, remote-agent policy, or daemon
# identities.
{ pkgs }:
let
  sources = import ../npins;

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
  treeSrc = pkgs.lib.fileset.toSource {
    root = ../.;
    inherit fileset;
  };

  # osfacts-client, materialized from the npins pin — NEVER committed.
  #
  # The tool left the tree at OSF5 (juspay/osfacts) and its TypeScript client
  # went with it, but five kolu packages import `osfacts-client` by name and a
  # pnpm workspace member must be a path inside the repo. The two ways to close
  # that without a second copy of the source both failed on their own terms: a
  # registry/tarball dependency needs a publish step nobody wants to own, and
  # pnpm's git-subdirectory dependency silently DROPS its `#path:` fragment
  # under `pnpm fetch` + `--offline` (kolu's hermetic install), landing the whole
  # osfacts repo in node_modules with no package.json at its root.
  #
  # So Nix supplies the source, which it already has: npins pins the repo, and
  # this grafts `client-ts/` into the build tree as an ordinary workspace member.
  # pnpm then sees a plain `workspace:*` link with nothing to download — offline
  # by construction. `just install` performs the same graft for a working tree
  # (see the justfile's `_materialize-osfacts-client`), so both paths read the
  # same pinned bytes and neither has a checked-in copy to drift from.
  osfactsClientSrc = sources.osfacts + "/client-ts";
  src = pkgs.runCommand "kolu-source" { } ''
    cp -r ${treeSrc} $out
    chmod -R u+w $out
    cp -r ${osfactsClientSrc} $out/osfacts-client
    chmod -R u+w $out/osfacts-client
  '';

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu";
    inherit version src;
    # The wrapped builder pnpm (nix/pnpm.nix): pins the package-manager major
    # — nixpkgs' unversioned pnpm alias advances independently, while this
    # workspace and lockfile use pnpm 10 semantics — and gives this fetcher's
    # `pnpm install` a reporter whose output survives into `nix log`.
    pnpm = pkgs.pnpm-build;
    # Platform-independent. `just ci::pnpm-hash-fresh` forces this fetcher to
    # re-execute so a changed lockfile cannot ride a stale binary-cache result.
    hash = "sha256-6ZsOfkDzEBwnPmAiquwWm8K5C8uKZgQFRsHoyPilXrs=";
    fetcherVersion = 3;
  };
in
{
  inherit version src fileset pnpmDeps osfactsClientSrc;
}
