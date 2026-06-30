/**
 * `localOnly` — the per-`HostLocation` seam for host-served FILE IO that is not
 * yet routed to a remote host (R9.5 / PR-2): the preview byte route, paste/upload
 * (`scratch.write`), and transcript export. Sibling to `resolveTerminalEndpoint`
 * (the PTY/fs-endpoint seam) — same idea, a different concern.
 *
 * Run the `local` arm for a `{kind:"local"}` terminal (today's local-disk path,
 * verbatim); for a `{kind:"remote"}` terminal CRASH LOUDLY rather than serve it
 * off the wrong (local) host's fs — the no-fallbacks stance. F-REMOTE replaces
 * the throw with the host-mirror dial (`fs.previewRead` / `scratch.write` /
 * `transcript.read` over the remote pulam). `.exhaustive()` forces a deliberate
 * arm, so a new `HostLocation` variant is a compile error here.
 *
 * Local-only today: every terminal carries `{kind:"local"}`, so the `remote`
 * arm is unreachable until F-REMOTE dials one — reaching it is a contract
 * violation, not a degraded path.
 */

import type { HostLocation } from "kolu-common/surface";
import { match } from "ts-pattern";

export function localOnly<T>(
  location: HostLocation,
  op: string,
  local: () => T,
): T {
  return match(location)
    .with({ kind: "local" }, local)
    .with({ kind: "remote" }, ({ hostId }) => {
      throw new Error(`${op} for remote host "${hostId}" lands in F-REMOTE`);
    })
    .exhaustive();
}
