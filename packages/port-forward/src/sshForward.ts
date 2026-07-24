/**
 * The mechanism for a `remote` target: ONE dedicated ssh process per forward,
 * whose own life IS the forward's life.
 *
 * The earlier design shared kolu's `ControlMaster` and asked it for listeners
 * with `ssh -O forward`. It was wrong in a way no patch reaches, because
 * OpenSSH gives a shared master's forwards a lifetime of their own:
 *
 *  - a listener created with `-O forward` OUTLIVES whoever asked for it, until
 *    the master's `ControlPersist` idle timer reaps it — so quitting could
 *    leave ports mapped;
 *  - a mux client's forward is NOT torn down when that client is killed — the
 *    master owns it, not the requester;
 *  - and there is no `-O list`, so the master's forward table is write-only: a
 *    restarted process can neither see nor adopt what it left behind. An empty
 *    table beside live ports is the worst possible pair.
 *
 * Sharing a master and kernel-tied lifetime are therefore mutually exclusive,
 * and lifetime is the property that matters: a forward must not outlive the
 * process that opened it, including when that process is SIGKILLed. So each
 * forward gets its own connection, with `ControlPath=none` making sure it never
 * rides or creates a shared master. The cost — one ssh handshake per forward
 * instead of a channel on a warm master — is the price of that guarantee.
 *
 * The remote command (`cat`, reading a pipe we hold and never write to) is what
 * ties the lifetime to the kernel. Measured both ways on a live sshd: with `-N`
 * the ssh child SURVIVES its parent's SIGKILL and the port keeps serving; with
 * a remote command, the kernel closes our pipe as the process dies, `cat` reads
 * EOF, the session ends, and the client exits — port refused, no timer
 * involved.
 */

import { spawn } from "node:child_process";
import { connect } from "node:net";
import { canBindLocally, pickFreePort } from "./freePort.ts";
import type { OpenedForward } from "./opened.ts";
import { openPreferringPort } from "./portChoice.ts";
import { assertHost, assertPort } from "./target.ts";

/** The options every forward connection is opened with.
 *
 *  `BatchMode=yes` and the `ServerAlive` pair are kolu's own ssh policy
 *  (`SSH_OPT_PAIRS` in `@kolu/surface-remote`): no host may stop to prompt
 *  under a TUI, and a dead peer must be noticed. The two that carry this
 *  module's design are:
 *
 *  - `ControlPath=none` — never ride or create a shared master. This
 *    connection is the forward's lifetime; a master would hand that lifetime
 *    to someone else.
 *  - `ExitOnForwardFailure=yes` — a local bind that fails must END the child,
 *    loudly, rather than leave a connection with no listener on it. */
const SSH_OPTS: readonly string[] = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ServerAliveInterval=10",
  "-o",
  "ServerAliveCountMax=3",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "ControlPath=none",
  "-o",
  "ExitOnForwardFailure=yes",
];

/** What the forward runs on the far end: a process that transfers nothing and
 *  exits the moment its stdin closes — i.e. the moment we go away. It is the
 *  hold-open that makes the lifetime kernel-tied (see the module doc); `-N`
 *  would leave an orphan serving the port after a SIGKILL. */
const HOLD_OPEN_COMMAND = "cat";

/** How long to wait for the listener to start accepting before giving up.
 *  Generous because a cold host pays a real handshake; a bind failure or a
 *  refused host ends the child long before this. */
const READY_TIMEOUT_MS = 30_000;

/** How often to try the new port while waiting for ssh to bind it. */
const READY_POLL_MS = 100;

/** How long a cancelled forward gets to end politely before it is SIGKILLed. */
const KILL_GRACE_MS = 2_000;

/** The `-L` argument. `*:` is load-bearing: it binds the listener on ALL
 *  interfaces regardless of `GatewayPorts`, which is the whole point — the
 *  browser that opens this port is on another machine. The far end is always
 *  the target host's own loopback, since a port already bound to `0.0.0.0`
 *  there needs no forward at all. */
export function forwardSpec(opts: {
  localPort: number;
  remotePort: number;
}): string {
  return `*:${opts.localPort}:127.0.0.1:${opts.remotePort}`;
}

/** The whole argv of a forward: options, the tunnel, the host, and the command
 *  that holds it open. */
export function forwardCommandArgs(opts: {
  base: readonly string[];
  host: string;
  localPort: number;
  remotePort: number;
}): string[] {
  return [...opts.base, "-L", forwardSpec(opts), opts.host, HOLD_OPEN_COMMAND];
}

/** Is something accepting connections on this local port yet? A refusal is an
 *  ordinary answer — ssh has not bound it yet — not a failure. */
function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The ssh side of the forward map. */
export interface SshForwards {
  open(
    host: string,
    remotePort: number,
    onLost: (reason: string) => void,
  ): Promise<OpenedForward>;
}

/** Open one forward on its own ssh connection. Resolves when the local port is
 *  actually accepting connections; rejects — with ssh's own stderr — if the
 *  child dies first (a refused host, a taken local port, a bad key). */
function openOne(opts: {
  host: string;
  remotePort: number;
  localPort: number;
  onLost: (reason: string) => void;
}): Promise<OpenedForward> {
  const { host, remotePort, localPort, onLost } = opts;
  // stdin is a pipe we never write to: the remote `cat` blocks on it forever
  // and gets EOF the instant this process goes away, however it goes away.
  const child = spawn(
    "ssh",
    forwardCommandArgs({ base: SSH_OPTS, host, localPort, remotePort }),
    { stdio: ["pipe", "ignore", "pipe"] },
  );

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const detail = (): string =>
    stderr.trim() === "" ? "" : `: ${stderr.trim()}`;

  return new Promise<OpenedForward>((resolve, reject) => {
    let settled = false;
    let cancelled = false;

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `port-forward: opening a forward to ${host}:${remotePort} — could not run ssh: ${err.message}`,
        ),
      );
    });

    child.once("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        reject(
          new Error(
            `port-forward: opening a forward to ${host}:${remotePort} — ssh exited ${signal ?? code}${detail()}`,
          ),
        );
        return;
      }
      // Past readiness, the child ending means the forward is GONE — the host
      // dropped, the network died, someone killed it. Unless we did it
      // ourselves, in which case `close()` is already telling the caller.
      if (!cancelled) {
        onLost(`the ssh connection to ${host} ended${detail()}`);
      }
    });

    void (async () => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (!settled && Date.now() < deadline) {
        if (await accepts(localPort)) {
          if (settled) return;
          settled = true;
          resolve({
            localPort,
            close: () =>
              new Promise<void>((done) => {
                cancelled = true;
                if (child.exitCode !== null || child.signalCode !== null) {
                  done();
                  return;
                }
                const escalate = setTimeout(() => {
                  child.kill("SIGKILL");
                }, KILL_GRACE_MS);
                escalate.unref();
                child.once("exit", () => {
                  clearTimeout(escalate);
                  done();
                });
                child.kill();
              }),
          });
          return;
        }
        await delay(READY_POLL_MS);
      }
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `port-forward: the forward to ${host}:${remotePort} never started listening on port ${localPort} within ${READY_TIMEOUT_MS}ms${detail()}`,
        ),
      );
    })();
  });
}

export function createSshForwards(): SshForwards {
  return {
    async open(host, remotePort, onLost) {
      assertHost(host);
      assertPort(remotePort, `the port on ${host}`);
      // The target's own port number first — `pu-dev:4123` answers on
      // `0.0.0.0:4123` when that number is free here. A taken port makes ssh
      // exit (that is what `ExitOnForwardFailure` is for), which is exactly the
      // signal the preference falls back on.
      return await openPreferringPort({
        preferred: remotePort,
        open: async (choice) => {
          if (choice !== "any" && !(await canBindLocally(choice))) {
            // Something local already answers on this number. ssh would listen
            // beside it (SO_REUSEADDR) and the number would then mean two
            // different servers depending on the address dialled — take a free
            // port instead. See `canBindLocally`.
            throw new Error(
              `port-forward: local port ${choice} already has a listener.`,
            );
          }
          return await openOne({
            host,
            remotePort,
            localPort: choice === "any" ? await pickFreePort() : choice,
            onLost,
          });
        },
      });
    },
  };
}
