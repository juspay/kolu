/**
 * Host-chip connection tone + labels, derived from the keyed map's projected
 * `EntryStatus`. Pure (no JSX, no `wire`), so `HostSelectorStrip.tsx` renders
 * with them and the unit pin imports them without dragging in the live transport.
 *
 * Exception-based: a healthy connected host paints NO status dot on the strip
 * (silence = fine). Amber pulse = warming/connecting; red = failed/unreachable.
 * Green "everything is fine" dots are deleted, not restyled.
 */

import type { EntryState } from "@kolu/surface-map";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { hostHueFor } from "kolu-common/hostHue";

/** Whether two `HostKey`s name the SAME host — compared by their CANONICAL
 *  string (`encodeHostKey`), never `===`: a `HostKey` is an object with no
 *  reference identity across independent decodes (`entries.use().keys()`
 *  mints a FRESH object every membership read, and zod's `.parse` mints a
 *  fresh object even for an already-valid input), so two logically-equal
 *  keys are almost never the same reference. A chip's active-highlight AND
 *  its click guard (a no-op click on the ALREADY-active chip must not
 *  re-write `activeHost` with a new-reference-but-equal key — that would
 *  needlessly re-notify every `useEntry(activeHost)` consumer) both compare
 *  through this ONE function. */
export function sameHost(a: HostKey, b: HostKey): boolean {
  return encodeHostKey(a) === encodeHostKey(b);
}

/** The host's identity hue (a palette hex) — the accent each tab wears so a host
 *  reads as a *place*, not just a label. Seeded on the CANONICAL host string
 *  (`encodeHostKey`), so it's stable across the fresh `HostKey` objects every
 *  membership read mints, and drawn from the SAME palette + hash the server's
 *  PWA `theme-color` uses (`kolu-common/hostHue`) — one host, one colour, on
 *  every surface. This is host IDENTITY, distinct from the connection dot's
 *  exception tone (amber/red), which stays fact-driven. */
export function hostHue(host: HostKey): string {
  return hostHueFor(encodeHostKey(host));
}

/** Render a `HostKey` as its human display label — the LOCAL default reads
 *  "local"; a remote reads its ssh target. The ONE source of truth for a host's
 *  chip / dialog / tooltip label, shared by `HostSelectorStrip` and
 *  `HostDaemonChips` (it was hand-rolled identically in both). */
export function hostLabel(h: HostKey): string {
  return h.kind === "local" ? "local" : h.target;
}

/**
 * Exception-based strip status: `null` when healthy (paint nothing), otherwise
 * a tailwind fill class. Amber pulse for warming/connecting; red for failed.
 * `motion-reduce:animate-none` keeps the pulse off under
 * `prefers-reduced-motion` (static amber, still the exception signal).
 *
 * A pure kind→tone lookup as a `Record` keyed on the full `EntryState["kind"]`
 * union — adding a fifth displayed kind is a compile error here (exhaustive by
 * construction), not a silent fall-through to a `default` a `switch` would hide.
 */
const EXCEPTION_DOT: Record<EntryState["kind"], string | null> = {
  connected: null, // healthy = silent
  warming: "bg-amber-400 animate-pulse motion-reduce:animate-none",
  failed: "bg-red-400",
  "not-a-member": "bg-fg-3/40",
};
export function exceptionDotClass(status: EntryState): string | null {
  return EXCEPTION_DOT[status.kind];
}

/**
 * Always-on tone for surfaces that still need a permanent status pip (e.g. a
 * popover header). Green only for `connected` — fact-only, same discipline as
 * `<HostStatusPip>`. Prefer {@link exceptionDotClass} on the strip itself.
 */
const DOT_TONE: Record<EntryState["kind"], string> = {
  connected: "bg-emerald-400",
  warming: "bg-amber-400",
  failed: "bg-red-400",
  "not-a-member": "bg-fg-3/40",
};
export function dotClass(status: EntryState): string {
  return DOT_TONE[status.kind];
}

/** Unreachable / failed — desaturate the chip and strike the label. */
export function isHostDown(status: EntryState): boolean {
  return status.kind === "failed";
}

/** A one-line human note for the chip's `title` — the failure reason when failed.
 *  Reads only the failure's human `reason` (PR4: the reason folds into the
 *  schema-valid domain `failure` value), so it's typed to that minimal shape and
 *  stays domain-agnostic. */
export function statusTitle(status: EntryState<{ reason: string }>): string {
  switch (status.kind) {
    case "connected":
      return "connected";
    case "warming":
      return "connecting…";
    case "failed":
      return `failed: ${status.failure.reason}`;
    default:
      return "not a member";
  }
}

// Terse one-word entry-state labels for the host-switcher row + diagnostics
// popover. A `Record` keyed on the full `EntryState["kind"]` union, like
// `EXCEPTION_DOT` above: a fifth kind is a compile error here.
const STATUS_LABEL_SHORT: Record<EntryState["kind"], string> = {
  connected: "connected",
  warming: "connecting",
  failed: "unreachable",
  "not-a-member": "removed",
};
export function statusLabelShort(status: EntryState): string {
  return STATUS_LABEL_SHORT[status.kind];
}
