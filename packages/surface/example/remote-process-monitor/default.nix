# Nix derivations for the @kolu/surface remote-process-monitor demo.
#
# Inputs come from the root composer (`default.nix`) so this file can
# reuse the workspace's pnpm fetch (~395 MB; one source of truth) and
# the same `src` fileset the kolu build uses.
#
#   pkgs       — the per-system nixpkgs.
#   src        — the workspace source fileset (root default.nix's `src`).
#   pnpmDeps   — the workspace pnpm fetch (root default.nix's `pnpmDeps`).
#
# Three derivations land here:
#
#   surfaceExampleBase     — workspace tree + pnpm install. Skips
#                            kolu's vite-bundle + node-gyp; neither is
#                            used by surface examples' agents.
#   processMonitorAgent    — `nix run .#process-monitor-agent --
#                            --stdio`. Backed by surfaceExampleBase.
#   processMonitorClient   — vite-built browser bundle for the demo.
#   processMonitorMonitor  — single-binary entrypoint: serves the
#                            client bundle + spawns the agent via ssh.
#                            Bakes `KOLU_AGENT_DRV` to the agent's .drv
#                            for the current system (override the env
#                            var for cross-arch remotes).
{ pkgs, src, pnpmDeps }:
let
  surfaceExampleBase = pkgs.stdenv.mkDerivation {
    pname = "surface-example-base";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [ pkgs.nodejs pkgs.pnpm pkgs.pnpmConfigHook ];
    inherit pnpmDeps;
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      runHook preInstall
      cp -r . $out
      runHook postInstall
    '';
  };

  processMonitorAgent = pkgs.runCommand "process-monitor-agent"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "process-monitor-agent";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/process-monitor-agent \
      --add-flags "${surfaceExampleBase}/packages/surface/example/remote-process-monitor/src/agent/main.ts" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs ]}
  '';

  processMonitorClient = pkgs.stdenv.mkDerivation {
    pname = "process-monitor-client";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [ pkgs.nodejs pkgs.pnpm pkgs.pnpmConfigHook ];
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
      --add-flags "${surfaceExampleBase}/packages/surface/example/remote-process-monitor/src/server/main.ts" \
      --set-default HOST localhost \
      --set-default PORT 7720 \
      --set KOLU_SURFACE_EXAMPLE_DIST "${processMonitorClient}" \
      --set-default KOLU_AGENT_DRV "${processMonitorAgent.drvPath}" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.openssh pkgs.nix ]}
  '';
in
{
  process-monitor-agent = processMonitorAgent;
  process-monitor-monitor = processMonitorMonitor;
}
