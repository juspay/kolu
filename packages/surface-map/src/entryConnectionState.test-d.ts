/**
 * TYPE-LEVEL pin — carries the session-layer provisioning split
 * (`@kolu/surface-remote/session`'s `SessionState<Prov extends ProvisioningPhase>`,
 * juspay/kolu#1716) UP to the map projection: `EntryConnectionState`'s `Prov`
 * parameter makes `"copying"` (the nix-closure-PROVISIONING phase, a remote-only
 * fact) UNREPRESENTABLE for a LOCAL (non-provisioning) entry, not merely re-checked
 * at runtime.
 *
 * Before this split, `serveHostMap` could only catch a local entry projecting
 * `"copying"` at RUNTIME — a thrown belt (`session.provisions === false &&
 * state.kind === "copying"`). `tsc` GREEN over this file ⇒ the type-level
 * guarantee now holds too; deleting the `Prov` split would make the
 * `@ts-expect-error` lines below compile and fail the pin.
 */

import type { EntryConnectionState, EntrySession, MapRegistry } from "./server";

// The default (provisioning / mixed) arm still admits "copying" — unchanged.
const provisioning: EntryConnectionState = { kind: "copying" };
void provisioning;

// A LOCAL entry's state (`Prov = never`) cannot name "copying".
const local: EntryConnectionState<never> = {
  // @ts-expect-error — "copying" is the remote-only provisioning phase; the local
  // arm (`Prov = never`) cannot declare it. If this line ever compiles, a local
  // entry could again occupy "copying" at the map layer — the belt `serveHostMap`
  // otherwise has to re-check at runtime.
  kind: "copying",
};
void local;

// Every other phase stays reachable on the local arm — only "copying" is cut.
const localConnecting: EntryConnectionState<never> = { kind: "connecting" };
void localConnecting;

// The same split, one layer up: an `EntrySession<never>` (a LOCAL entry's
// resolved session) cannot carry a "copying" `state` either.
const localSession: EntrySession<never> = {
  kind: "session",
  link: {},
  state: {
    // @ts-expect-error — same cut, carried through `EntrySession<never>`.
    kind: "copying",
  },
};
void localSession;

// And one layer up again: a `MapRegistry<K, never>` — a registry that resolves
// ONLY local entries — types its own `resolve()` so a "copying" return is a
// compile error at the DEFINITION site, not just at a hand-built literal.
declare const localRegistry: MapRegistry<string, never>;
const resolved = localRegistry.resolve("a");
if (resolved.kind === "session") {
  // The pin: `resolved.state.kind`'s type is EXACTLY the four-phase union below
  // (never widened by "copying") — if the `Prov` split regressed, this
  // assignment would fail (the source would carry an extra "copying" member the
  // target can't accept), catching the regression without a hand-written
  // `@ts-expect-error` on the "copying" phase itself (there is no such phase
  // left to write one against).
  const kind: "connecting" | "connected" | "disconnected" | "failed" =
    resolved.state.kind;
  void kind;
}
