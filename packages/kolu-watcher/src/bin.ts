/**
 * The `kolu-watcher` executable — the P3 host-resident process entry point.
 *
 * kolu-server runs `ssh <host> kolu-watcher --stdio`. This serves the
 * `watcherSurface` over stdin/stdout: it adopts-or-spawns the host's durable
 * kaval (`connectHostKaval`), runs kolu's provider DAG + native fs/git
 * host-side, and forwards the pty verbs/taps to kaval — all over the one ssh
 * link. The kaval it fronts outlives this link (survive-detach), the watcher
 * itself re-runs fresh per build (always the current code).
 *
 *   kolu-watcher --stdio [--socket PATH]
 *
 * **stdout IS the wire.** Every diagnostic goes to stderr (fd 2) — a stray
 * stdout byte corrupts the next surface frame. The pino logger is pointed at
 * fd 2 for exactly this reason; never `console.log` here.
 */

import { execFileSync } from "node:child_process";
import os from "node:os";
import { parseArgs } from "node:util";
import { serveOverStdio } from "@kolu/surface/peer-server";
import pino from "pino";
import { connectHostKaval } from "./kavalClient.ts";
import { buildWatcherServer } from "./server.ts";

/** Capture the user's LOGIN PATH on the host (P3 remote shell parity).
 *
 *  A remote PTY otherwise inherits the watcher's restricted Nix PATH
 *  (node+git+gh) — the watcher is launched over a NON-login ssh session, and
 *  `kaval.system.info` reports the watcher process's own PATH, which
 *  `composeRemoteSpawnInput` then hands the spawned shell. The shell's rc still
 *  sources (the prompt renders), but the user's profile tools (zoxide etc.,
 *  living in ~/.nix-profile/bin and the like) aren't on PATH because nothing
 *  added the login dirs. So run the user's LOGIN shell once
 *  (`<shell> -l -c 'echo "$PATH"'`): /etc/profile + the user's profile build the
 *  real login PATH (incl. the nix profile dirs), and the watcher serves THAT as
 *  `system.info.path`. Bounded by a 5s timeout; ANY failure (no shell, hang,
 *  empty) falls back to the watcher's own PATH — degraded, never worse than
 *  before. (A `fish` login shell prints `$PATH` space-separated; rare, and the
 *  non-empty result is still trusted — bash/zsh, the common case, are correct.) */
function captureLoginPath(log: pino.Logger): string | undefined {
  const shell = os.userInfo().shell || process.env.SHELL || "/bin/sh";
  try {
    const out = execFileSync(shell, ["-l", "-c", 'echo "$PATH"'], {
      timeout: 5000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out.length > 0) return out;
    log.warn({ shell }, "login PATH capture empty — using watcher PATH");
  } catch (err) {
    log.warn({ shell, err }, "login PATH capture failed — using watcher PATH");
  }
  return undefined;
}

const USAGE = `kolu-watcher — kolu's host-resident terminal watcher (P3)

Usage:
  kolu-watcher --stdio [--socket PATH]

Options:
  --stdio         serve the watcher surface over stdin/stdout (the ssh
                  transport kolu-server dials). Required — there is no
                  interactive mode.
  --socket PATH   override the host kaval's unix socket path (default: the
                  per-user kaval namespace). The spawned kaval is given the
                  matching --socket.
  -h, --help      show this help`;

const { values } = parseArgs({
  options: {
    stdio: { type: "boolean" },
    socket: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

if (!values.stdio) {
  process.stderr.write("kolu-watcher: --stdio is required\n");
  process.exit(1);
}

// stdout is the protocol wire — log to fd 2 ONLY.
const log = pino(
  { level: process.env.LOG_LEVEL ?? "info", base: { pid: process.pid } },
  pino.destination(2),
);

async function main(): Promise<void> {
  const kaval = await connectHostKaval({
    kavalBin: process.env.KOLU_WATCHER_KAVAL_BIN,
    socketOverride: values.socket,
    log: (msg) => log.info(msg),
  });
  const loginPath = captureLoginPath(log);
  const server = buildWatcherServer({ kaval, log, loginPath });

  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
    server.dispose();
  };
  process.once("SIGTERM", () => {
    teardown();
    process.exit(0);
  });

  log.info("serving watcher surface over stdio");
  // Resolves when the ssh link ends (never rejects). The kaval it fronts keeps
  // running; only this watcher process exits.
  const end = await serveOverStdio({
    // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> isn't typed by oRPC; runtime shape is a valid router (same cast kolu-server + the rpm example use).
    router: server.router as any,
    onFirstRequest: () => log.info("first RPC received — link is live"),
  });
  log.info({ reason: end.reason }, "stdin closed — watcher exiting");
  teardown();
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`kolu-watcher: ${(err as Error).message}\n`);
  process.exit(1);
});
