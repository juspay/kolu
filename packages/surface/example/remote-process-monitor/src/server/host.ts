/** Shared helpers for `host`-string handling — host parsing was being
 *  duplicated across `nixCopy` and `hostSession` (each module had its
 *  own `host === "localhost" || host === "127.0.0.1"` check; adding
 *  `"::1"` would have meant editing both in lockstep). One source of
 *  truth for "are we talking to ourselves?" lives here. */

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
