# Stable workspace build inputs shared by Kolu and its independently evaluated
# example flakes. Keep these below the app composer: callers need the source and
# dependency closure, not Kolu's wrappers, remote-agent policy, or daemon
# identities.
{ pkgs }:
let
  inherit (pkgs) lib;

  # App version — the SINGLE source of truth is packages/server/package.json.
  version = (lib.importJSON ../packages/server/package.json).version;

  # Workspace membership: package name → package directory, the ONE Nix-side
  # index of the pnpm workspace. Everything below derives from it — the build
  # `fileset`/`src`, and `depClosure` (which walks package.json `dependencies`
  # edges by NAME, so it needs the name→dir index to follow an edge into a
  # member's own package.json).
  #
  # INVARIANT: every workspace package with a `typecheck` script must be here.
  # packages/tests is intentionally absent: it has none (and no `name` either).
  #
  # The keys are ASSERTED against each package.json's `name` at eval (below), so
  # a renamed package or a mis-keyed entry fails every `nix eval` loudly instead
  # of silently orphaning its dependency edges.
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
    # Outside packages/ — lives under osfacts/ so it leaves with the tool at OSF5.
    "osfacts-client" = ../osfacts/client-ts;
    "vazhi" = ../packages/vazhi;
    "kolu-server" = ../packages/server;
    "kolu-client" = ../packages/client;
    "kolu-transcript-core" = ../packages/transcript-core;
    "kolu-transcript-html" = ../packages/transcript-html;
    "@kolu/artifact-sdk" = ../packages/artifact-sdk;
    "@kolu/serve-dir" = ../packages/serve-dir;
    "@kolu/heap-diag" = ../packages/heap-diag;
    "@kolu/html-escape" = ../packages/html-escape;
    "@kolu/shell-quote" = ../packages/shell-quote;
    "@kolu/url-shape" = ../packages/url-shape;
    "@kolu/log" = ../packages/log;
    "@kolu/xterm-kit" = ../packages/xterm-kit;
  };
  members = lib.foldl'
    (acc: name:
      let actual = (lib.importJSON (rawMembers.${name} + "/package.json")).name or null;
      in
      assert lib.assertMsg (actual == name)
        "workspace.nix: members key '${name}' does not match package.json name '${toString actual}' at ${toString rawMembers.${name}}";
      acc)
    rawMembers
    (lib.attrNames rawMembers);

  # The transitive closure of `entries` over package.json `dependencies` edges
  # that use the `workspace:` protocol — the SAME edges pnpm's isolated
  # node_modules makes the only resolvable ones at runtime, so "what code can
  # this package load" is answered by the manifests, not by a hand-kept list.
  # devDependencies are deliberately NOT followed: they never ship behaviour
  # (the dependency-edge guard tests enforce that no runtime import rides one).
  # An edge to a package missing from `members` fails loudly.
  #
  # `stop` names packages the walk treats as OPAQUE LEAVES: each is excluded
  # from the result together with everything reachable ONLY through it (a
  # daemon that deliberately keys currency on a slice excludes a leaf's whole
  # subtree, not just its top — see default.nix's stableLeaves). Every `stop`
  # entry must actually be in the un-stopped closure, so a stale or mistyped
  # leaf fails eval loudly instead of silently naming nothing.
  depClosure = { entries, stop ? [ ] }:
    let
      wsDepsOf = name:
        let
          dir = members.${name} or (throw
            "workspace.nix depClosure: '${name}' is not a workspace member — add it to `members`");
          deps = (lib.importJSON (dir + "/package.json")).dependencies or { };
        in
        lib.attrNames (lib.filterAttrs (_: v: lib.hasPrefix "workspace:" v) deps);
      walk = stopped: map (x: x.key) (builtins.genericClosure {
        startSet = map (n: { key = n; }) entries;
        operator = x:
          if lib.elem x.key stopped then [ ]
          else map (n: { key = n; }) (wsDepsOf x.key);
      });
      full = walk [ ];
      stale = lib.subtractLists full stop;
    in
    assert lib.assertMsg (stale == [ ])
      "workspace.nix depClosure: stop entries not in the dependency closure of ${toString entries} (stale or mistyped): ${toString stale}";
    lib.naturalSort (lib.subtractLists stop (walk stop));

  fileset = lib.fileset.unions ([
    ../package.json
    ../pnpm-workspace.yaml
    ../pnpm-lock.yaml
    ../tsconfig.base.json
  ] ++ lib.attrValues members);
  src = lib.fileset.toSource {
    root = ../.;
    inherit fileset;
  };

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
  inherit version src fileset pnpmDeps members depClosure;
}
