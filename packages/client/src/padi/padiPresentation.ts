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

import type { PadiConvergence, PadiLink } from "kolu-common/surface";
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
 *  `padiLink` sibling of {@link kavalDot}. `link` is kolu-server's binding-to-padi
 *  state off koluSurface's `padiLink` cell; `live` is the watchdog-backed liveness
 *  of the ws that delivers it. When `live` is false (transport dead / silently
 *  half-open) the retained link value is STALE — the channel that would refresh it
 *  is gone — so the dot reads the grey "unknown" tone, NEVER a definite verdict off
 *  a value the dead channel can't confirm. A known link can only REFINE the tone
 *  WITHIN a live link; it can never claim a verdict over a dead one. */
export function padiDot(link: PadiLink | undefined, live: boolean): string {
  if (!live || !link) return DAEMON_UNKNOWN_DOT;
  return toneDot[PADI_LINK_PRESENTATION[link].tone];
}

/** padi's honest identity, once known — the fields the Padi dialog shows for a
 *  `connected` bind (build commit, contract/surface version, standing convergence
 *  anomaly). `buildCommit` is MANDATORY here (unlike the raw `daemonInventory.boundPadi`
 *  cell, whose `buildCommit` is nullable): {@link toPadiPresence} is the ONE place that
 *  decides what "connected but no build commit yet" means, so a render site can never
 *  see a `connected` {@link PadiPresence} with an absent build commit. */
export type PadiIdentity = {
  buildCommit: string;
  surfaceVersion: string | null;
  convergence: PadiConvergence | null;
};

/** The Padi dialog/rail's own honest presence sum — narrower than the raw wire facts
 *  (`padiLink` + `daemonInventory.boundPadi.*`), which the dialog used to read directly
 *  with `??`/ternary fallbacks to "unknown"/"—"/"unavailable" even while `padiLink` read
 *  `connected` (the P4 escape hatch this type retires). `identity` is MANDATORY on the
 *  `connected` arm, so "connected but identity unknown" is IMPOSSIBLE TO CONSTRUCT — see
 *  `padiPresentation.test.ts`'s `@ts-expect-error` pin. Every render site must go through
 *  {@link toPadiPresence}, never read `padiLink`/`boundPadiBuildCommit()` etc. directly. */
export type PadiPresence =
  | { kind: "connected"; identity: PadiIdentity }
  | { kind: "warming" }
  | { kind: "down" };

/** Project the raw wire facts into the client's own honest {@link PadiPresence} — the
 *  ONE place "connected" is decided. Floored on `live` (the browser↔kolu-server ws
 *  liveness) exactly like {@link padiDot}: a dead/half-open channel can't confirm ANY
 *  state, so it folds to `warming` (never a stale "connected" claim over a value the dead
 *  channel can no longer refresh). A `connected` link whose identity sample hasn't landed
 *  yet (the sampler ticks separately from the link's own connect) ALSO folds to
 *  `warming` — "still learning who this is" — rather than showing `connected` beside a
 *  synthesized dash; the identity typically arrives within one sampler tick (≤10s, see
 *  `server/src/daemonInventory.ts`'s `DAEMON_INVENTORY_SAMPLE_INTERVAL_MS`), so this is a
 *  brief, honest transitional window, never a permanent lie. */
export function toPadiPresence(
  link: PadiLink | undefined,
  live: boolean,
  buildCommit: string | null,
  surfaceVersion: string | null,
  convergence: PadiConvergence | null,
): PadiPresence {
  if (!live || link === undefined || link === "connecting")
    return { kind: "warming" };
  if (link === "degraded") return { kind: "down" };
  // link === "connected"
  if (buildCommit === null) return { kind: "warming" };
  return {
    kind: "connected",
    identity: { buildCommit, surfaceVersion, convergence },
  };
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
