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

import { parseArgs } from "node:util";
import { serveOverStdio } from "@kolu/surface/peer-server";
import pino from "pino";
import { connectHostKaval } from "./kavalClient.ts";
import { buildWatcherServer } from "./server.ts";

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
  const server = buildWatcherServer({ kaval, log });

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
