# Stable workspace build inputs shared by Kolu and its independently evaluated
# example flakes. Keep these below the app composer: callers need the source and
# dependency closure, not Kolu's wrappers, remote-agent policy, or daemon
# identities.
{ pkgs }:
let
  inherit (pkgs) lib;
  sources = import ../npins;

  # App version — the SINGLE source of truth is packages/server/package.json.
  version = (lib.importJSON ../packages/server/package.json).version;

  # The dependency-closure machinery, owned by @kolu/surface-daemon (location is
  # structure — it is the third piece of the daemon-identity capability, next to
  # the recipe that bakes the id and the TS half that reads it back). kolu is one
  # consumer of it; drishti/odu are the others (juspay/kolu#2096).
  #
  # No `mustCover` — every @kolu member here is LOCAL, so the `workspace:`
  # protocol rule already catches a stale members map; a consumer that reaches
  # the framework tier THROUGH a pin is the one that needs the by-name tripwire.
  #
  # `members` is inherited for THIS file's own `fileset` split below; only
  # `identityInputs` is re-exported (default.nix is the sole consumer, and it
  # takes version/src/fileset/pnpmDeps/identityInputs).
  inherit ((import ../packages/surface-daemon/nix/workspace-closure.nix {
    inherit lib;
  }).mkWorkspaceClosure { members = rawMembers; pinned = pinnedNames; })
    members identityInputs;

  # The members that are PINS, not directories in this repo — spelled ONCE, and
  # read by both things that must agree about it: `mkWorkspaceClosure` (which
  # type-checks each value against the declaration and routes a pin into
  # `identityInputs.pinnedSources` instead of the hashed fileset) and the
  # repo-rooted `fileset` below (which cannot carry a store path, so `src`
  # grafts it in instead).
  #
  # DECLARED, never sniffed from how the value is spelled. Two location tests
  # were tried before this list existed and both were wrong: `lib.isStorePath`
  # holds only for a store ROOT (`/nix/store/<hash>-name`), so a grafted
  # SUBPATH (`…-source/client-ts`) sails through it; and prefix-matching
  # `storeDir` is true for EVERY member once default.nix is re-imported from
  # the assembled agent tree (mkProvenAgentSource) — that tree is itself a
  # store path, so the filter emptied the whole workspace and the agent source
  # lost every package. A declaration does not depend on where the evaluation
  # is rooted; see workspace-closure.nix's doorstep note.
  pinnedNames = [ "osfacts-client" ];

  # Workspace membership: package name → package directory, the ONE Nix-side
  # index of the pnpm workspace. Everything below derives from it — the build
  # `fileset`/`src`, and `identityInputs` (whose walk follows package.json
  # `dependencies` edges by NAME, so it needs the name→dir index to follow an
  # edge into a member's own package.json).
  #
  # INVARIANT: every workspace package with a `typecheck` script must be here.
  # packages/tests is intentionally absent: it has none (and no `name` either).
  #
  # The keys are ASSERTED against each package.json's `name` at eval (in
  # `mkWorkspaceClosure`), so a renamed package or a mis-keyed entry fails every
  # `nix eval` loudly instead of silently orphaning its dependency edges.
  rawMembers = {
    "@kolu/surface" = ../packages/surface;
    "@kolu/surface-map" = ../packages/surface-map;
    "@kolu/surface-mcp" = ../packages/surface-mcp;
    "@kolu/surface-remote" = ../packages/surface-remote;
    "@kolu/surface-app" = ../packages/surface-app;
    "@kolu/surface-daemon" = ../packages/surface-daemon;
    "@kolu/surface-daemon-supervisor" = ../packages/surface-daemon-supervisor;
    "@kolu/solid-pierre" = ../packages/solid-pierre;
    "@kolu/solid-markdown" = ../packages/solid-markdown;
    "@kolu/solid-pwa-install" = ../packages/solid-pwa-install;
    "@kolu/solid-fileview" = ../packages/solid-fileview;
    "@kolu/solid-browser" = ../packages/solid-browser;
    "@kolu/solid-statepip" = ../packages/solid-statepip;
    "kolu-common" = ../packages/common;
    "@kolu/daemon-test-gate" = ../packages/daemon-test-gate;
    "anyagent" = ../packages/integrations/anyagent;
    "anyforge" = ../packages/integrations/anyforge;
    "kolu-claude-code" = ../packages/integrations/claude-code;
    "kolu-codex" = ../packages/integrations/codex;
    "kolu-git" = ../packages/integrations/git;
    "kolu-github" = ../packages/integrations/github;
    "kolu-grok" = ../packages/integrations/grok;
    "kolu-io" = ../packages/integrations/io;
    "kolu-opencode" = ../packages/integrations/opencode;
    "kolu-pty" = ../packages/integrations/pty;
    "nonempty" = ../packages/nonempty;
    "kolu-shared" = ../packages/shared;
    "terminal-themes" = ../packages/terminal-themes;
    "@kolu/theme" = ../packages/theme;
    "memorable-names" = ../packages/memorable-names;
    "@kolu/terminal-vocab" = ../packages/terminal-vocab;
    "@kolu/terminal-protocol" = ../packages/terminal-protocol;
    "kaval" = ../packages/kaval;
    "kaval-tui" = ../packages/kaval-tui;
    "kolu-cli" = ../packages/kolu-cli;
    "kolu-mcp" = ../packages/kolu-mcp;
    "@kolu/padi" = ../packages/padi;
    "padi-tui" = ../packages/padi-tui;
    "@kolu/port-forward" = ../packages/port-forward;
    # NOT a path in this repo: the tool left at OSF5 and its client went with
    # it, so this member is the pinned source in the Nix store — declared in
    # `pinnedNames` above. `treeMembers` keeps it out of the repo-rooted
    # fileset, `src` grafts it into the build tree, and `identityInputs` hands
    # this store path to `mkDaemonIdentity` as a `pinnedSources` entry
    # (juspay/kolu#2094) rather than dropping it.
    "osfacts-client" = sources.osfacts + "/client-ts";
    "kolu-server" = ../packages/server;
    "kolu-client" = ../packages/client;
    "kolu-transcript-core" = ../packages/transcript-core;
    "kolu-transcript-html" = ../packages/transcript-html;
    "@kolu/artifact-sdk" = ../packages/artifact-sdk;
    "@kolu/serve-dir" = ../packages/serve-dir;
    "@kolu/heap-diag" = ../packages/heap-diag;
    "@kolu/detect" = ../packages/detect;
    "@kolu/html-escape" = ../packages/html-escape;
    "@kolu/shell-quote" = ../packages/shell-quote;
    "@kolu/url-shape" = ../packages/url-shape;
    "@kolu/log" = ../packages/log;
    "@kolu/xterm-kit" = ../packages/xterm-kit;
    "@kolu/ghostty-kit" = ../packages/ghostty-kit;
  };
  # Only members that are paths in THIS repo can ride a repo-rooted fileset; the
  # pins are grafted into the build tree by `src` below instead. Split off
  # `members` (not `rawMembers`) so building the source forces the doorstep
  # assertions too — an example flake that only wants `src`/`pnpmDeps` still
  # pays for a mis-keyed or wrongly-typed member at eval, not at runtime.
  treeMembers = removeAttrs members pinnedNames;

  fileset = lib.fileset.unions ([
    ../package.json
    ../pnpm-workspace.yaml
    ../pnpm-lock.yaml
    ../tsconfig.base.json
  ] ++ lib.attrValues treeMembers);
  treeSrc = lib.fileset.toSource {
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
  #
  # Read back out of `members` rather than re-spelling the pin subpath: the
  # graft and the identity's `pinnedSources` must name the SAME bytes, and one
  # binding is how that stays true.
  osfactsClientSrc = members."osfacts-client";
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
    hash = "sha256-DUO3diQJmNfwmmJzINSQ0SxjKB5Ul6r8q4Mlg4SxHUs=";
    fetcherVersion = 3;
  };
in
{
  inherit version src fileset pnpmDeps identityInputs;
}
