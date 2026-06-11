/**
 * `kolu-daemon` — the pty-host daemon process entry.
 *
 * Thin glue, deliberately OUTSIDE the staleKey's hashed closure: the daemon's
 * behaviour is `runPtyHostDaemon` in `@kolu/pty-host` (hashed); this file only
 * wires it to the process — reads the socket override, runs the serve loop, and
 * turns signals into a clean shutdown. It is the binary the server spawns
 * (detached / `systemd-run`); it keeps running because the socket listener
 * holds the event loop open.
 */
import { runPtyHostDaemon } from "@kolu/pty-host";
import { configureNixShellEnv } from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { log } from "../log.ts";

async function main(): Promise<void> {
  // The daemon owns shell-env preparation (cleanEnv runs here), so it must
  // apply the SAME nix-shell filter the server does, or the devshell env leaks
  // into terminals. The whitelist rides KOLU_NIX_ENV_WHITELIST (see socketEnv).
  configureNixShellEnv(process.env.KOLU_NIX_ENV_WHITELIST);
  const socketPath = process.env.KOLU_PTY_HOST_SOCKET || undefined;
  const result = await runPtyHostDaemon({
    socketPath,
    version: pkg.version,
    log,
  });

  if (result.kind === "already-running") {
    log.info(
      { pid: result.pid },
      "another pty-host daemon owns the gate — exiting",
    );
    process.exit(0);
  }
  if (result.kind === "serve-failed") {
    log.error(
      { outcome: result.outcome },
      "pty-host daemon could not bind its socket — exiting",
    );
    process.exit(1);
  }

  const { daemon } = result;
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, () => {
      daemon.close();
      process.exit(0);
    });
  }
  log.info({ socketPath: daemon.socketPath }, "pty-host daemon ready");
  // No explicit keep-alive: the unix-socket listener holds the event loop open.
}

main().catch((err) => {
  log.error({ err }, "pty-host daemon crashed on startup");
  process.exit(1);
});
