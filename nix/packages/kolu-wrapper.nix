# Runtime wrapper that launches kolu with all env vars set.
{ pkgs, koluStamped, koluEnv }:
pkgs.writeShellApplication {
  name = "kolu";
  runtimeInputs = [ pkgs.nodejs pkgs.tsx pkgs.git pkgs.gh ];
  text = ''
    export KOLU_CLIENT_DIST="${koluStamped}/client/dist"
    export KOLU_CLIPBOARD_SHIM_DIR="${koluEnv.KOLU_CLIPBOARD_SHIM_DIR}"
    export KOLU_RANDOM_WORDS="${koluEnv.KOLU_RANDOM_WORDS}"
    exec tsx "${koluStamped}/server/src/index.ts" "$@"
  '';
}
