import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { plainDiagnostic } from "./diagnostic.ts";
import type { ForwardReport, OpenedForward } from "./mechanism.ts";
import { openPreferringPort, PortUnavailableError } from "./portChoice.ts";
import { LOOPBACK_ADDRESS, type LoopbackFamily } from "./target.ts";

const FORWARD_KEEPALIVE = { intervalS: 10, countMax: 3 } as const;

export const SSH_OPTS: readonly string[] = [
  "-o",
  "BatchMode=yes",
  "-o",
  `ServerAliveInterval=${FORWARD_KEEPALIVE.intervalS}`,
  "-o",
  `ServerAliveCountMax=${FORWARD_KEEPALIVE.countMax}`,
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

export function reportsBindFailure(stderr: string): boolean {
  return BIND_FAILURE.test(stderr);
}

const READY_TIMEOUT_MS = 30_000;

const KILL_GRACE_MS = 2_000;

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

export function forwardCommandArgs(opts: {
  base: readonly string[];
  host: string;
  localPort: number;
  remotePort: number;
  loopback: LoopbackFamily;
}): string[] {
  return [...opts.base, "-L", forwardSpec(opts), opts.host, HOLD_OPEN_COMMAND];
}

export type SpawnSsh = (
  args: readonly string[],
) => ChildProcessWithoutNullStreams;

export const spawnSshChild: SpawnSsh = (args) =>
  spawn("ssh", [...args], { stdio: ["pipe", "pipe", "pipe"] });

interface SshStartupWatch {
  readonly bindFailed: () => boolean;
  readonly detail: () => string;
  onReady: () => void;
  onBindFailure: () => void;
}

function watchSshStartup(
  child: ChildProcessWithoutNullStreams,
): SshStartupWatch {
  let stdout = "";
  let stderr = "";
  let ready = false;
  let bindFailed = false;
  const watch: SshStartupWatch = {
    bindFailed: () => bindFailed,
    detail: () => {
      const text = plainDiagnostic(stderr);
      return text === "" ? "" : `: ${text}`;
    },
    onReady: () => {},
    onBindFailure: () => {},
  };
  child.stdout.on("data", (chunk: Buffer) => {
    const seen = stdout + chunk.toString();
    stdout = seen.slice(-DIAGNOSTIC_TAIL_BYTES);
    if (ready || !seen.includes(READY_TOKEN)) return;
    ready = true;
    watch.onReady();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const seen = stderr + chunk.toString();
    stderr = seen.slice(-DIAGNOSTIC_TAIL_BYTES);
    if (bindFailed || !reportsBindFailure(seen)) return;
    bindFailed = true;
    watch.onBindFailure();
  });
  return watch;
}

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

  const watch = watchSshStartup(child);
  const detail = watch.detail;

  return new Promise<OpenedForward>((resolve, reject) => {
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
        fail(
          watch.bindFailed()
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
      if (phase === "up")
        report.lost(`the ssh connection to ${host} ended${detail()}`);
    });

    watch.onBindFailure = () => {
      if (phase === "up") {
        report.fault(
          `ssh bound only part of local port ${localPort}${detail()}`,
        );
      }
    };

    watch.onReady = () => {
      if (phase !== "opening") return;
      if (watch.bindFailed()) {
        fail(
          new PortUnavailableError(
            localPort,
            `ssh bound only part of it${detail()}`,
          ),
        );
        return;
      }
      settle("up", () => resolve({ localPort, close }));
    };

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

export async function openSshForward(opts: {
  host: string;
  remotePort: number;
  report: ForwardReport;
  spawnSsh: SpawnSsh;
  lastLocalPort: number | undefined;
  loopback: LoopbackFamily;
}): Promise<OpenedForward> {
  const { host, remotePort, report, spawnSsh, lastLocalPort, loopback } = opts;
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
