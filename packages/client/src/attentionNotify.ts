/** The ONE OS-notification delivery seam for the whole client.
 *
 *  A single `createNotify` instance owned by the ONE attention module
 *  (`attention/useAttention`) — so the origin's ONE service worker has ONE seam
 *  (see `@kolu/surface-app/notify`),
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
import { Result, Schema } from "effect";
import { isEncodedHostKey } from "kolu-common/hostKey";
import { type TerminalId, TerminalIdSchema } from "kolu-common/surface";

/** zod's `safeParse` in Effect terms — a `Result`, so a malformed id is a BRANCH
 *  (drop the envelope) rather than a throw out of the notification router. */
const decodeTerminalId = Schema.decodeUnknownResult(TerminalIdSchema);

/** The routing payload carried on an attention notification. `kind` is the
 *  discriminant the single `notify.onClick` router switches on; `host` is the
 *  encoded host key the click switches to before focusing. */
export type AttentionClick =
  | { kind: "terminal"; host: string; terminalId: TerminalId }
  | { kind: "host"; host: string; id: TerminalId };

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
  if (d.kind !== "terminal" && d.kind !== "host") return undefined;
  // BOTH variants carry the same two facts, so validate them ONCE: a canonical
  // encoded `host` (the click switches to it — else `decodeHostKey` throws at
  // click time) and a real terminal id (it focuses one — a `TerminalId`, not
  // merely "a string"). The variants differ only in that id's field NAME
  // (`terminalId` vs `id`), so only the final shape branches.
  if (typeof d.host !== "string" || !isEncodedHostKey(d.host)) return undefined;
  const idField = d.kind === "terminal" ? d.terminalId : d.id;
  const id = decodeTerminalId(idField);
  if (Result.isFailure(id)) return undefined;
  return d.kind === "terminal"
    ? { kind: "terminal", host: d.host, terminalId: id.success }
    : { kind: "host", host: d.host, id: id.success };
}

/** The app-wide notification seam (module singleton — created once, shared). */
export const notify = createNotify<AttentionClick>(parseAttentionClick);
