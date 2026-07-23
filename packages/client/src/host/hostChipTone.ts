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

/** Whether two `HostKey`s name the SAME host — compared by their CANONICAL
 *  string (`encodeHostKey`), never `===`. */
export function sameHost(a: HostKey, b: HostKey): boolean {
  return encodeHostKey(a) === encodeHostKey(b);
}

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

export function hostGlance(
  status: EntryState<{ reason: string }> | EntryState,
): HostGlance {
  const row = GLANCE[status.kind];
  const title =
    typeof row.title === "function"
      ? row.title(status as EntryState<{ reason: string }>)
      : row.title;
  return {
    stripDot: row.stripDot,
    detailDot: row.detailDot,
    down: row.down,
    short: row.short,
    title,
    labelDecoration: row.labelDecoration,
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
): string {
  const g = hostGlance(status);
  return g.stripDot ?? g.detailDot;
}
