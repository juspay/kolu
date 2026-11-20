{ pkgs, lib, ripgrep, procps, agent-distro }:
let
  npmAdapter = import ../npm-adapter.nix { inherit pkgs; };

  adapter = import ../../packages/acp-claude/adapter;

  claudeLauncher = "${agent-distro}/bin/claude";
in
npmAdapter (adapter // {
  name = "kolu-acp-claude";
  env = [
    ''--set CLAUDE_CODE_EXECUTABLE "${claudeLauncher}"''
    "--set DISABLE_AUTOUPDATER 1"
    "--set DISABLE_INSTALLATION_CHECKS 1"
    "--set USE_BUILTIN_RIPGREP 0"
    ''--prefix PATH : "${lib.makeBinPath [ ripgrep procps ]}"''
  ];
})
