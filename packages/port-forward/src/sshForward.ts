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
import { plainDiagnostic } from "./diagnostic.ts";
import type { ForwardReport, OpenedForward } from "./mechanism.ts";
import { openPreferringPort, PortUnavailableError } from "./portChoice.ts";
import { LOOPBACK_ADDRESS, type LoopbackFamily } from "./target.ts";

/** The options every forward connection is opened with.
 *
 *  `BatchMode=yes` and the `ServerAlive` pair spell the same intent as
 *  `@kolu/surface-remote`'s interactive default (`DEFAULT_SSH_KEEPALIVE`, 10×3):
 *  no host may stop to prompt under a TUI, and a dead peer must be noticed.
 *
 *  They are a DELIBERATELY INDEPENDENT policy, not a stale copy — worth saying
 *  now that surface-remote's is per-dial and can be raised. A forward does NOT
 *  track the tolerance its host's mirror dial chose, and should not: a dial is
 *  protecting minutes of provisioning work that a redial would destroy, whereas a
 *  forward is cheap to re-establish and a listener left pointing at a dead peer
 *  is worse than one that drops promptly. So a consumer who raises a dial to a
 *  five-minute tolerance still gets forwards that fail fast at ~30s, on purpose.
 *  (`@kolu/port-forward` is also deliberately dependency-free, so importing the
 *  renderer is not on the table; if these ever must track a dial, the shared
 *  `{intervalS, countMax}` graduates into a zero-dep receptacle both can read —
 *  the graduation candidate is recorded in `.agency/lowy.md`'s Areas of
 *  Volatility table under "ssh dead-peer / link-silence policy", so a future
 *  sweep finds it in the ledger rather than only in this comment.)
 *
 *  The two opts that carry this module's own design are:
 *
 *  - `ControlPath=none` — never ride or create a shared master. This
 *    connection is the forward's lifetime; a master would hand that lifetime
 *    to someone else.
 *  - `ExitOnForwardFailure=yes` — a local bind that fails must END the child,
 *    loudly, rather than leave a connection with no listener on it. */
export const SSH_OPTS: readonly string[] = [
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
  // The four below are not policy — they are this mechanism's PRECONDITIONS,
  // pinned on the argv because ssh_config is per-host and the aliases we
  // deliberately support may legitimately set any of them:
  //   LogLevel   — QUIET hides the bind-failure line that tells a half-bound
  //                forward from a healthy one.
  //   StdinNull  — yes hands the remote hold-open command an immediate EOF, so
  //                the connection (and the forward) would end as it began.
  //   RequestTTY — a PTY lets the far end's output carry terminal control into
  //                our diagnostics, and changes how the session ends.
  //   ForkAfterAuthentication — yes backgrounds the client, cutting the very
  //                process lifetime this forward's lifetime is tied to.
  "-o",
  "LogLevel=ERROR",
  "-o",
  "StdinNull=no",
  "-o",
  "RequestTTY=no",
  "-o",
  "ForkAfterAuthentication=no",
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

/** How much of ssh's output an attempt keeps. Enough for every startup decision
 *  (the ready token and the bind-failure line arrive in the first few hundred
 *  bytes) and for the last words a loss message quotes. */
const DIAGNOSTIC_TAIL_BYTES = 4096;

/** The `-L` argument. `*:` is load-bearing: it binds the listener on ALL
 *  interfaces regardless of `GatewayPorts`, which is the whole point — the
 *  browser that opens this port is on another machine. The far end is always
 *  the target host's own loopback, since a port already bound to `0.0.0.0`
 *  there needs no forward at all — but WHICH loopback is the caller's to say.
 *
 *  A v6 far end is BRACKETED (`[::1]`), which is ssh's own syntax for an IPv6
 *  address inside a forward spec; unbracketed, its colons would be read as the
 *  spec's own field separators and ssh would reject the whole argument. Note
 *  this is the opposite of the rule for the `host` argument, which ssh wants
 *  BARE — `assertHost` rejects brackets there for exactly that reason. Two
 *  different syntaxes for two different positions, which is why the bracketing
 *  lives here and not in the target. */
export function forwardSpec(opts: {
  localPort: number;
  remotePort: number;
  loopback: LoopbackFamily;
}): string {
  const address = LOOPBACK_ADDRESS[opts.loopback];
  const far = opts.loopback === "v6" ? `[${address}]` : address;
  return `*:${opts.localPort}:${far}:${opts.remotePort}`;
}

/** The whole argv of a forward: options, the tunnel, the host, and the command
 *  that holds it open. */
export function forwardCommandArgs(opts: {
  base: readonly string[];
  host: string;
  localPort: number;
  remotePort: number;
  loopback: LoopbackFamily;
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
  report: ForwardReport;
  spawnSsh: SpawnSsh;
  loopback: LoopbackFamily;
}): Promise<OpenedForward> {
  const { host, remotePort, localPort, report, loopback } = opts;
  const child = opts.spawnSsh(
    forwardCommandArgs({
      base: SSH_OPTS,
      host,
      localPort,
      remotePort,
      loopback,
    }),
  );

  // Only the TAIL is kept. These buffers live as long as the ssh child, which
  // is as long as the forward — days, for a box left running — and they serve
  // two jobs of very different size: the startup decisions (the ready token,
  // the bind-failure line) all land in the first few hundred bytes, and a later
  // loss message wants only ssh's last words.
  let stdout = "";
  let stderr = "";
  /** Whether ssh has EVER reported a failed bind — latched, because the
   *  diagnostic tail is not a place to keep a fact. The far end can write to
   *  this same stream, so it could otherwise push the bind line out of the
   *  window with a few kilobytes of noise and have the ready token resolve a
   *  half-bound forward. A latched boolean cannot be evicted. */
  let sawBindFailure = false;
  /** Whether the far end has EVER announced itself — latched for the same
   *  reason as the bind failure: a single chunk carrying the token followed by
   *  more than the tail budget would otherwise evict its own announcement, and
   *  a forward that is genuinely up would sit there until the deadline. */
  let sawReady = false;
  child.stdout.on("data", (chunk: Buffer) => {
    const seen = stdout + chunk.toString();
    // Only until it is latched: the answer cannot change back, so scanning past
    // that point is work whose result is already known.
    if (!sawReady && seen.includes(READY_TOKEN)) sawReady = true;
    stdout = seen.slice(-DIAGNOSTIC_TAIL_BYTES);
  });
  /** What a newly-seen bind failure MEANS — filled in by the attempt below,
   *  because the answer depends on how far it has got. stdout and stderr are
   *  separate pipes and the order their chunks reach this process is the
   *  kernel's to choose, so a bind failure can perfectly well arrive after the
   *  ready token it contradicts; without this, that one was latched into a
   *  boolean nothing ever read again. */
  let onBindFailure: () => void = () => {};
  child.stderr.on("data", (chunk: Buffer) => {
    // Scan the JOIN of the retained tail and the new chunk, so a line split
    // across two chunks is still seen, then truncate for diagnostics only.
    const seen = stderr + chunk.toString();
    if (!sawBindFailure && reportsBindFailure(seen)) {
      sawBindFailure = true;
      stderr = seen.slice(-DIAGNOSTIC_TAIL_BYTES);
      onBindFailure();
      return;
    }
    stderr = seen.slice(-DIAGNOSTIC_TAIL_BYTES);
  });

  const detail = (): string => {
    const text = plainDiagnostic(stderr);
    return text === "" ? "" : `: ${text}`;
  };

  return new Promise<OpenedForward>((resolve, reject) => {
    /** Where this attempt has got to. One name for the four states it can be
     *  in, rather than two booleans whose write order the reader has to hold:
     *  `opening` settles exactly once into `up` or `failed`, and only something
     *  that came up can then be `cancelled` by us. */
    let phase: "opening" | "up" | "cancelled" | "failed" = "opening";
    let timer: NodeJS.Timeout | undefined;

    const settle = (next: "up" | "failed", outcome: () => void): void => {
      if (phase !== "opening") return;
      phase = next;
      if (timer !== undefined) clearTimeout(timer);
      outcome();
    };

    const fail = (err: Error): void => {
      settle("failed", () => {
        child.kill("SIGKILL");
        reject(err);
      });
    };

    const close = (): Promise<void> =>
      new Promise<void>((closed) => {
        phase = "cancelled";
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
      if (phase === "opening") {
        // Died before it was ever up. A bind failure is the caller's cue to
        // take a different port; anything else is the forward's own failure.
        fail(
          sawBindFailure
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
      if (phase === "up")
        report.lost(`the ssh connection to ${host} ended${detail()}`);
    });

    // Before readiness the stdout handler below decides what a bind failure
    // means (take another port). Once we have called the forward UP, the same
    // line says ssh bound only part of the port — half a listener, which is
    // exactly the "still there but not healthy" case the fault channel carries.
    // Reported, never latched and dropped: it arrives late only because the two
    // pipes race, and the row would otherwise claim to be fine.
    onBindFailure = () => {
      if (phase === "up") {
        report.fault(
          `ssh bound only part of local port ${localPort}${detail()}`,
        );
      }
    };

    child.stdout.on("data", () => {
      if (phase !== "opening" || !sawReady) return;
      // The far end is running, so ssh set the forwardings up before it. A bind
      // error alongside that means a PARTIAL bind (one address family took the
      // port, the other did not) — half a listener is not a forward.
      if (sawBindFailure) {
        fail(
          new PortUnavailableError(
            localPort,
            `ssh bound only part of it${detail()}`,
          ),
        );
        return;
      }
      settle("up", () => resolve({ localPort, close }));
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
export async function openSshForward(opts: {
  host: string;
  remotePort: number;
  report: ForwardReport;
  spawnSsh: SpawnSsh;
  lastLocalPort: number | undefined;
  /** WHICH loopback the far end is on. Required — see {@link LoopbackFamily}. */
  loopback: LoopbackFamily;
}): Promise<OpenedForward> {
  const { host, remotePort, report, spawnSsh, lastLocalPort, loopback } = opts;
  // The number this target answered on last time, else the target's own port —
  // `pu-dev:4123` answers on `0.0.0.0:4123` when that number is free here. The
  // remembered port wins because it is the more specific promise: if 4123 was
  // taken at first open and the forward landed on 61003, the links the user has
  // say 61003, and coming back on 4123 would break exactly what the preference
  // exists to protect. A taken port makes ssh exit (that is what
  // `ExitOnForwardFailure` is for), which is the signal the preference falls
  // back on.
  return await openPreferringPort({
    preferred: lastLocalPort ?? remotePort,
    open: (localPort) =>
      openSshAttempt({
        host,
        remotePort,
        localPort,
        report,
        spawnSsh,
        loopback,
      }),
  });
}
