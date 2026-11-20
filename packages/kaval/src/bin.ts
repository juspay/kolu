import { parseArgs } from "node:util";
import { daemonProcessMain, stderrLogger } from "@kolu/surface-daemon";
import { runKavalDaemon } from "./daemonMain.ts";
import { runStdioBridge } from "./stdioBridge.ts";

const USAGE = `kaval — the standalone PTY daemon

Usage:
  kaval [--socket PATH]
  kaval --stdio [--socket PATH]

Options:
  --socket PATH   unix socket to serve on
                  (default: $XDG_RUNTIME_DIR/kaval/pty-host.sock on systemd
                  Linux, else /tmp/kaval-$UID/pty-host.sock). The single-instance
                  gate and per-PTY init-file dir sit beside it.
  --stdio         serve over stdin/stdout instead of binding the socket: front
                  the durable daemon (adopting it, else starting one) and relay
                  the link to its socket. This is how kaval-tui --host / R-2
                  reach a remote kaval over ssh; not for interactive use.
  -h, --help      show this help

Drive a running kaval with \`kaval-tui list | snapshot <id> | attach <id>\`.`;

const { values } = parseArgs({
  options: {
    socket: { type: "string" },
    stdio: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

if (values.stdio) {
  runStdioBridge({ socketOverride: values.socket })
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(`kaval --stdio: ${(err as Error).message}\n`);
      process.exit(1);
    });
} else {
  daemonProcessMain({
    name: "kaval",
    run: () =>
      runKavalDaemon({ socketOverride: values.socket, log: stderrLogger() }),
  });
}
