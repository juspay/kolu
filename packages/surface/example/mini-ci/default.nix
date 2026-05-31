# Nix derivations for the @kolu/surface mini-ci example.
#
# Two tsx-wrapper binaries over the shared surface-example base:
#
#   mini-ci-runner  — the agent. Serves the pipeline surface over stdio. The
#                     base closure bundles the workspace + node_modules, so the
#                     default pipeline's `pnpm --filter …` CI tasks for the
#                     remote-process-monitor example run against it on whatever
#                     host the closure lands on. Needs nodejs + pnpm.
#   mini-ci         — `nix run .#mini-ci [host]`. The TUI. Drives the runner
#                     the drishti way via @kolu/surface-nix-host's HostSession:
#                     `nix copy` the mini-ci-runner closure to the host (skipped
#                     for localhost), realise + run it over ssh. Needs nix +
#                     openssh, and bakes the current system's runner `.drv` as
#                     MINI_CI_RUNNER_DRV (the justfile overrides it per host via
#                     an arch probe — like drishti's KOLU_AGENT_DRV).
#
# Inputs come from the root composer (`default.nix`) — same `src` + `pnpmDeps`
# the kolu build uses, so the pnpm fetch is cached once.
{ pkgs, src, pnpmDeps }:
let
  base = import ../base.nix { inherit pkgs src pnpmDeps; };
  entry = "${base}/packages/surface/example/mini-ci/src";

  # The runner spawns the pipeline's CI tasks (`pnpm --filter …`) and shell
  # commands, so it needs pnpm + nodejs + a shell on PATH.
  mini-ci-runner = pkgs.runCommand "mini-ci-runner"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "mini-ci-runner";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/mini-ci-runner \
      --add-flags "${entry}/runner/main.ts" \
      --prefix PATH : ${pkgs.lib.makeBinPath [
        pkgs.nodejs
        pkgs.pnpm
        pkgs.bash
        pkgs.coreutils
      ]}
  '';

  # The TUI drives HostSession, which shells out to nix (copy / realise) and
  # ssh; the baked drv lets `nix run .#mini-ci` work standalone on localhost.
  mini-ci = pkgs.runCommand "mini-ci"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "mini-ci";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/mini-ci \
      --add-flags "${entry}/tui/main.ts" \
      --set-default MINI_CI_RUNNER_DRV "${mini-ci-runner.drvPath}" \
      --prefix PATH : ${pkgs.lib.makeBinPath [
        pkgs.nodejs
        pkgs.bash
        pkgs.coreutils
        pkgs.openssh
        pkgs.nix
      ]}
  '';
in
{
  inherit mini-ci mini-ci-runner;
}
