/**
 * TYPE-LEVEL pin (juspay/kolu#1716, juspay/kolu#1808): each session arm's
 * `initialConnection` can ONLY name a phase ITS OWN connector can reach — the
 * OTHER arm's opening phase is UNREPRESENTABLE, not merely unused, in BOTH
 * directions.
 *
 * `"copying"` is the nix-closure-PROVISIONING phase, a remote-only fact. A
 * `makeSession<_, never>` (the non-provisioning endpoint arm, `Prov = never`) types
 * `initialConnection` as `LocalConnectionState` — so declaring the provisioning phase
 * is a type error. `tsc` GREEN over this file ⇒ the guarantee holds; deleting the
 * type-split would make the `@ts-expect-error` line below compile and fail the pin.
 *
 * The REVERSE direction (#1808) closes the sibling hole: before it, a provisioning
 * arm's `initialConnection` was typed `LocalConnectionState | Prov` — so a
 * `makeSession<_>` (default `Prov = ProvisioningPhase`) could ALSO declare a
 * LOCAL-set opening phase (`"connecting"`, etc.), a constructible contradiction that
 * misled `session.provisions`'s runtime derivation (which reads `initialConnection`
 * as the erased `Prov`'s only witness) into `false` for a session that really does
 * provision — and later crashed `serveHostMap`'s belt the first time that session
 * legitimately entered `"copying"`. `initialConnection` now types as EXACTLY `Prov`
 * for a provisioning arm, so a local-set opening phase is a compile error there too.
 */

import type { Connector, SessionState } from "./session";
import { makeSession } from "./session";

declare const connector: Connector<unknown>;

// The LOCAL/endpoint arm (`Prov = never`) — `"connecting"` is the only legal opening
// phase (a local daemon-already-here connector provisions nothing).
makeSession<unknown, never>({
  connectOnce: connector,
  initialConnection: "connecting",
});

makeSession<unknown, never>({
  connectOnce: connector,
  // @ts-expect-error — `"copying"` is the remote-only provisioning phase; the local arm
  // (`Prov = never`, `initialConnection: LocalConnectionState`) cannot declare it. If this
  // line ever compiles, the type-level unrepresentability has regressed.
  initialConnection: "copying",
});

// The ssh/provisioning arm (default `Prov = ProvisioningPhase`) — `"copying"` is legal.
makeSession<unknown>({ connectOnce: connector, initialConnection: "copying" });

// PIN (#1808): a provisioning arm's `initialConnection` can ONLY be a `Prov` value
// (`"copying"`) — a LOCAL-set phase is now a compile error there too, closing the
// constructible contradiction that misled `session.provisions`'s runtime read.
makeSession<unknown>({
  connectOnce: connector,
  // @ts-expect-error — `"connecting"` is a LOCAL-set phase; the provisioning arm
  // (default `Prov = ProvisioningPhase`, `initialConnection: Prov`) cannot declare
  // it. If this line ever compiles, a provisioning session could again be built
  // with an initial state that misclassifies `session.provisions` as `false`.
  initialConnection: "connecting",
});

/**
 * PIN (new — `initialConnection` narrowed from `LocalConnectionState` to
 * exactly `"connecting"` on the local arm): `initialConnection` is the
 * connector's OPENING phase, so neither arm may declare a DOWN state (or an
 * already-`"connected"` one) as its boot value — a session that hasn't dialed
 * yet cannot legally publish a first frame claiming it already gave up (or is
 * already live). Before this narrowing the local arm's type was the FULL
 * `LocalConnectionState` (all four local phases), so `initialConnection:
 * "failed"` type-checked even though no connector could ever legitimately open
 * there — a lying boot frame, and a value `session.provisions`'s set-membership
 * derivation was never designed to see at construction time.
 */
makeSession<unknown, never>({
  connectOnce: connector,
  // @ts-expect-error — "failed" is not a legal OPENING phase for the local arm;
  // only "connecting" is (a fresh session hasn't dialed and given up yet). If
  // this line ever compiles, a local session could again boot claiming it's
  // already terminal.
  initialConnection: "failed",
});

makeSession<unknown>({
  connectOnce: connector,
  // @ts-expect-error — same for the provisioning arm: only its own `Prov` value
  // ("copying") is a legal opening phase, never a down state.
  initialConnection: "failed",
});

/**
 * TYPE-LEVEL pin (juspay/kolu — `SessionState`'s down-arm sum): `connection`
 * discriminates an UP arm (`connecting`/`connected`/the provisioning `Prov`)
 * that carries NO `lastError`/`failureCause` FIELDS, and a DOWN arm
 * (`disconnected`/`failed`) that carries them as REQUIRED (never nullable) — so
 * "down with no reason" and "live with a stale error" are both
 * UNCONSTRUCTIBLE, not merely undocumented. Mirrors the `"copying"`-unrepresentable
 * split above one arm over: that pin makes the wrong PROVISIONING PHASE
 * unconstructible; this one makes the wrong ERROR SHAPE unconstructible.
 */
declare const upState: SessionState<never>;
if (upState.connection === "connecting") {
  // @ts-expect-error — the up arm has no `lastError` FIELD to read at all (not
  // merely a null one) — a consumer must narrow to the down arm first. If this
  // line ever compiles, the up/down split has regressed to a nullable product.
  upState.lastError;
}

// A DOWN arm requires `lastError` + `failureCause` — omitting either is a
// compile error, not a silently-null field a consumer could later invent text
// for (the `?? "disconnected"`/`?? "failed"` fallbacks this split deleted).
// @ts-expect-error — `disconnected` REQUIRES `lastError` + `failureCause`; a
// down arm with no reason is exactly the state this split makes
// unconstructible. If this line ever compiles, "down with no reason" is
// representable again.
const missingReason: SessionState<never> = {
  connection: "disconnected",
  progressLines: [],
  remoteProgressLines: [],
};
void missingReason;

// An UP arm carrying an error field is equally illegal — the split cuts both
// ways: a live/warming state can never carry a stale error either.
const upWithStaleError: SessionState<never> = {
  connection: "connecting",
  progressLines: [],
  remoteProgressLines: [],
  // @ts-expect-error — the up arm has no `lastError` field to assign; if this
  // line ever compiles, "live with a stale error" is representable again.
  lastError: "should not compile",
};
void upWithStaleError;
