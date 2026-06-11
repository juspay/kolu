/**
 * Promote two server flags into the environment **before** any module that
 * resolves or spawns the pty-host daemon reads them.
 *
 * `ptyHost.ts` connects to (and may spawn) the daemon at import time (top-level
 * await), which runs during the import phase — before `index.ts`'s body parses
 * argv with cleye. So the values have to already be in the environment when the
 * daemon-spawning module reads them. The server calls this explicitly at the top
 * of `ptyHost.ts`, before it reads `KOLU_PTY_HOST_SOCKET`:
 *   - `--pty-host-socket`  → `KOLU_PTY_HOST_SOCKET` (which socket to bind/dial).
 *   - `--allow-nix-shell-with-env-whitelist` → `KOLU_NIX_ENV_WHITELIST` so the
 *     daemon (a separate process that now owns shell-env preparation) applies
 *     the SAME nix-shell env filter the server does — otherwise the nix devshell
 *     env leaks into user terminals.
 *
 * This is now an EXPLICIT call (the caller passes `argv`/`env`), no longer an
 * import-order side effect. An env var already set (by the harness or a
 * multi-instance launcher) always wins (`||=`).
 *
 * Both vars promoted here are part of the daemon's env contract
 * (`DAEMON_ENV_KEYS` in `./env.ts`) — the single list `spawn.ts` forwards into
 * the systemd unit and `daemonMain.ts` consumes.
 */
function flagValue(argv: string[], flag: string): string | undefined {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === flag) return argv[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

export function promotePtyHostDaemonFlags(
  argv: string[],
  env: NodeJS.ProcessEnv,
): void {
  const socket = flagValue(argv, "--pty-host-socket");
  if (socket) env.KOLU_PTY_HOST_SOCKET ||= socket;
  const whitelist = flagValue(argv, "--allow-nix-shell-with-env-whitelist");
  if (whitelist) env.KOLU_NIX_ENV_WHITELIST ||= whitelist;
}
