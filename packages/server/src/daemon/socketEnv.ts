/**
 * Promote two server flags into the environment **before** any module that
 * resolves or spawns the pty-host daemon loads.
 *
 * `ptyHost.ts` connects to (and may spawn) the daemon at import time (top-level
 * await), which runs during the import phase — before `index.ts`'s body parses
 * argv with cleye. So the values have to already be in the environment:
 *   - `--pty-host-socket`  → `KOLU_PTY_HOST_SOCKET` (which socket to bind/dial).
 *   - `--allow-nix-shell-with-env-whitelist` → `KOLU_NIX_ENV_WHITELIST` so the
 *     daemon (a separate process that now owns shell-env preparation) applies
 *     the SAME nix-shell env filter the server does — otherwise the nix devshell
 *     env leaks into user terminals.
 *
 * Imported first in `index.ts` purely for this side effect; an explicit env var
 * already set (by the harness or a multi-instance launcher) always wins.
 */
function flagValue(flag: string): string | undefined {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === flag) return argv[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

const socket = flagValue("--pty-host-socket");
if (socket) process.env.KOLU_PTY_HOST_SOCKET ||= socket;

const whitelist = flagValue("--allow-nix-shell-with-env-whitelist");
if (whitelist) process.env.KOLU_NIX_ENV_WHITELIST ||= whitelist;
