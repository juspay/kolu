# Nix derivations for the @kolu/surface mini-ci example.
#
# Two tsx-wrapper binaries over the shared surface-example base:
#
#   mini-ci-runner  — the agent. Serves the pipeline surface over stdio. The
#                     base closure bundles the workspace + node_modules, so the
#                     default pipeline's `pnpm --filter …` CI tasks for the
#                     remote-process-monitor example run against it on whatever
#                     host the closure lands on. Needs nodejs + pnpm.
#   mini-ci         — `nix run ..#mini-ci [host]`. The TUI. Drives the runner
#                     via @kolu/surface-remote: a remote-store Nix build owns
#                     evaluation, transfer, and realisation, then the rooted
#                     result runs over ssh. Needs nix + openssh. The wrapper
#                     bakes the independent example flake as the exact source;
#                     Surface Remote selects the target system's runner.
#
# Inputs come from the independent Surface-example flake. It reuses the
# canonical `src` + `pnpmDeps` from `nix/workspace.nix`.
{
  pkgs,
  src,
  pnpmDeps,
  agentFlakeRef,
  agentFlakeRefEnv,
}:
let
  base = import ../../../../nix/workspace-tree.nix { inherit pkgs src pnpmDeps; };
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
  # The TUI drives makeSession + sshConnector, which shell out to Nix and
  # ssh; the baked source ref lets the example flake's `mini-ci` run standalone.
  mini-ci = pkgs.runCommand "mini-ci"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "mini-ci";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/mini-ci \
      --add-flags "${entry}/tui/main.ts" \
      --set ${agentFlakeRefEnv} "${agentFlakeRef}" \
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
