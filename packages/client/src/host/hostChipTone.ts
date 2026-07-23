/**
 * Host-chip connection tone + labels, derived from the keyed map's projected
 * `EntryStatus`. Pure (no JSX, no `wire`), so strip/popover/mobile render with
 * them and unit pins import them without dragging in the live transport.
 *
 * Strip pips (via {@link chipStatusDot}):
 *   · **local** — exception-only (house glyph is identity; green "fine" is silent)
 *   · **remote** — always-on connection status (green/amber/red), fact-only
 * Diagnostics popover always uses {@link HostGlance.detailDot}.
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

/** Render a `HostKey` as its human display label. */
export function hostLabel(h: HostKey): string {
  return h.kind === "local" ? "local" : h.target;
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
 * Status pip class for a strip/mobile chip. Local is exception-only (null when
 * healthy — the house glyph carries identity). Remote is unconditional: green
 * when connected, amber pulse when warming, red when failed.
 */
export function chipStatusDot(
  host: HostKey,
  status: EntryState<{ reason: string }> | EntryState,
): string | null {
  const g = hostGlance(status);
  if (host.kind === "local") return g.stripDot;
  // Remote: always paint. Prefer stripDot so warming keeps its pulse class.
  return g.stripDot ?? g.detailDot;
}
