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

/** The gate DECISION — whether the selector strip renders AT ALL. The strip is purely
 *  presentational with NO dual code path: with the gate closed (env-unset single-host
 *  default) the whole component renders nothing — a Solid `<Show>`, so it is ABSENT from
 *  the DOM, not CSS-hidden — and the single-host canvas stays pixel-identical. `undefined`
 *  (before the first cell frame) reads CLOSED, so the strip never flashes in during warm-
 *  up. (Real-DOM absence on an env-unset boot is captured as E2E evidence; this pins the
 *  sole predicate that governs the render.) */
export function hostGateOpen(gate: HostMapGate | undefined): boolean {
  return gate?.enabled === true;
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
