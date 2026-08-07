/**
 * Host-chip connection tone + labels, derived from the keyed map's projected
 * `EntryStatus`. Pure (no JSX, no `wire`), so strip/popover/mobile render with
 * them and unit pins import them without dragging in the live transport.
 *
 * Strip pips ({@link chipStatusDot}): always-on for every host (green/amber/red),
 * fact-only — the open control for the diagnostics popover. Identity is separate
 * (Home + machine hostname for local; ssh target for remote). Diagnostics
 * header uses {@link HostGlance.detailDot} (same palette).
 */

import type { EntryState } from "@kolu/surface-map";
import { hostHueFor } from "kolu-common/hostHue";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  DAEMON_STATE_PRESENTATION,
  type KavalPresence,
} from "../kaval/daemonPresentation";

/** The host's identity hue (a palette hex). */
export function hostHue(host: HostKey): string {
  return hostHueFor(encodeHostKey(host));
}

/** Render a `HostKey` as its human display label.
 *  Local is the literal `"local"` (key identity) — the strip paints the
 *  machine hostname via {@link useServerIdentity} + Home icon instead. */
export function hostLabel(h: HostKey): string {
  return h.kind === "local" ? "local" : h.target;
}

/** On-screen name for tooltips/aria: machine hostname when known for local,
 *  else {@link hostLabel}. */
export function hostDisplayName(
  h: HostKey,
  serverHostname: string | undefined,
): string {
  if (h.kind === "local") return serverHostname ?? hostLabel(h);
  return hostLabel(h);
}

/** One glance fold of entry state — strip + detail + labels co-defined so a
 *  fifth kind cannot update one projection and leave another lying. */
export type HostGlance = {
  /** Exception-only strip pip class, or null when healthy (paint nothing). */
  stripDot: string | null;
  /** Always-on pip for detail surfaces (popover header); green only when connected. */
  detailDot: string;
  /** Unreachable / failed — desaturate + strike. */
  down: boolean;
  /** Compact one-word label (switcher subline, popover state row). */
  short: string;
  /** Tooltip / a11y line (includes failure reason when failed). */
  title: string;
  /** Extra class on the label span when down. */
  labelDecoration: string;
};

const STRIKE = " line-through decoration-red-400/80 decoration-1";

/** Exhaustive kind→glance table. A fifth kind is a compile error here. */
const GLANCE: Record<
  EntryState["kind"],
  Omit<HostGlance, "title"> & {
    title: string | ((s: EntryState<{ reason: string }>) => string);
  }
> = {
  connected: {
    stripDot: null,
    detailDot: "bg-emerald-400",
    down: false,
    short: "connected",
    title: "connected",
    labelDecoration: "",
  },
  warming: {
    stripDot: "bg-amber-400 animate-pulse motion-reduce:animate-none",
    detailDot: "bg-amber-400",
    down: false,
    short: "connecting",
    title: "connecting…",
    labelDecoration: "",
  },
  failed: {
    stripDot: "bg-red-400",
    detailDot: "bg-red-400",
    down: true,
    short: "unreachable",
    title: (s) =>
      s.kind === "failed" ? `failed: ${s.failure.reason}` : "failed",
    labelDecoration: STRIKE,
  },
  "not-a-member": {
    stripDot: "bg-fg-3/40",
    detailDot: "bg-fg-3/40",
    down: false,
    short: "removed",
    title: "not a member",
    labelDecoration: "",
  },
};

/**
 * What a host's KAVAL — the terminal daemon behind its padi — can be said to be
 * doing, as the host-entry fold needs it. Four arms, because "we do not know" and
 * "it is coming up" are not the same claim as "it is fine".
 */
export type KavalChain =
  /** Connected and answering: the daemon chain is whole. */
  | { readonly kind: "serving" }
  /** Coming up or being recycled — not serving YET, and not a failure. */
  | { readonly kind: "starting"; readonly verdict: string }
  /** Dead, stopped, or contract-incompatible — this host cannot run terminals. */
  | { readonly kind: "down"; readonly verdict: string }
  /** No verdict is in hand: the status channel is not live, or nothing has been
   *  published yet. The honest answer is silence — never green. */
  | { readonly kind: "unknown" };

/** The only value a caller with genuinely no kaval reader may pass. Named so the
 *  sites that pass it are greppable, and so "I did not look" can never be
 *  mistaken for "I looked and it was fine". */
export const KAVAL_CHAIN_UNKNOWN: KavalChain = { kind: "unknown" };

/** Project the client's existing kaval PRESENCE (the same fold the kaval
 *  sub-chip and the degraded canvas read) into the chain arm the host dot needs.
 *  Reuses `DAEMON_STATE_PRESENTATION`'s labels rather than minting a second
 *  vocabulary for the same six daemon states. */
export function kavalChainOf(presence: KavalPresence): KavalChain {
  switch (presence.kind) {
    case "connected":
      return { kind: "serving" };
    case "warming":
      return {
        kind: "starting",
        verdict: DAEMON_STATE_PRESENTATION[presence.state].label,
      };
    case "down":
      return {
        kind: "down",
        verdict: DAEMON_STATE_PRESENTATION[presence.state].label,
      };
    case "incompatible":
      return {
        kind: "down",
        verdict: DAEMON_STATE_PRESENTATION.incompatible.label,
      };
    case "unknown":
      return KAVAL_CHAIN_UNKNOWN;
  }
}

/**
 * THE composition policy for a host's presented state (juspay/kolu#2101 N4).
 *
 * The field contradiction this exists to end: the incident's host dot stayed
 * GREEN while the workspace was dead. Nothing lied — the dot reported padi's own
 * link, which was genuinely up — but a host entry is the head of a CHAIN (padi →
 * kaval → your terminals), and a presented state that reports one link of a chain
 * as if it were the chain is a lie of aggregation. The user does not have a
 * relationship with padi; they have one with the workspace behind it.
 *
 * The policy, and the reasons for each half:
 *
 *  - The kaval verdict is composed **only onto a `connected` entry.** On
 *    `warming`/`failed`/`not-a-member` the entry's own tone is already the whole
 *    truth, and the kaval verdict reaching us through THAT entry is by definition
 *    stale — a host we cannot reach cannot tell us about its daemon.
 *  - `serving` and `unknown` leave the entry's own row untouched. "We know it is
 *    fine" and "we know nothing" must not be spelled the same way, and the way to
 *    spell "we know nothing" is to make no additional claim, not to invent one.
 *  - A degraded chain is **amber, not red, and not `down`.** Red and the
 *    strike-through are this vocabulary's word for "unreachable" — a host with a
 *    dead kaval is perfectly reachable, and its padi will answer, restart the
 *    daemon (#2101 N1), and restore the session. Painting it as unreachable would
 *    trade one wrong dot for another.
 *  - The verdict is NAMED in `short` and `title`, never merely coloured: a
 *    tooltip that says "connected" over a dead workspace is how the incident
 *    happened.
 */
export function hostGlance(
  status: EntryState<{ reason: string }> | EntryState,
  kaval: KavalChain,
): HostGlance {
  const row = GLANCE[status.kind];
  const title =
    typeof row.title === "function"
      ? row.title(status as EntryState<{ reason: string }>)
      : row.title;
  const base: HostGlance = {
    stripDot: row.stripDot,
    detailDot: row.detailDot,
    down: row.down,
    short: row.short,
    title,
    labelDecoration: row.labelDecoration,
  };
  if (status.kind !== "connected") return base;
  if (kaval.kind === "serving" || kaval.kind === "unknown") return base;
  const pulse =
    kaval.kind === "starting"
      ? " animate-pulse motion-reduce:animate-none"
      : "";
  return {
    ...base,
    stripDot: `bg-amber-400${pulse}`,
    detailDot: `bg-amber-400${pulse}`,
    // NOT `down`: the host is reachable and its padi is answering. See the policy.
    down: false,
    short: kaval.kind === "down" ? "kaval down" : "kaval starting",
    title: `connected — kaval ${kaval.verdict}`,
    labelDecoration: "",
  };
}

/**
 * Always-on status pip for strip/mobile chips: green when connected, amber
 * pulse when warming, red when failed. Prefer `stripDot` so warming keeps its
 * pulse; fall back to `detailDot` for the healthy green.
 */
export function chipStatusDot(
  _host: HostKey,
  status: EntryState<{ reason: string }> | EntryState,
  kaval: KavalChain,
): string {
  const g = hostGlance(status, kaval);
  return g.stripDot ?? g.detailDot;
}

/** Always-on connection tone for non-strip surfaces (palette host lead).
 *  Same fact fold as {@link chipStatusDot}; host identity is irrelevant. */
export function dotClass(status: EntryState, kaval: KavalChain): string {
  return chipStatusDot({ kind: "local" }, status, kaval);
}

/** Tooltip / a11y title from {@link hostGlance}. */
export function statusTitle(
  status: EntryState<{ reason: string }> | EntryState,
  kaval: KavalChain,
): string {
  return hostGlance(status, kaval).title;
}

/** Compact one-word label from {@link hostGlance}.short. */
export function statusLabelShort(
  status: EntryState,
  kaval: KavalChain,
): string {
  return hostGlance(status, kaval).short;
}

/** Context line for a host palette row — quiet when healthy, not canvas-active.
 *
 *  Vocabulary:
 *  - **active** — this host is the canvas's current host (only one)
 *  - **(empty)** — connected and not active (connected is the default; no noise)
 *  - **connecting** / **unreachable** / **removed** — exception states only
 *
 *  Dot color still comes from {@link dotClass}; this is the text slot only. */
export function hostRowContext(
  status: EntryState,
  isCanvasActive: boolean,
  kaval: KavalChain = KAVAL_CHAIN_UNKNOWN,
): string {
  if (isCanvasActive) return "active";
  // A connected entry with a degraded chain has a word for itself now ("kaval
  // down"), so the quiet-when-healthy rule narrows to "quiet when the WHOLE chain
  // is healthy". A caller with no kaval reader in scope (the fleet-action list,
  // built outside a reactive owner) passes nothing and gets the old behaviour —
  // a text slot, never the dot, so it can under-report but never mis-colour.
  const glance = hostGlance(status, kaval);
  if (status.kind === "connected" && kaval.kind !== "down") return "";
  return glance.short;
}
