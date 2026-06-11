/**
 * The daemon's env contract, named ONCE.
 *
 * These are the runtime env vars that make a pty-host daemon come up configured
 * identically to the in-place (non-systemd) child. The set is one concept that
 * three sites must agree on, so they all reference THIS list rather than each
 * re-stating it from memory:
 *   - **Promotion** (`socketEnv.ts`): `KOLU_PTY_HOST_SOCKET` /
 *     `KOLU_NIX_ENV_WHITELIST` get hoisted from server flags into the env before
 *     the daemon-spawning module loads.
 *   - **Forwarding** (`spawn.ts` `setenvArgs`): iterates this list to build the
 *     `--setenv=K=V` args, since a `systemd-run --user` transient unit does NOT
 *     inherit the spawning server's env.
 *   - **Consumption** (`daemonMain.ts`): the daemon reads
 *     `KOLU_NIX_ENV_WHITELIST` / `KOLU_PTY_HOST_SOCKET` on startup; the
 *     build-identity vars (`KOLU_PTY_HOST_BUILD_ID` / `KOLU_COMMIT_HASH`) feed
 *     its `version()`.
 *
 * Add a new daemon-relevant var HERE and every site picks it up — the "these
 * lists agree" invariant becomes mechanical, not memorized.
 */
export const DAEMON_ENV_KEYS = [
  "KOLU_PTY_HOST_SOCKET",
  "KOLU_NIX_ENV_WHITELIST",
  "KOLU_PTY_HOST_BUILD_ID",
  "KOLU_COMMIT_HASH",
  "KOLU_DAEMON_BIN",
  "LOG_LEVEL",
] as const;
