/** Helpers for `host`-string handling shared between `provisionAgent`
 *  (nix copy) and `HostSession` (ssh subprocess spawn). Keeps the
 *  "are we talking to ourselves?" check and the per-line stderr fanout
 *  in one place so they evolve together. */

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
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

/** ssh options shared by *every* non-interactive ssh this package
 *  spawns — the long-lived agent session and the one-shot
 *  probe/realise/pin commands alike. They split into two jobs:
 *
 *   - `BatchMode=yes` — never block on a password/passphrase prompt.
 *   - `ServerAliveInterval` / `ServerAliveCountMax` + `ConnectTimeout` —
 *     make ssh detect a *dead peer* and exit non-zero instead of
 *     blocking forever on a half-open connection.
 *
 *  That second job is load-bearing for the one-shot commands too, which
 *  is why these opts are no longer agent-only. `nix-store --realise`
 *  over ssh is a *remote build*, not a quick round-trip: the channel can
 *  sit idle for minutes while the far end compiles. If the host degrades
 *  mid-realise (network drop, sshd wedge, box overload), an ssh with no
 *  keepalive parks on the half-open socket until the OS TCP stack gives
 *  up — effectively forever — and wedges the caller's spawn cycle in
 *  `copying`/`connecting` with no recovery. The keepalive turns that
 *  eternity into a bounded ~Interval×CountMax (≈30s) failure the
 *  reconnect loop can retry.
 *
 *  Crucially this does NOT cap a healthy-but-slow build: ssh keepalives
 *  ride the protocol layer independently of channel data, so a
 *  responsive sshd answers them no matter how long the build's stdout
 *  stays quiet. Only an actually-unresponsive peer trips the limit. */
const SSH_COMMON_OPTS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ServerAliveInterval=10",
  "-o",
  "ServerAliveCountMax=3",
  "-o",
  "ConnectTimeout=10",
] as const;

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
