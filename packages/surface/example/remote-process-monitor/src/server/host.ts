/** Shared helpers for `host`-string handling — host parsing was being
 *  duplicated across `nixCopy` and `hostSession` (each module had its
 *  own `host === "localhost" || host === "127.0.0.1"` check; adding
 *  `"::1"` would have meant editing both in lockstep). One source of
 *  truth for "are we talking to ourselves?" lives here. */

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Forward every non-blank `\n`-terminated line in `chunk` to `onLine`.
 *  Used identically by `nixCopy`'s subprocess stderr forwarder and
 *  `hostSession`'s ssh-child stderr forwarder; the idiom was 3 lines
 *  pasted in two places. */
export function forEachLine(
  chunk: string,
  onLine: (line: string) => void,
): void {
  for (const line of chunk.split("\n")) {
    if (line.trim().length > 0) onLine(line);
  }
}

/** Argv to spawn the agent on `host` against the realised `agentPath`.
 *  Localhost runs the binary directly (no ssh round-trip); a real
 *  remote wraps in `ssh -o BatchMode=yes -o ServerAliveInterval=10`.
 *
 *  Separated from `HostSession.spawn`'s lifecycle code so the command
 *  shape can evolve (add `-i`, `-p`, jump hosts, a different binary
 *  name) without touching reconnect / refcount / stderr-forwarding
 *  plumbing. The file-shape twin R-2's `install.ts`'s
 *  `remoteAgentCommand(host, path?)` will take. */
export function buildAgentCommand(
  host: string,
  agentPath: string,
): { command: string; args: string[] } {
  const binary = `${agentPath}/bin/process-monitor-agent`;
  if (isLocalHost(host)) {
    return { command: binary, args: ["--stdio"] };
  }
  return {
    command: "ssh",
    args: [
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=10",
      host,
      binary,
      "--stdio",
    ],
  };
}
