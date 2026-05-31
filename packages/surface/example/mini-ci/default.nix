# Nix derivations for the @kolu/surface mini-ci example.
#
# Two tsx-wrapper binaries over the shared surface-example base:
#
#   mini-ci-runner  — `nix run .#mini-ci-runner -- --stdio`. The runner; the
#                     remote mode ships this flake's *source* (git archive)
#                     and runs THIS derivation on the host (which all target
#                     hosts have Nix to build) — the "source, not a closure"
#                     cousin of remote-process-monitor's `nix copy`.
#   mini-ci         — `nix run .#mini-ci`. The TUI; needs git + openssh + nix
#                     on PATH for the `git archive | ssh` source ship and the
#                     remote `nix run`. Local mode spawns the runner via the
#                     injected `MINI_CI_RUNNER` (pnpm/tsx aren't on PATH here).
#
# Inputs come from the root composer (`default.nix`) — same `src` + `pnpmDeps`
# the kolu build uses, so the pnpm fetch is cached once.
{ pkgs, src, pnpmDeps }:
let
  base = import ../base.nix { inherit pkgs src pnpmDeps; };
  entry = "${base}/packages/surface/example/mini-ci/src";

  # The runner spawns task commands via `sh -c`, so coreutils + bash must be
  # on PATH for `echo`/`sleep` and friends to resolve.
  mini-ci-runner = pkgs.runCommand "mini-ci-runner"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "mini-ci-runner";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/mini-ci-runner \
      --add-flags "${entry}/runner/main.ts" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.nodejs pkgs.bash pkgs.coreutils ]}
  '';

  # The TUI shells out to git (archive), ssh (ship + remote run), and nix
  # (remote `nix run`) for remote mode; local mode spawns mini-ci-runner.
  mini-ci = pkgs.runCommand "mini-ci"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "mini-ci";
    } ''
    mkdir -p $out/bin
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/mini-ci \
      --add-flags "${entry}/tui/main.ts" \
      --set MINI_CI_RUNNER "${mini-ci-runner}/bin/mini-ci-runner" \
      --prefix PATH : ${pkgs.lib.makeBinPath [
        pkgs.nodejs
        pkgs.bash
        pkgs.coreutils
        pkgs.git
        pkgs.openssh
        pkgs.nix
      ]}
  '';
in
{
  inherit mini-ci mini-ci-runner;
}
