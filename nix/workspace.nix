{ pkgs }:
let
  inherit (pkgs) lib;
  sources = import ../npins;

  version = (lib.importJSON ../packages/server/package.json).version;

  inherit ((import ../packages/surface-daemon/nix/workspace-closure.nix {
    inherit lib;
  }).mkWorkspaceClosure { members = rawMembers; pinned = pinnedNames; })
    members identityInputs depClosure;

  pinnedPins = {
    "osfacts-client" = "osfacts";
    "@odu/service-client" = "odu";
    "@odu/run-client" = "odu";
    "@odu/run-history" = "odu";
    "@juspay/agent-distro" = "agent-distro";
  };
  pinnedNames = builtins.attrNames pinnedPins;

  graftPath =
    member:
    let
      scoped = builtins.match "@([^/]+)/(.+)" member;
    in
    if scoped == null then member else "${builtins.elemAt scoped 0}/${builtins.elemAt scoped 1}";

  rawMembers = {
    "@kolu/acp" = ../packages/acp;
    "@kolu/acp-harness" = ../packages/acp-harness;
    "@kolu/acp-claude" = ../packages/acp-claude;
    "@kolu/acp-client" = ../packages/acp-client;
    "@kolu/child" = ../packages/child;
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
    "@kolu/solid-logtail" = ../packages/solid-logtail;
    "kolu-common" = ../packages/common;
    "@kolu/daemon-test-gate" = ../packages/daemon-test-gate;
    "anyagent" = ../packages/integrations/anyagent;
    "anyforge" = ../packages/integrations/anyforge;
    "kolu-agents" = ../packages/integrations/agents;
    "kolu-claude-code" = ../packages/integrations/claude-code;
    "kolu-codex" = ../packages/integrations/codex;
    "kolu-git" = ../packages/integrations/git;
    "kolu-github" = ../packages/integrations/github;
    "kolu-grok" = ../packages/integrations/grok;
    "kolu-io" = ../packages/integrations/io;
    "kolu-omp" = ../packages/integrations/omp;
    "kolu-opencode" = ../packages/integrations/opencode;
    "kolu-pi" = ../packages/integrations/pi;
    "kolu-pty" = ../packages/integrations/pty;
    "kolu-xyne" = ../packages/integrations/xyne;
    "@kolu/byte-units" = ../packages/byte-units;
    "nonempty" = ../packages/nonempty;
    "kolu-shared" = ../packages/shared;
    "terminal-snapshot" = ../packages/terminal-snapshot;
    "terminal-themes" = ../packages/terminal-themes;
    "@kolu/theme" = ../packages/theme;
    "memorable-names" = ../packages/memorable-names;
    "@kolu/terminal-vocab" = ../packages/terminal-vocab;
    "@kolu/agent-distro" = ../packages/agent-distro;
    "@kolu/terminal-protocol" = ../packages/terminal-protocol;
    "kaval" = ../packages/kaval;
    "kaval-tui" = ../packages/kaval-tui;
    "kolu-cli" = ../packages/kolu-cli;
    "kolu-conductor" = ../packages/conductor;
    "kolu-work" = ../packages/work;
    "kolu-mcp" = ../packages/kolu-mcp;
    "@kolu/padi" = ../packages/padi;
    "@kolu/padi-client" = ../packages/padi-client;
    "padi-tui" = ../packages/padi-tui;
    "@kolu/port-forward" = ../packages/port-forward;
    "osfacts-client" = sources.osfacts + "/client-ts";
    "@odu/service-client" = sources.odu + "/packages/service-client";
    "@odu/run-client" = sources.odu + "/packages/run-client";
    "@odu/run-history" = sources.odu + "/packages/run-history";
    "@juspay/agent-distro" = sources.agent-distro + "/src";
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
  pinnedProvenance = lib.mapAttrs
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
    ../skills
  ] ++ lib.attrValues treeMembers);
  treeSrc = lib.fileset.toSource {
    root = ../.;
    inherit fileset;
  };

  graftedMembers = lib.mapAttrsToList
    (member: _: { dest = graftPath member; src = members.${member}; })
    pinnedPins;
  src = pkgs.runCommand "kolu-source" { } (
    ''
      cp -r ${treeSrc} $out
      chmod -R u+w $out
    ''
    + lib.concatMapStrings
      (m: ''
        mkdir -p "$out/$(dirname ${m.dest})"
        cp -r ${m.src} "$out/${m.dest}"
        chmod -R u+w "$out/${m.dest}"
      '')
      graftedMembers
  );

  manifestOnlyFileset = lib.fileset.unions ([
    ../package.json
    ../pnpm-workspace.yaml
    ../pnpm-lock.yaml
  ] ++ lib.mapAttrsToList
    (_: dir: lib.fileset.fileFilter (f: f.name == "package.json") dir)
    treeMembers);
  depsTreeSrc = lib.fileset.toSource {
    root = ../.;
    fileset = manifestOnlyFileset;
  };
  depsSrc = pkgs.runCommand "kolu-deps-source" { } (
    ''
      cp -r ${depsTreeSrc} $out
      chmod -R u+w $out
    ''
    + lib.concatMapStrings
      (m: ''
        mkdir -p "$out/${m.dest}"
        cp ${m.src}/package.json "$out/${m.dest}/package.json"
      '')
      graftedMembers
  );

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "kolu";
    inherit version src;
    pnpm = pkgs.pnpm-build;
    hash = "sha256-togmfB1cdPRQ8lNs9F68wvdvfdmjOkooNTAp4tvV+zA=";
    fetcherVersion = 3;
  };
in
{
  inherit version src depsSrc fileset pnpmDeps identityInputs;

  closureNamesFor = entries: depClosure { inherit entries; };

  inherit pinnedProvenance;
}
