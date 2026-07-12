/** Pure, side-effect-free presentation for kolu-server's binding to padi — the
 *  `padiLink` → tone/label table the host-chip dot and the Padi dialog read.
 *
 *  Mirrors kaval's `daemonPresentation`: the padi status dot is the padiLink sibling
 *  of {@link kavalDot}, floored on transport liveness the same way (a dead
 *  browser↔kolu-server ws leaves the retained `padiLink` STALE, so the dot reads the
 *  grey "unknown" tone rather than a definite verdict painted off a value the dead
 *  channel can no longer confirm). Reuses `toneDot` + `DAEMON_UNKNOWN_DOT` from
 *  `daemonPresentation` so the padi and kaval dots can't drift on what
 *  "ok/warming/down/unknown" looks like. */

import type { PadiIdentity } from "@kolu/padi/surface";
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
 *  anomaly). `buildCommit` is MANDATORY here — but nullable: a `null` is padi's OWN
 *  DECLARED fact ("this build has no commit", a dev/off-nix build), never a
 *  placeholder for "not sampled yet". That absence is a DIFFERENT state entirely —
 *  the whole per-host `identity` cell reading `undefined` (not yet arrived) — which
 *  {@link toPadiPresence} floors to `warming`, never `connected`. So "connected but
 *  identity unknown" stays IMPOSSIBLE TO CONSTRUCT, while "connected with a
 *  DECLARED-null commit" is legal and distinct — see `padiPresentation.test-d.ts`'s
 *  pins for both. */
export type PadiIdentityView = {
  buildCommit: string | null;
  surfaceVersion: string;
  convergence: PadiConvergence | null;
  /** padi's lifetime policy (`forever` in production; `boundToPid` under a
   *  test/smoke run) — surfaced for the Padi dialog's lifetime row. A live padi
   *  seeds it; `undefined` for a survivor padi predating the wire field, which the
   *  row renders as "—". */
  lifetime: PadiIdentity["lifetime"];
};

/** The Padi dialog/rail's own honest presence sum — narrower than the raw wire facts
 *  (`padiLink` + padi's per-host `identity` cell), which the dialog used to read
 *  directly with `??`/ternary fallbacks to "unknown"/"—"/"unavailable" even while
 *  `padiLink` read `connected` (the P4 escape hatch this type retires). `identity` is
 *  MANDATORY on the `connected` arm, so "connected but identity unknown" is
 *  IMPOSSIBLE TO CONSTRUCT — see `padiPresentation.test.ts`'s `@ts-expect-error` pin.
 *  Every render site must go through {@link toPadiPresence}, never read
 *  `padiLink`/the identity cell's raw value etc. directly. */
export type PadiPresence =
  | { kind: "connected"; identity: PadiIdentityView }
  | { kind: "warming" }
  | { kind: "down" };

/** Project the raw wire facts into the client's own honest {@link PadiPresence} — the
 *  ONE place "connected" is decided. Floored on `live` (the browser↔kolu-server ws
 *  liveness) exactly like {@link padiDot}: a dead/half-open channel can't confirm ANY
 *  state, so it folds to `warming` (never a stale "connected" claim over a value the
 *  dead channel can no longer refresh).
 *
 *  `identity` is the ACTIVE host's per-host `identity` cell value (`padiMap.useEntry
 *  (activeHost).cells.identity`) — `undefined` means the cell hasn't arrived over the
 *  wire yet (a genuinely PENDING state, "still learning who this is") and folds to
 *  `warming`, exactly like a not-yet-landed identity sampler tick used to. This is
 *  DELIBERATELY a single object parameter, not two nullable strings: `identity.commit`
 *  being `null` is padi's OWN DECLARED "no commit" fact (a dev/off-nix build) and
 *  reads as `connected` — the two "unknown"s (pending vs declared-null) can never be
 *  conflated by a `??` because they are different TYPES here (absent object vs a
 *  present object with a null field), not the same nullable string. */
export function toPadiPresence(
  link: PadiLink | undefined,
  live: boolean,
  identity:
    | {
        commit: string | null;
        surfaceVersion: string;
        lifetime?: PadiIdentity["lifetime"];
      }
    | undefined,
  convergence: PadiConvergence | null,
): PadiPresence {
  if (!live || link === undefined || link === "connecting")
    return { kind: "warming" };
  if (link === "degraded") return { kind: "down" };
  // link === "connected": the identity cell PENDING (not yet arrived) is a genuinely
  // unknown state, never a synthesized "connected with no commit" — fold to warming.
  if (identity === undefined) return { kind: "warming" };
  return {
    kind: "connected",
    identity: {
      buildCommit: identity.commit,
      surfaceVersion: identity.surfaceVersion,
      convergence,
      lifetime: identity.lifetime,
    },
  };
}

/** The Padi host-chip REMOTE-HOST segment — names WHERE padi is and reads as
 *  remote. `boundHost` is `daemonScanBoundHost()`: the ssh host kolu-server's padi
 *  is bound to (`KOLU_PADI_HOST`), or `null` for a LOCAL binding. Returns the
 *  `ssh · <host>` label ONLY when bound remotely, and `null` when local — so the
 *  local chip stays byte-identical (no host noise). One source of truth for the
 *  chip render AND its tooltip fragment, tested pure. */
export function padiBoundHostSegment(boundHost: string | null): string | null {
  return boundHost ? `ssh · ${boundHost}` : null;
}
