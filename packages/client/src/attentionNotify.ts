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
 *  (a `host` payload can never be read as a `terminal` one, or vice versa). */

import { createNotify } from "@kolu/surface-app/notify";
import type { TerminalId } from "kolu-common/surface";

/** The routing payload carried on an attention notification. `kind` is the
 *  discriminant the single `notify.onClick` router switches on. */
export type AttentionClick =
  | { kind: "terminal"; terminalId: TerminalId }
  | { kind: "host"; host: string; id: string };

/** The app-wide notification seam (module singleton — created once, shared). */
export const notify = createNotify<AttentionClick>();
