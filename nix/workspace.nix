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
    members identityInputs depClosure;

  # The members that are PINS, not directories in this repo — spelled ONCE, and
  # read by both things that must agree about it: `mkWorkspaceClosure` (which
  # type-checks each value against the declaration and routes a pin into
  # `identityInputs.pinnedSources` instead of the hashed fileset) and the
  # repo-rooted `fileset` below (which cannot carry a store path, so `src`
  # grafts it in instead).
  #
  # It is a MAPPING rather than a list because the name → PIN is the one fact
  # about a pinned member that nothing can derive. By the time anything reads
  # `members."osfacts-client"` it is already a plain store-path STRING —
  # `sources.osfacts + "/client-ts"` coerces the attrset away — and a store path
  # carries neither a revision nor the name of the pin it came from. Everything
  # else IS derivable and is derived below, so this stays a mapping and never
  # grows into a second hand-kept list.
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
  pinnedPins = { "osfacts-client" = "osfacts"; };
  pinnedNames = builtins.attrNames pinnedPins;

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
    "@kolu/surface-cli" = ../packages/surface-cli;
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
    "@kolu/solid-dockrow" = ../packages/solid-dockrow;
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
    "kolu-pi" = ../packages/integrations/pi;
    "kolu-pty" = ../packages/integrations/pty;
    "nonempty" = ../packages/nonempty;
    "kolu-shared" = ../packages/shared;
    "terminal-snapshot" = ../packages/terminal-snapshot;
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
    "@kolu/padi-client" = ../packages/padi-client;
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
  };
  # Only members that are paths in THIS repo can ride a repo-rooted fileset; the
  # pins are grafted into the build tree by `src` below instead. Split off
  # `members` (not `rawMembers`) so building the source forces the doorstep
  # assertions too — an example flake that only wants `src`/`pnpmDeps` still
  # pays for a mis-keyed or wrongly-typed member at eval, not at runtime.
  # member → { name = <npins pin>; revision; subdir } for every pinned member.
  #
  # WHY A CONSUMER NEEDS IT. A pinned member is absent from the archive a
  # consumer fetches, so the consumer grafts it from ITS OWN pin — and then
  # compiles the result against packages copied from KOLU's. Two revisions of one
  # package in one `tsc`, and nothing holding them together: it typechecks right
  # up until a field moves. Consumers have been holding that pairing by hand,
  # one 63-line shell script per repo, each re-deriving kolu's revision by
  # jq-ing kolu's INTERNAL `npins/sources.json` — a file layout kolu never
  # promised to keep. The revision is a fact this tree knows, so it is emitted
  # into `consumer-closure.json` and checked at eval by `nix/consumer.nix`.
  #
  # READ BACK out of `members` and `sources` rather than re-spelled, so the graft
  # that supplies the BYTES and the revision a consumer is checked against can
  # never name two different things. `members`, not `rawMembers`: the doorstep in
  # `mkWorkspaceClosure` has already asserted this value is a string under the
  # store — the path-literal mistake its own note records — so the only thing
  # left for the assert below to say is the one thing it can say, "wrong pin".
  pinnedMembers = lib.mapAttrs
    (member: pin:
      let
        root = "${sources.${pin}}";
        dir = members.${member};
      in
      assert lib.assertMsg (lib.hasPrefix "${root}/" dir) ''
        nix/workspace.nix: member '${member}' is declared in `pinnedPins` as coming from
        the `${pin}` pin, but its path '${dir}' is not under that pin's store path
        '${root}'. A pinned member's directory must be a subpath of the pin it names —
        otherwise the `subdir` every consumer is told to graft would be a lie.
      '';
      {
        name = pin;
        inherit (sources.${pin}) revision;
        subdir = lib.removePrefix "${root}/" dir;
      })
    pinnedPins;

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
    hash = "sha256-F4s7sGRl7eTAHNP835wQTqohGuPZkjqC7XmvPl71g+I=";
    fetcherVersion = 3;
  };
in
{
  inherit version src fileset pnpmDeps identityInputs;

  # The manifest walk itself, answered by name. `depClosure` has a TS mirror —
  # `declaredDependencyClosure` in `@kolu/daemon-test-gate` — and one walk
  # spelled in two languages is one walk that drifts: the nix answer decides
  # daemon IDENTITY (a member missed here ships a rebuilt daemon under an
  # unchanged id) while the TS answer decides what a vendoring consumer pays
  # for, so a silent disagreement is wrong in both directions and visible in
  # neither. Exposing it lets `packages/tests/governance/closureWalk.ts` ask
  # both sides the same question and fail when they answer differently.
  closureNamesFor = entries: depClosure { inherit entries; };

  # The pin-grafted members, exposed for the same reason `closureNamesFor` is:
  # a TS reader needs this declaration, and the alternative was regex-parsing
  # this file's bytes. `packages/tests/governance/consumerClosure.ts` asks for
  # it through the `nix eval` route `closureWalk.ts` already uses, so the
  # declaration has one reader-facing spelling and a rename cannot silently
  # change what the emitter believes.
  #
  # `pinnedMembers` carries the PROVENANCE the emitter cannot see: which pin, at
  # which revision, from which subdirectory. A consumer is checked against that
  # revision at eval (`nix/consumer.nix`), which is what retires the per-consumer
  # shell script that used to hold the two pins in step.
  inherit pinnedNames pinnedMembers;
}
