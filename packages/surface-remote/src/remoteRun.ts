/** One-shot commands run AT a target — the package's ONE place a fire-and-collect
 *  child is placed on a host, so every such run inherits the same abandonment rule.
 *
 *  `runCapture` owns a LOCAL child's lifetime by group-killing it, which is the
 *  whole story for a local command. For a command run on a host over ssh it is not:
 *  killing the local ssh closes the channel, and the remote command — spawned with no
 *  tty — receives nothing from that close and runs on. And `SIGTERM` is not enough
 *  either: a Nix blocked in a socket write survives it (its handler returns and the
 *  write restarts); only `SIGKILL` stops it. The field incident: a host-side
 *  `nix copy` deadlocked, every reconnect / remove / re-add spawned a fresh copy, and
 *  each queued behind the first one's store-path lock — three orphaned copies on one
 *  host.
 *
 *  So a remote run goes through a tiny wrapper that reports its own PID on stderr and
 *  then `exec`s the command, which therefore runs AS that PID; a run that ends
 *  ABANDONED (aborted, or killed by its own lifetime policy) is `SIGKILL`ed on the
 *  host by that exact PID, over the same ssh dial options, before the run settles.
 *  A PID — the same "exact recorded PIDs, no pattern kills" law `process.ts` keeps —
 *  and not a tag matched with `pkill -f`: an `env TAG=… cmd` prefix never reaches
 *  the command's own command line (`env` execs it), and the pattern then matches
 *  the killer's own remote shell instead (verified).
 *
 *  The one window this cannot close: an abandonment that lands before the PID report
 *  has reached us. Killing the local ssh before the channel opens means the command
 *  never starts, so what remains is the few milliseconds between the remote `exec`
 *  and that line arriving — a run abandoned inside them is not killed on the host. */

import {
  buildSshProbeCommand,
  isLocalHost,
  type SshDestination,
  targetOf,
} from "./host";
import {
  type CaptureOptions,
  type CaptureResult,
  describeExit,
  runCapture,
} from "./process";

const REMOTE_PID_SCRIPT = 'echo "surface-remote-pid $$" >&2; exec "$@"';
const REMOTE_PID_RE = /^surface-remote-pid (\d+)$/;

/** How long the best-effort remote kill may take (an ssh round-trip over the
 *  dial's ControlMaster, or a fresh dial when that master is gone). */
const REMOTE_KILL_DEADLINE_MS = 10_000;

/** The argv {@link runCaptureAt} spawns: `argv` directly on the local seat, wrapped
 *  in the PID-reporting wrapper inside the dial's ssh on a remote one. */
export function captureAtCommand(
  target: string | SshDestination,
  argv: readonly [string, ...string[]],
): { command: string; args: string[] } {
  return isLocalHost(targetOf(target).host)
    ? buildSshProbeCommand(target, ...argv)
    : buildSshProbeCommand(
        target,
        "sh",
        "-c",
        REMOTE_PID_SCRIPT,
        "sh",
        ...argv,
      );
}

/** Run `argv` at `target` (`"localhost"` spawns it directly; a host wraps it in
 *  the dial's ssh — see {@link buildSshProbeCommand}) under `opts`, exactly as
 *  {@link runCapture} does, plus the remote abandonment rule above. The wrapper's
 *  PID report never reaches `onProgress` (it still counts as activity).
 *
 *  `onRemoteKillFailure` is REQUIRED: the kill is best-effort — a PID that already
 *  exited is not an error (the kill's own complaint is silenced, its exit forced
 *  to 0) — so a failure means the kill itself could not run (the host is gone, the
 *  ssh failed). That is the caller's to narrate, never thrown and never dropped. */
export async function runCaptureAt(
  target: string | SshDestination,
  argv: readonly [string, ...string[]],
  opts: CaptureOptions & {
    readonly onRemoteKillFailure: (message: string) => void;
  },
): Promise<CaptureResult> {
  const remote = !isLocalHost(targetOf(target).host);
  let remotePid: string | null = null;
  /** The wrapper's PID report, on a remote run before it is known. */
  const pidReport = (line: string): string | null =>
    remote && remotePid === null
      ? (REMOTE_PID_RE.exec(line)?.[1] ?? null)
      : null;
  const { isActivity, onProgress } = opts;
  const { command, args } = captureAtCommand(target, argv);
  const res = await runCapture(command, args, {
    ...opts,
    isActivity:
      isActivity === undefined
        ? undefined
        : (line) => pidReport(line) !== null || isActivity(line),
    onProgress: (line) => {
      const pid = pidReport(line);
      if (pid !== null) remotePid = pid;
      else onProgress?.(line);
    },
  });
  if (
    remotePid !== null &&
    (res.kind === "aborted" || res.kind === "lifetime-expired")
  ) {
    const kill = await killRemote(target, remotePid);
    if (!kill.ok)
      opts.onRemoteKillFailure(
        `could not stop the abandoned '${argv[0]}' on the host (pid ${remotePid}): ${describeExit(kill)}`,
      );
  }
  return res;
}

/** `SIGKILL` `pid` on `target`, over the same ssh dial options. */
function killRemote(
  target: string | SshDestination,
  pid: string,
): Promise<CaptureResult> {
  const { command, args } = buildSshProbeCommand(
    target,
    "sh",
    "-c",
    'kill -KILL "$1" 2>/dev/null; exit 0',
    "sh",
    pid,
  );
  return runCapture(command, args, {
    policy: { kind: "deadline", ms: REMOTE_KILL_DEADLINE_MS },
  });
}
