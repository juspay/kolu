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

// ── The `failed` arm REQUIRES a domain `failure` (lowy-1 / hickey-2, PR4) ─────────
// A terminal give-up is ALWAYS a real failure, so "failed with no failure" is an
// illegal state made UNCONSTRUCTIBLE at the type — not caught by a runtime throw
// (the old `UnclassifiedEntryFailureError` in `projectStatus` is gone). This
// compile-fail is the migrated home of `mapHarness.test.ts`'s deleted `(5c)` runtime
// `.toThrow(...)` pin.
// @ts-expect-error — `failed` requires `failure`; the illegal state cannot be spelled.
const failedNoFailure: EntryConnectionState<"copying", { reason: string }> = {
  kind: "failed",
};
void failedNoFailure;

// ── The `failed` arm REQUIRES the failure's EVIDENCE too ─────────────────────────
// A reason without its retained output tail is the defect this pairing removes
// (juspay/kolu#2007: kolu held a reason whose evidence the liveness floor had already
// dropped). It is UNSPELLABLE, not merely discouraged.
// @ts-expect-error — `failed` requires `evidence`; reason-without-evidence cannot be spelled.
const failedNoEvidence: EntryConnectionState<"copying", { reason: string }> = {
  kind: "failed",
  failure: { reason: "gave up for good" },
};
void failedNoEvidence;

// A `failed` arm WITH the domain failure AND its evidence is the ONLY constructible form.
const failedOk: EntryConnectionState<"copying", { reason: string }> = {
  kind: "failed",
  failure: { reason: "gave up for good" },
  evidence: [{ source: "remote", line: "error: build failed" }],
};
void failedOk;

// `[]` is a REAL, spellable evidence value — "the failure genuinely produced no
// output", stated by the seam that knows. (It is never a stand-in for "we can't see it":
// no such state exists on this arm any more.)
const failedNoOutput: EntryConnectionState<"copying", { reason: string }> = {
  kind: "failed",
  failure: { reason: "gave up for good" },
  evidence: [],
};
void failedNoOutput;

// `disconnected.failure` stays OPTIONAL — a transient drop legitimately carries
// none (→ warming). That per-arm optionality is exactly what does NOT bleed onto
// `failed`, so an omitted `failure` here is valid, not an error.
const disconnectedTransient: EntryConnectionState<
  "copying",
  { reason: string }
> = { kind: "disconnected" };
void disconnectedTransient;

// ── The `disconnected` arm PAIRS `failure` with `evidence` ───────────────────────
// A standing refuse publishes the `failed` status, so it gets the same stapling as a
// terminal give-up: a refuse whose reason arrived WITHOUT its evidence is a compile
// error, not a runtime surprise.
// @ts-expect-error — a `disconnected` failure must arrive WITH its evidence.
const refuseNoEvidence: EntryConnectionState<"copying", { reason: string }> = {
  kind: "disconnected",
  failure: { reason: "contract skew — refused" },
};
void refuseNoEvidence;

// The paired form is the only constructible standing refuse.
const refuseOk: EntryConnectionState<"copying", { reason: string }> = {
  kind: "disconnected",
  failure: { reason: "contract skew — refused" },
  evidence: [{ source: "local", line: "padi: refusing, version skew" }],
};
void refuseOk;

// And evidence cannot ride a transient drop ALONE either — the pair is both-or-neither,
// so "evidence without a reason" is as unspellable as its mirror.
// @ts-expect-error — evidence without a `failure` is not a state this arm can hold.
const evidenceNoRefuse: EntryConnectionState<"copying", { reason: string }> = {
  kind: "disconnected",
  evidence: [{ source: "local", line: "dropped" }],
};
void evidenceNoRefuse;

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
