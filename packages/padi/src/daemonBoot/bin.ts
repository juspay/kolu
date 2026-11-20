import { parseArgs } from "node:util";
import { daemonProcessMain, stderrLogger } from "@kolu/surface-daemon";
import { runPadiDaemon } from "./daemonMain.ts";
import { log as padiDaemonLog } from "../log.ts";
import { runPadiStdioBridge } from "./stdioBridge.ts";
import { installUnhandledRejectionBoundary } from "./unhandledRejectionBoundary.ts";

const USAGE = `padi — the per-host terminal-workspace daemon

Usage:
  padi [--state-root PATH] [--socket PATH]
  padi --stdio [--state-root PATH] [--socket PATH]

Options:
  --state-root PATH   the persistent folder padi anchors to (session · memory ·
                      pairing). Required (or set KOLU_PADI_STATE_DIR) — there is no
                      silent default (juspay/kolu#1334). The nix-built padi/kolu
                      wrappers export KOLU_PADI_STATE_DIR=$HOME/.local/state/padi
                      (env-insensitive formula; not $XDG_STATE_HOME). The socket +
                      its kaval are keyed by a digest of this path, so a distinct
                      state-root is a distinct, isolated padi.
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
  installUnhandledRejectionBoundary(padiDaemonLog);
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
