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

/** Argv to spawn the agent on `host` against the realised `agentPath`.
 *  Localhost runs the binary directly (no ssh round-trip); a real
 *  remote wraps in `ssh -o BatchMode=yes -o ServerAliveInterval=10`.
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
    args: [
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=10",
      opts.host,
      exe,
      "--stdio",
    ],
  };
}
