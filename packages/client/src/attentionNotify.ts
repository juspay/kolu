/** The ONE OS-notification delivery seam for the whole client.
 *
 *  A single `createNotify` instance shared by BOTH attention paths — the
 *  cross-host path (`host/useHostAttention`) and the per-terminal activity-alert
 *  path (`terminal/useActivityAlerts` + `terminal/useTerminalAlerts`) — so the
 *  origin's ONE service worker has ONE seam (see `@kolu/surface-app/notify`),
 *  one permission request, and one tag-keyed multi-window de-dup discipline,
 *  never two hand-rolled copies of the same landmine handling.
 *
 *  The click payload is DISCRIMINATED by `kind` so a per-terminal click and a
 *  cross-host click each route to their own handler and can never cross-deliver
 *  (a `host` payload can never be read as a `terminal` one, or vice versa). BOTH
 *  variants carry the originating `host`: a notification outlives the active-host
 *  selection, so clicking one must switch back to the host it fired FOR before
 *  focusing the terminal — otherwise the id routes against whatever padi happens
 *  to be active, focusing the wrong host's terminal (or nothing). */

import { createNotify } from "@kolu/surface-app/notify";
import { decodeHostKey } from "kolu-common/hostKey";
import { type TerminalId, TerminalIdSchema } from "kolu-common/surface";

/** The routing payload carried on an attention notification. `kind` is the
 *  discriminant the single `notify.onClick` router switches on; `host` is the
 *  encoded host key the click switches to before focusing. */
export type AttentionClick =
  | { kind: "terminal"; host: string; terminalId: TerminalId }
  | { kind: "host"; host: string; id: TerminalId };

/** Whether a string is a CANONICAL encoded host key — the exact domain
 *  `decodeHostKey` accepts (`"local"` or `"remote:<target>"`). Validated at the
 *  parse boundary so a malformed `host` is DROPPED here rather than passed through to
 *  throw inside `decodeHostKey` at click time. */
function isEncodedHostKey(s: string): boolean {
  try {
    decodeHostKey(s);
    return true;
  } catch {
    return false;
  }
}

/** Validate a click envelope the framework relays (a live postMessage or a
 *  cold-start URL param). A stale notification from before an app upgrade, or a
 *  `{}` a degraded worker substitutes, fails this and is dropped — never routed
 *  to `deps.focusTerminal(undefined)`. Boundary DOMAIN validation, not just "is a
 *  string": the `host` must be a canonical encoded key (else `decodeHostKey` throws
 *  at click time) and the terminal id a real UUID (`TerminalIdSchema`), so a
 *  malformed value can never be cast to `TerminalId`/`HostKey` and routed. */
function parseAttentionClick(data: unknown): AttentionClick | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const d = data as Record<string, unknown>;
  if (d.kind === "terminal") {
    if (typeof d.host !== "string" || !isEncodedHostKey(d.host)) {
      return undefined;
    }
    const terminalId = TerminalIdSchema.safeParse(d.terminalId);
    if (!terminalId.success) return undefined;
    return {
      kind: "terminal",
      host: d.host,
      terminalId: terminalId.data as TerminalId,
    };
  }
  if (d.kind === "host") {
    if (typeof d.host !== "string" || !isEncodedHostKey(d.host)) {
      return undefined;
    }
    // `id` is a raised awaiting-terminal id — the click focuses it as a
    // `TerminalId`, so validate it as one (not merely "a string").
    const id = TerminalIdSchema.safeParse(d.id);
    if (!id.success) return undefined;
    return { kind: "host", host: d.host, id: id.data };
  }
  return undefined;
}

/** The app-wide notification seam (module singleton — created once, shared). */
export const notify = createNotify<AttentionClick>(parseAttentionClick);
