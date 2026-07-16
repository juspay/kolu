/**
 * The `padi` executable — the per-host terminal-workspace daemon's entry point.
 *
 * padi is the workspace authority for one host: it supervises that host's kaval
 * (owning its PTYs), composes the terminal registry, folds awareness on the
 * host's clock, persists the session under its state-root, and serves it all as
 * one surface (`padiSurface`) plus the frozen control core over a unix socket.
 * kolu-server binds it (from the W2.2 cutover); kaval-tui and a future padi-tui
 * reach the kaval and padi it stands up.
 *
 *   padi                          serve at $XDG_RUNTIME_DIR/padi-<digest>/padi.sock,
 *                                 anchored to the binary's default state-root
 *   padi --state-root PATH        anchor to an explicit state-root (dev/e2e); the
 *                                 digest (and so the socket + its kaval) follow it
 *   padi --socket PATH            serve at an explicit socket (gate sits beside it)
 *
 * This file is the executable, never an import target — it runs the daemon on
 * load. `daemonProcessMain` owns the process exit (code + crash arm); the
 * lifecycle itself (state-root → adopt kaval → serve → teardown) is the testable
 * `runPadiDaemon`.
 */

import { parseArgs } from "node:util";
import { daemonProcessMain, stderrLogger } from "@kolu/surface-daemon";
import { runPadiDaemon } from "./daemonMain.ts";
import { log as padiDaemonLog } from "./log.ts";
import { runPadiStdioBridge } from "./stdioBridge.ts";
import { installUnhandledRejectionBoundary } from "./unhandledRejectionBoundary.ts";

const USAGE = `padi — the per-host terminal-workspace daemon

Usage:
  padi [--state-root PATH] [--socket PATH]
  padi --stdio [--state-root PATH] [--socket PATH]

Options:
  --state-root PATH   the persistent folder padi anchors to (session · memory ·
                      pairing). Default: $HOME/.local/state/padi (env-insensitive
                      — it does NOT honor $XDG_STATE_HOME); override with this flag
                      or the KOLU_PADI_STATE_DIR env var. The socket + its kaval are
                      keyed by a digest of this path, so a distinct state-root is a
                      distinct, isolated padi.
  --socket PATH       unix socket to serve on (default: keyed by the state-root
                      digest). The single-instance gate sits beside it.
  --stdio             serve over stdin/stdout instead of binding the socket: FRONT
                      the durable padi daemon (adopt-or-spawn) and relay this
                      process's stdio to its socket. This is how kolu-server's
                      remote binding (\`getHostSession\`, binary "padi") and a future
                      \`padi-tui --host\` reach a padi over ssh — the daemon it fronts
                      (with its kaval + PTYs) outlives the link.
  --allow-nix-shell-with-env-whitelist LIST
                      forward a Nix-devshell env whitelist to PTY spawns (matches
                      kolu-server's flag), comma-separated.
  --spawn-version VER the value stamped as spawned PTYs' TERM_PROGRAM_VERSION.
                      The binder forwards the kolu app version here so terminal
                      identity is byte-identical to the pre-cutover in-process
                      spawn; standalone, padi defaults to its own commit hash.
  --legacy-kaval-socket PATH
                      the pre-W2.2 per-port kaval socket the BINDER hints (its own
                      listen port's kaval-<port>/pty-host.sock) — the upgrade bridge.
                      If padi has no digest kaval yet but a compatible pre-W2.2 kaval
                      is alive here, it is ADOPTED (its PTYs survive the upgrade), not
                      leaked. Standalone (no flag), padi never adopts a stray port kaval.
  -h, --help          show this help

Bind a running padi from kolu-server, or drive its kaval with \`kaval-tui\`.`;

const { values } = parseArgs({
  options: {
    "state-root": { type: "string" },
    socket: { type: "string" },
    stdio: { type: "boolean" },
    "allow-nix-shell-with-env-whitelist": { type: "string" },
    "spawn-version": { type: "string" },
    "legacy-kaval-socket": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

if (values.stdio) {
  // Front the durable daemon over stdin/stdout (the ssh transport). NEVER log to
  // stdout here — it is the wire. Resolves when the link ends; the daemon it
  // fronts (padi + its kaval + PTYs) keeps running.
  runPadiStdioBridge({
    stateRoot: values["state-root"],
    socketOverride: values.socket,
  })
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(`padi --stdio: ${(err as Error).message}\n`);
      process.exit(1);
    });
} else {
  // Install padi's loud-not-fatal `unhandledRejection` backstop for the
  // DURABLE-daemon branch only (NOT the `--stdio` front, whose stdout is the
  // wire and which is ephemeral — a front crash is recovered by kolu-server's
  // reconnect, the durable daemon it fronts survives). Installed HERE, in the
  // real process entrypoint, rather than inside `runPadiDaemon` because
  // `daemonMain.test.ts` boots `runPadiDaemon` IN-PROCESS and a global handler
  // there would suppress vitest's own unhandled-rejection detection. bin.ts is
  // never an import target (it runs the daemon on load), so the handler lands
  // only in a real/spawned padi process. It holds the `log` Proxy, which
  // `runPadiDaemon`'s `configureDaemonLog()` swaps to the rolled-file+stderr
  // multistream before any float can occur, so the marked ERROR is captured
  // durably. See `unhandledRejectionBoundary.ts` for the doctrine + tension.
  installUnhandledRejectionBoundary(padiDaemonLog);
  // The spine owns the rest of this process's life (see tenure.ts) — a live
  // kaval child or poll cell can't keep a finished daemon alive.
  daemonProcessMain({
    name: "padi",
    run: () =>
      runPadiDaemon({
        stateRoot: values["state-root"],
        socketOverride: values.socket,
        nixShellWhitelist: values["allow-nix-shell-with-env-whitelist"],
        spawnVersion: values["spawn-version"],
        legacyKavalSocket: values["legacy-kaval-socket"],
        log: stderrLogger(),
      }),
  });
}
