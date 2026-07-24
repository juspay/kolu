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

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { canBindLocally, pickFreePort } from "./freePort.ts";
import type { OpenedForward } from "./opened.ts";
import { openPreferringPort, PortUnavailableError } from "./portChoice.ts";

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

/** The far end announces itself with this, then holds the connection open.
 *
 *  `cat` is the hold-open that makes the lifetime kernel-tied (see the module
 *  doc) — it exits the moment its stdin closes, i.e. the moment we go away;
 *  `-N` would instead leave an orphan serving the port after a SIGKILL. The
 *  `echo` in front of it is the READINESS signal: ssh sets up forwardings
 *  BEFORE it starts the remote command, so a token on stdout means the tunnel
 *  is up and the far end is genuinely executing. That is a fact about OUR ssh,
 *  which a "can something answer on the port?" probe never was — anything else
 *  on the machine could have answered that. */
const READY_TOKEN = "PORT-FORWARD-READY";
const HOLD_OPEN_COMMAND = `echo ${READY_TOKEN}; cat`;

/** ssh's own words when a local bind fails: `bind [0.0.0.0]:4123: Address
 *  already in use`.
 *
 *  This must be watched even though `ExitOnForwardFailure=yes` is set, because
 *  that option only fires when EVERY requested forwarding fails. `*:` asks for
 *  both address families, so a taken IPv4 port with a free IPv6 one is a
 *  PARTIAL success: measured, ssh logs the v4 bind error, binds `::`, and runs
 *  the remote command as if all were well. A forward that answers on v6 and
 *  refuses on v4 is precisely the row that lies, so any bind error at all sends
 *  this attempt to the fallback port.
 *
 *  BOTH branches are anchored to the start of a line — the group is inside the
 *  `^`, not beside it. That is not tidiness: the far end's stderr is merged
 *  into this same stream, so an unanchored branch would let a remote print
 *  "Could not request local forwarding" mid-line and steer OUR forward onto a
 *  different port. Anchored, it would have to control the start of a line, and
 *  the worst it could still buy is a fallback port — never a forward reported
 *  as up when it is not. */
const BIND_FAILURE = /^(?:bind \[|Could not request local forwarding)/m;

/** Did ssh report that it could not bind the local port? Read from the stderr
 *  accumulated so far — see `BIND_FAILURE` for why the match is line-anchored
 *  and what the far end can and cannot do to it. */
export function reportsBindFailure(stderr: string): boolean {
  return BIND_FAILURE.test(stderr);
}

/** How long to wait for the far end to announce itself before giving up.
 *  Generous because a cold host pays a real handshake; a bind failure or a
 *  refused host ends the attempt long before this. */
const READY_TIMEOUT_MS = 30_000;

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

/** How this module gets an ssh child. Taken as an argument rather than called
 *  directly, because everything below it is a decision ABOUT a child — the
 *  readiness token, the bind-failure line, exit-before-ready versus
 *  exit-after-ready — and none of that can be exercised while running ssh and
 *  reading ssh are the same act. */
export type SpawnSsh = (
  args: readonly string[],
) => ChildProcessWithoutNullStreams;

/** The real one: an ssh child with all three streams piped. stdin is a pipe we
 *  never write to — the remote `cat` blocks on it forever and gets EOF the
 *  instant this process goes away, however it goes away. */
export const spawnSshChild: SpawnSsh = (args) =>
  spawn("ssh", [...args], { stdio: ["pipe", "pipe", "pipe"] });

/** ONE attempt at a forward, on a local port that has already been chosen.
 *
 *  Resolves when the FAR END announces itself and no bind error was logged;
 *  rejects with `PortUnavailableError` when the local bind is the thing that
 *  failed (so the caller can take another port), and with ssh's own stderr for
 *  anything else — a refused host, a bad key, no ssh at all.
 *
 *  Every settle path goes through `settle()`, which is the single writer of
 *  this attempt's outcome: whichever of the three racing sources arrives first
 *  (the ready token, the child's exit, a spawn error, the deadline) decides,
 *  and the rest become no-ops. */
export function openSshAttempt(opts: {
  host: string;
  remotePort: number;
  localPort: number;
  onLost: (reason: string) => void;
  spawnSsh: SpawnSsh;
}): Promise<OpenedForward> {
  const { host, remotePort, localPort, onLost } = opts;
  const child = opts.spawnSsh(
    forwardCommandArgs({ base: SSH_OPTS, host, localPort, remotePort }),
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const detail = (): string =>
    stderr.trim() === "" ? "" : `: ${stderr.trim()}`;

  return new Promise<OpenedForward>((resolve, reject) => {
    /** The attempt's outcome, written exactly once. `cancelled` is separate: it
     *  records that WE ended the child, so its exit is not reported as a loss. */
    let done = false;
    let cancelled = false;
    let timer: NodeJS.Timeout | undefined;

    const settle = (outcome: () => void): void => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      outcome();
    };

    const fail = (err: Error): void => {
      settle(() => {
        child.kill("SIGKILL");
        reject(err);
      });
    };

    const close = (): Promise<void> =>
      new Promise<void>((closed) => {
        cancelled = true;
        if (child.exitCode !== null || child.signalCode !== null) {
          closed();
          return;
        }
        const escalate = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
        escalate.unref();
        child.once("exit", () => {
          clearTimeout(escalate);
          closed();
        });
        child.kill();
      });

    child.once("error", (err) =>
      fail(
        new Error(
          `port-forward: opening a forward to ${host}:${remotePort} — could not run ssh: ${err.message}`,
        ),
      ),
    );

    child.once("exit", (code, signal) => {
      if (!done) {
        // Died before it was ever up. A bind failure is the caller's cue to
        // take a different port; anything else is the forward's own failure.
        fail(
          reportsBindFailure(stderr)
            ? new PortUnavailableError(
                localPort,
                `ssh could not bind it${detail()}`,
              )
            : new Error(
                `port-forward: opening a forward to ${host}:${remotePort} — ssh exited ${signal ?? code}${detail()}`,
              ),
        );
        return;
      }
      // Past readiness, the child ending means the forward is GONE — the host
      // dropped, the network died, someone killed it. Unless we did it
      // ourselves, in which case `close()` is already telling the caller.
      if (!cancelled) onLost(`the ssh connection to ${host} ended${detail()}`);
    });

    child.stdout.on("data", () => {
      if (done || !stdout.includes(READY_TOKEN)) return;
      // The far end is running, so ssh set the forwardings up before it. A bind
      // error alongside that means a PARTIAL bind (one address family took the
      // port, the other did not) — half a listener is not a forward.
      if (reportsBindFailure(stderr)) {
        fail(
          new PortUnavailableError(
            localPort,
            `ssh bound only part of it${detail()}`,
          ),
        );
        return;
      }
      settle(() => resolve({ localPort, close }));
    });

    timer = setTimeout(
      () =>
        fail(
          new Error(
            `port-forward: the forward to ${host}:${remotePort} never came up within ${READY_TIMEOUT_MS}ms${detail()}`,
          ),
        ),
      READY_TIMEOUT_MS,
    );
    timer.unref();
  });
}

/** Open one forward on its own ssh connection — the `remote` generator behind
 *  `ForwardMechanisms`, peer to `openRelay`. */
export async function openSshForward(
  host: string,
  remotePort: number,
  onLost: (reason: string) => void,
  spawnSsh: SpawnSsh,
): Promise<OpenedForward> {
  // The target's own port number first — `pu-dev:4123` answers on
  // `0.0.0.0:4123` when that number is free here. A taken port makes ssh exit
  // (that is what `ExitOnForwardFailure` is for), which is exactly the signal
  // the preference falls back on.
  return await openPreferringPort({
    preferred: remotePort,
    open: async (choice) => {
      if (choice !== "any" && !(await canBindLocally(choice))) {
        // Something local already answers on this number. ssh would listen
        // beside it (SO_REUSEADDR) and the number would then mean two
        // different servers depending on the address dialled — take a free
        // port instead. See `canBindLocally`.
        throw new PortUnavailableError(
          choice,
          "something local is already listening on it",
        );
      }
      return await openSshAttempt({
        host,
        remotePort,
        localPort: choice === "any" ? await pickFreePort() : choice,
        onLost,
        spawnSsh,
      });
    },
  });
}
