/** Helpers for `host`-string handling shared between `provisionAgent`
 *  (nix copy) and `HostSession` (ssh subprocess spawn). Keeps the
 *  "are we talking to ourselves?" check and the per-line stderr fanout
 *  in one place so they evolve together. */

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Why a connection attempt failed — the discriminant the reconnect
 *  give-up gate keys on. Shared between `provisionAgent` (which decides it
 *  per provisioning step) and `HostSession` (which decides it per spawn
 *  phase and acts on it), so it lives here rather than in either consumer.
 *  Classified by *what kind* of thing failed, never by parsing error
 *  strings for control flow:
 *
 *   - `"network"` — couldn't reach the host (ssh transport failed to
 *     connect, the link dropped, an arch probe / `nix copy` over ssh hit a
 *     connection error). Transient: the host is asleep, roaming, or its
 *     VPN is down, so the loop retries at the capped backoff *forever* —
 *     the link self-heals once the host answers again.
 *   - `"remote"` — reached the host, but it rejected us, or the agent
 *     itself is broken: `nix copy`/`realise` exited non-zero for a
 *     non-transport reason (e.g. `trusted-users`), or the agent command
 *     ran and exited before the first RPC (bad binary, startup crash).
 *     Retrying can't fix a misconfiguration or a broken build, so after
 *     `MAX_CONSECUTIVE_FAILURES` it gives up into the terminal `failed`
 *     state. */
export type FailureCause = "network" | "remote";

/** Heuristic: does an ssh / `nix copy` stderr line look like a *transport*
 *  failure (host unreachable) rather than a remote rejection? Used to
 *  upgrade a provisioning failure's cause to `"network"` — `nix copy`
 *  forks its own ssh and reports connection errors on stderr while exiting
 *  with nix's own code (not ssh's 255), so the exit code alone can't tell
 *  "host asleep" from "daemon refused the closure". Matched against the
 *  text ssh/nix actually emit; a miss only means we fall back to the safe
 *  default (`"remote"`, which is bounded), never a wrong terminal verdict. */
export function looksLikeNetworkError(line: string): boolean {
  return /connection (refused|timed out|closed|reset)|operation timed out|no route to host|network is unreachable|could not resolve hostname|kex_exchange_identification|ssh: connect to host|not responding|broken pipe|port 22:/i.test(
    line,
  );
}

/** Forward every non-blank `\n`-terminated line in `chunk` to `onLine`.
 *  Used identically by `nix copy`'s subprocess stderr forwarder and
 *  `HostSession`'s ssh-child stderr forwarder. */
export function forEachLine(
  chunk: string,
  onLine: (line: string) => void,
): void {
  for (const line of chunk.split("\n")) {
    if (line.trim()) onLine(line);
  }
}

/** ssh options shared by *every* non-interactive ssh this package causes
 *  to be spawned — the long-lived agent session, the one-shot
 *  probe/realise/pin commands, AND the ssh that `nix copy --to ssh-ng://`
 *  forks internally. They split into two jobs:
 *
 *   - `BatchMode=yes` — never block on a password/passphrase prompt.
 *   - `ServerAliveInterval` / `ServerAliveCountMax` + `ConnectTimeout` —
 *     make ssh detect a *dead peer* and exit non-zero instead of
 *     blocking forever on a half-open connection.
 *
 *  That second job is load-bearing for the one-shot commands too, which
 *  is why these opts are no longer agent-only. `nix-store --realise`
 *  over ssh — and the `nix copy` that precedes it — is a *remote build*
 *  / *remote transfer*, not a quick round-trip: the channel can sit idle
 *  for minutes while the far end compiles or fetches. If the host
 *  degrades mid-flight (network drop, sshd wedge, box overload), an ssh
 *  with no keepalive parks on the half-open socket until the OS TCP
 *  stack gives up — effectively forever — and wedges the caller's spawn
 *  cycle in `copying`/`connecting` with no recovery. The keepalive turns
 *  that eternity into a bounded ~Interval×CountMax (≈30s) failure the
 *  reconnect loop can retry.
 *
 *  Crucially this does NOT cap a healthy-but-slow build: ssh keepalives
 *  ride the protocol layer independently of channel data, so a
 *  responsive sshd answers them no matter how long the build's stdout
 *  stays quiet. Only an actually-unresponsive peer trips the limit.
 *
 *  Declared once as `(key, value)` pairs — the single source of truth —
 *  then rendered into the two shapes its consumers need: an ssh `-o`
 *  argv (`SSH_COMMON_OPTS`) for the ssh commands we spawn directly, and
 *  a whitespace-joined `NIX_SSHOPTS` string for the ssh `nix copy` forks
 *  out of reach of our argv. Values MUST stay whitespace-free: the argv
 *  renderer emits one option per pair and nix word-splits `NIX_SSHOPTS`,
 *  so a value with a space would silently corrupt the env form while the
 *  argv form stayed correct. */
const SSH_OPT_PAIRS = [
  ["BatchMode", "yes"],
  ["ServerAliveInterval", "10"],
  ["ServerAliveCountMax", "3"],
  ["ConnectTimeout", "10"],
] as const;

/** The policy as an ssh `-o Key=Value` argv, for the ssh commands this
 *  package spawns directly (agent session, probe/realise/pin). */
const SSH_COMMON_OPTS: readonly string[] = SSH_OPT_PAIRS.flatMap(
  ([key, value]) => ["-o", `${key}=${value}`],
);

/** The same policy as the `NIX_SSHOPTS` env string that `nix copy --to
 *  ssh-ng://` reads. That copy spawns its *own* ssh which never sees our
 *  argv, so this env var is the only handle on its dead-peer behaviour —
 *  without it the copy step is exposed to the exact hang `SSH_COMMON_OPTS`
 *  closes for the commands we spawn directly. */
export const NIX_SSHOPTS: string = SSH_OPT_PAIRS.map(
  ([key, value]) => `-o ${key}=${value}`,
).join(" ");

/** Argv to spawn the agent on `host` against the realised `agentPath`.
 *  Localhost runs the binary directly (no ssh round-trip); a real
 *  remote wraps in `ssh` with `SSH_COMMON_OPTS`.
 *
 *  `binary` is the executable name *inside* the realised closure (e.g.
 *  `process-monitor-agent` for the demo, `kolu-terminal-agent` for the
 *  planned R-2 consumer). The full path is `${agentPath}/bin/${binary}`. */
export function buildAgentCommand(opts: {
  host: string;
  agentPath: string;
  binary: string;
}): { command: string; args: string[] } {
  const exe = `${opts.agentPath}/bin/${opts.binary}`;
  if (isLocalHost(opts.host)) {
    return { command: exe, args: ["--stdio"] };
  }
  return {
    command: "ssh",
    args: [...SSH_COMMON_OPTS, opts.host, exe, "--stdio"],
  };
}

/** Argv to run a one-shot command against `host`. Localhost runs the
 *  command directly; remote wraps in `ssh` with `SSH_COMMON_OPTS` — same
 *  dead-peer fast-fail as the agent session (see `SSH_COMMON_OPTS` for
 *  why a "one-shot" realise needs it just as much as a long-lived link).
 *
 *  Used for `nix-instantiate --eval` arch probes and `nix-store
 *  --realise` invocations that need to round-trip and return. */
export function buildSshProbeCommand(
  host: string,
  ...remoteArgv: readonly [string, ...string[]]
): { command: string; args: string[] } {
  if (isLocalHost(host)) {
    const [cmd, ...rest] = remoteArgv;
    return { command: cmd, args: rest };
  }
  return {
    command: "ssh",
    args: [...SSH_COMMON_OPTS, host, ...remoteArgv],
  };
}
