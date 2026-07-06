/** Pure, side-effect-free presentation for kolu-server's binding to padi — the
 *  `padiLink` → tone/label table the rail dot and the Padi dialog read.
 *
 *  Mirrors kaval's `daemonPresentation`: the padi rail dot is the padiLink sibling
 *  of {@link kavalDot}, floored on transport liveness the same way (a dead
 *  browser↔kolu-server ws leaves the retained `padiLink` STALE, so the dot reads the
 *  grey "unknown" tone rather than a definite verdict painted off a value the dead
 *  channel can no longer confirm). Reuses `toneDot` + `DAEMON_UNKNOWN_DOT` from
 *  `daemonPresentation` so the padi and kaval dots can't drift on what
 *  "ok/warming/down/unknown" looks like. */

import type { PadiLink } from "kolu-common/surface";
import {
  DAEMON_UNKNOWN_DOT,
  type DaemonTone,
  toneDot,
} from "../kaval/daemonPresentation";

/** The single source of truth for "what does `padiLink` state X mean visually."
 *  One row per state, keyed by `PadiLink`, so a new link state is a compile-forced
 *  row rather than N scattered edits. `connecting` warms (the binding is
 *  (re)establishing), `connected` is healthy, `degraded` is down — an honest
 *  unhealthy pip when padi has dropped, never a fake green. */
export const PADI_LINK_PRESENTATION: Record<
  PadiLink,
  { tone: DaemonTone; label: string }
> = {
  connecting: { tone: "warming", label: "connecting…" },
  connected: { tone: "ok", label: "connected" },
  degraded: { tone: "down", label: "disconnected" },
};

/** The `padi` status dot's tone class, FLOORED on transport liveness — the
 *  `padiLink` sibling of {@link kavalDot}. `link` is the active host's binding-to-padi
 *  state, projected from the padi `connection` cell through
 *  `padiLinkState()`/`connectionToPadiLink`; `live` is the watchdog-backed liveness
 *  of the ws that delivers it. When `live` is false (transport dead / silently
 *  half-open) the retained link value is STALE — the channel that would refresh it
 *  is gone — so the dot reads the grey "unknown" tone, NEVER a definite verdict off
 *  a value the dead channel can't confirm. A known link can only REFINE the tone
 *  WITHIN a live link; it can never claim a verdict over a dead one. */
export function padiDot(link: PadiLink | undefined, live: boolean): string {
  if (!live || !link) return DAEMON_UNKNOWN_DOT;
  return toneDot[PADI_LINK_PRESENTATION[link].tone];
}

/** The Padi rail chip's REMOTE-HOST segment — names WHERE padi is and reads as
 *  remote. `boundHost` is `daemonScanBoundHost()`: the ssh host kolu-server's padi
 *  is bound to (`KOLU_PADI_HOST`), or `null` for a LOCAL binding. Returns the
 *  `ssh · <host>` label ONLY when bound remotely, and `null` when local — so the
 *  local chip stays byte-identical (no host noise). One source of truth for the
 *  chip render AND its tooltip fragment, tested pure. */
export function padiBoundHostSegment(boundHost: string | null): string | null {
  return boundHost ? `ssh · ${boundHost}` : null;
}
