# Nix derivations for the @kolu/surface remote-process-monitor demo.
#
# Inputs come from the independent Surface-example flake, which reads the
# canonical workspace source and pnpm closure from `nix/workspace.nix`.
#
#   pkgs       — the per-system nixpkgs.
#   src        — the canonical workspace source fileset.
#   pnpmDeps   — the canonical workspace pnpm fetch.
#
# Three derivations land here:
#
#   workspaceTree          — workspace tree + pnpm install. Skips
#                            kolu's vite-bundle + node-gyp; neither is
#                            used by surface examples' agents.
#   processMonitorAgent    — `nix run ..#process-monitor-agent --
#                            --stdio`. Backed by workspaceTree.
#   processMonitorClient   — vite-built browser bundle for the demo.
#   processMonitorMonitor  — single-binary entrypoint: serves the
#                            client bundle + spawns the agent via ssh.
#                            Bakes the independent example flake as the
#                            exact agent source; Surface Remote selects
#                            the target system's package.
{
  pkgs,
  src,
  pnpmDeps,
  agentFlakeRef,
  agentFlakeRefEnv,
}:
let
  # Shared "workspace tree + pnpm install, tsx-runnable" base — also used by
  # the mini-ci example. See ../../../../nix/workspace-tree.nix.
  workspaceTree = import ../../../../nix/workspace-tree.nix { inherit pkgs src pnpmDeps; };

  processMonitorAgent = pkgs.runCommand "process-monitor-agent"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "process-monitor-agent";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/process-monitor-agent \
      --add-flags "${workspaceTree}/packages/surface/example/remote-process-monitor/src/agent/main.ts" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs ]}
  '';
  processMonitorClient = pkgs.stdenv.mkDerivation {
    pname = "process-monitor-client";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [ pkgs.nodejs pkgs.pnpm-build pkgs.pnpmConfigHook ];
    inherit pnpmDeps;
    dontFixup = true;
    buildPhase = ''
      runHook preBuild
      pnpm --filter @kolu/surface-example-remote-process-monitor build:client
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      cp -r packages/surface/example/remote-process-monitor/dist $out
      runHook postInstall
    '';
  };

  processMonitorMonitor = pkgs.runCommand "process-monitor-monitor"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "process-monitor-monitor";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/process-monitor-monitor \
      --add-flags "${workspaceTree}/packages/surface/example/remote-process-monitor/src/server/main.ts" \
      --set-default HOST localhost \
      --set-default PORT 7720 \
      --set KOLU_SURFACE_EXAMPLE_DIST "${processMonitorClient}" \
      --set ${agentFlakeRefEnv} "${agentFlakeRef}" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.openssh pkgs.nix ]}
  '';
in
{
  process-monitor-agent = processMonitorAgent;
  process-monitor-monitor = processMonitorMonitor;
}
