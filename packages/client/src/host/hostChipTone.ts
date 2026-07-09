/**
 * The host chip's connection-dot tone + hover title, derived from the keyed map's
 * projected `EntryStatus`. Pure (no JSX, no `wire`), so `HostSelectorStrip.tsx` renders
 * with them and the unit pin imports them without dragging in the live transport.
 */

import type { EntryState } from "@kolu/surface-map";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { HostMapGate } from "kolu-common/surface";

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

/** Render a `HostKey` as its human display label — the LOCAL default reads
 *  "local"; a remote reads its ssh target. The ONE source of truth for a host's
 *  chip / dialog / tooltip label, shared by `HostSelectorStrip` and
 *  `HostDaemonChips` (it was hand-rolled identically in both). */
export function hostLabel(h: HostKey): string {
  return h.kind === "local" ? "local" : h.target;
}

/** The gate DECISION — whether MULTIPLE-host chrome (the guest chips beyond the
 *  active one, plus the "+ add a host" affordance) renders. The strip itself is
 *  NEVER gated off entirely any more (W4 header redesign — "gate-off consistent
 *  with gate-on"): a single always-visible host chip, carrying the Padi/Kaval
 *  sub-chips, is the header's resting state whether or not the gate is open —
 *  see {@link shouldRenderHostChip}. `undefined` (before the first cell frame)
 *  reads CLOSED, so multi-host chrome never flashes in during warm-up. */
export function hostGateOpen(gate: HostMapGate | undefined): boolean {
  return gate?.enabled === true;
}

/** Whether a GIVEN host's chip renders. The active host's chip is ALWAYS shown
 *  (it is the header's one mandatory status chip, carrying the Padi/Kaval
 *  sub-chips) regardless of the gate; every other pool member's chip — and the
 *  "+ add" affordance beside them — is MULTIPLE-host chrome, shown only when
 *  {@link hostGateOpen}. With the gate closed the pool has no member but the
 *  local default anyway (env-unset boot never seeds a guest), so this reduces to
 *  "show exactly the local chip" — but the predicate holds even in a transient
 *  gate-closed-with-a-stray-guest state, rather than assuming that invariant. */
export function shouldRenderHostChip(
  gateOpen: boolean,
  isActive: boolean,
): boolean {
  return gateOpen || isActive;
}

/** The connection dot's tailwind tone. Green (`bg-emerald-400`) is emitted ONLY for
 *  `connected` — fact-only, the same discipline `<HostStatusPip>` enforces for a
 *  surface's `health()`. A map entry's equivalent fact is its `EntryStatus`, which
 *  `connectSurfaceMap` floors on real transport liveness, so a green-over-a-dead-host
 *  dot is unrenderable. */
// A pure kind→tone lookup as a `Record` keyed on the full `EntryState["kind"]` union — so
// adding a fourth displayed kind is a compile error here (exhaustive by construction), not a
// silent fall-through to the `default` a `switch` would hide.
const DOT_TONE: Record<EntryState["kind"], string> = {
  connected: "bg-emerald-400", // live — the map floors this on transport liveness
  warming: "bg-amber-400", // copying / connecting / pre-clock-offset — coming up
  failed: "bg-red-400", // provisioning or link failed
  "not-a-member": "bg-fg-3/40", // unreached — we only render members
};
export function dotClass(status: EntryState): string {
  return DOT_TONE[status.kind];
}

/** A one-line human note for the dot's `title` — the failure reason when failed. */
export function statusTitle(status: EntryState): string {
  switch (status.kind) {
    case "connected":
      return "connected";
    case "warming":
      return "connecting…";
    case "failed":
      return `failed: ${status.reason}`;
    default:
      return "not a member";
  }
}

// Terse one-word entry-state labels for the host-switcher row's status subline —
// the compact sibling of `statusTitle` (which carries the fuller tooltip wording
// with the failure reason). A `Record` keyed on the full `EntryState["kind"]`
// union, like `DOT_TONE` above: a fifth kind is a compile error here, not a
// silent fall-through to a default a `switch` would hide.
const STATUS_LABEL_SHORT: Record<EntryState["kind"], string> = {
  connected: "connected",
  warming: "connecting",
  failed: "failed",
  "not-a-member": "removed",
};
export function statusLabelShort(status: EntryState): string {
  return STATUS_LABEL_SHORT[status.kind];
}
