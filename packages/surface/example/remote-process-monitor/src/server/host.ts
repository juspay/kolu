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
