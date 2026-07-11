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
import type { TerminalId } from "kolu-common/surface";

/** The routing payload carried on an attention notification. `kind` is the
 *  discriminant the single `notify.onClick` router switches on; `host` is the
 *  encoded host key the click switches to before focusing. */
export type AttentionClick =
  | { kind: "terminal"; host: string; terminalId: TerminalId }
  | { kind: "host"; host: string; id: string };

/** Validate a click envelope the framework relays (a live postMessage or a
 *  cold-start URL param). A stale notification from before an app upgrade, or a
 *  `{}` a degraded worker substitutes, fails this and is dropped — never routed
 *  to `deps.focusTerminal(undefined)`. */
function parseAttentionClick(data: unknown): AttentionClick | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const d = data as Record<string, unknown>;
  if (d.kind === "terminal") {
    if (typeof d.host !== "string" || typeof d.terminalId !== "string") {
      return undefined;
    }
    return {
      kind: "terminal",
      host: d.host,
      terminalId: d.terminalId as TerminalId,
    };
  }
  if (d.kind === "host") {
    if (typeof d.host !== "string" || typeof d.id !== "string")
      return undefined;
    return { kind: "host", host: d.host, id: d.id };
  }
  return undefined;
}

/** The app-wide notification seam (module singleton — created once, shared). */
export const notify = createNotify<AttentionClick>(parseAttentionClick);
