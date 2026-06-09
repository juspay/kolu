# Nix derivations for odu (@kolu/odu) — the CI runner that replaced justci
# in this repo. Inputs come from the root composer (default.nix): the same
# workspace `src` + `pnpmDeps` every other derivation uses, so the pnpm
# fetch is cached once.
#
# Two binaries, the mini-ci two-binary pattern:
#   - `odu-runner` — the lane agent. Never invoked by hand: the coordinator
#     `nix copy`s its derivation closure to each lane host, realises it
#     there, and runs it over `ssh <host> odu-runner --stdio`.
#   - `odu` — the coordinator CLI (`nix run .#odu -- run|status|…`). Every
#     lane's runner drvPath — local and cross-arch alike — is resolved at run
#     time via `nix eval <snapshot>#packages.<platform>.odu-runner.drvPath`.
{ pkgs, src, pnpmDeps }:
let
  base = import ../surface/example/base.nix { inherit pkgs src pnpmDeps; };
  entry = "${base}/packages/odu/src";

  odu-runner = pkgs.runCommand "odu-runner"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "odu-runner";
    } ''
    mkdir -p $out/bin
    # PATH carries what CI nodes need before the devshell takes over:
    # `just` runs the recipes ({{ nix_shell }} re-enters the devshell),
    # `git` prepares the per-SHA workspace, `flock` serializes fetches on
    # shared hosts. `nix` is deliberately NOT pinned: the lane host's own
    # nix realised this closure, and a pinned client older than the host
    # daemon corrupts CA-derivation handling ("derivation has incorrect
    # deferred output") — the host that provides the daemon provides the
    # client.
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/odu-runner \
      --add-flags "${entry}/runner/main.ts" \
      --prefix PATH : ${pkgs.lib.makeBinPath [
        pkgs.nodejs
        pkgs.git
        pkgs.just
        pkgs.util-linux
        pkgs.bash
        pkgs.coreutils
      ]}
  '';

  odu = pkgs.runCommand "odu"
    {
      nativeBuildInputs = [ pkgs.makeWrapper ];
      meta.mainProgram = "odu";
    } ''
    mkdir -p $out/bin
    # `gh` posts commit statuses (coordinator-only — lane hosts never see
    # credentials); `ssh` is HostSession's transport; `just` feeds the DAG
    # ingest; `git` the strict gate. `nix` comes from the invoking host (you
    # reached this binary through nix), never pinned — see odu-runner's note.
    makeWrapper ${pkgs.tsx}/bin/tsx $out/bin/odu \
      --add-flags "${entry}/cli/main.ts" \
      --set ODU_GH_BIN "${pkgs.gh}/bin/gh" \
      --prefix PATH : ${pkgs.lib.makeBinPath [
        pkgs.nodejs
        pkgs.git
        pkgs.gh
        pkgs.just
        pkgs.openssh
        pkgs.bash
        pkgs.coreutils
      ]}
  '';
in
{
  inherit odu odu-runner;
}
