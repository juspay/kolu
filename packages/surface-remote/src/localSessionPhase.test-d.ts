/**
 * TYPE-LEVEL pin (juspay/kolu#1716, juspay/kolu#1808, W6): each session arm's
 * `initialConnection` can ONLY name a phase ITS OWN connector can reach — the
 * OTHER arm's opening phase is UNREPRESENTABLE, not merely unused, in BOTH
 * directions — AND the down-arm error shape is unforgeable.
 *
 * The ssh connector's phases (`SshProv = "probing" | "provisioning"`) are
 * remote-only facts. A `makeSession<_, never>` (the non-provisioning endpoint arm,
 * `Prov = never`) types `initialConnection` as EXACTLY `"connecting"` — so declaring
 * a provisioning phase is a type error. `tsc` GREEN over this file ⇒ the guarantee
 * holds; deleting the type-split would make the `@ts-expect-error` lines below
 * compile and fail the pin.
 *
 * The REVERSE direction (#1808) closes the sibling hole: a provisioning arm's
 * `initialConnection` types as EXACTLY `Prov`, so a LOCAL-set opening phase
 * (`"connecting"`, a down state) is a compile error there too — the constructible
 * contradiction that once misled `session.provisions`'s runtime derivation.
 */

import type { Connector, SessionState } from "./session";
import { makeSession } from "./session";
import type { SshProv } from "./sshConnector";

declare const localConnector: Connector<unknown, never>;
declare const sshConnector: Connector<unknown, SshProv>;

// The LOCAL/endpoint arm (`Prov = never`) — `"connecting"` is the only legal opening
// phase (a local daemon-already-here connector provisions nothing).
makeSession<unknown, never>({
  connectOnce: localConnector,
  initialConnection: "connecting",
});

makeSession<unknown, never>({
  connectOnce: localConnector,
  // @ts-expect-error — `"provisioning"` is a remote-only phase; the local arm
  // (`Prov = never`, `initialConnection: "connecting"`) cannot declare it. If this
  // line ever compiles, the type-level unrepresentability has regressed.
  initialConnection: "provisioning",
});

makeSession<unknown, never>({
  connectOnce: localConnector,
  // @ts-expect-error — `"probing"` (the ssh connector's OPENING probe phase) is a
  // remote-only provisioning phase too; the local arm can never spell it.
  initialConnection: "probing",
});

// The ssh/provisioning arm (`Prov = SshProv`) — `"probing"` (its FIRST provisioning
// phase, the arch probe + warm check) is the legal opening.
makeSession<unknown, SshProv>({
  connectOnce: sshConnector,
  initialConnection: "probing",
});

// PIN (#1808): a provisioning arm's `initialConnection` can ONLY be a `Prov` value
// (`"probing"`/`"provisioning"`) — a LOCAL-set phase is a compile error there too.
makeSession<unknown, SshProv>({
  connectOnce: sshConnector,
  // @ts-expect-error — `"connecting"` is a LOCAL-set phase; the provisioning arm
  // (`Prov = SshProv`, `initialConnection: Prov`) cannot declare it. If this line
  // ever compiles, a provisioning session could again be built with an initial
  // state that misclassifies `session.provisions` as `false`.
  initialConnection: "connecting",
});

// Neither arm may declare a DOWN state (or an already-`"connected"` one) as its boot
// value — a session that hasn't dialed yet cannot legally publish a first frame
// claiming it already gave up (or is already live).
makeSession<unknown, never>({
  connectOnce: localConnector,
  // @ts-expect-error — "failed" is not a legal OPENING phase for the local arm;
  // only "connecting" is (a fresh session hasn't dialed and given up yet).
  initialConnection: "failed",
});

makeSession<unknown, SshProv>({
  connectOnce: sshConnector,
  // @ts-expect-error — same for the provisioning arm: only its own `Prov` values
  // ("probing"/"provisioning") are legal opening phases, never a down state.
  initialConnection: "failed",
});

/**
 * TYPE-LEVEL pin (W6 — `SessionState`'s ONE sum): `phase` discriminates an UP arm
 * (`connecting`/`connected`/the provisioning `Prov`) that carries NO `error`/`cause`
 * FIELDS, and a DOWN arm (`disconnected`/`failed`) that carries them as REQUIRED
 * (never nullable) — so "down with no reason" and "live with a stale error" are both
 * UNCONSTRUCTIBLE. Both down arms carry `cause: "network" | "remote"` — terminality is
 * the `failed` PHASE, orthogonal to the transport cause (a budget-exhausted silent copy
 * gives up honestly `"network"`, #1908 F3); a bogus cause is still a compile error.
 */
declare const upState: SessionState<never>;
if (upState.phase === "connecting") {
  // @ts-expect-error — the up arm has no `error` FIELD to read at all (not merely a
  // null one) — a consumer must narrow to the down arm first.
  upState.error;
}

// A local `SessionState<never>` can never SPELL a provisioning phase either — the
// state type mirrors the opening-phase pin above one layer over. (`sinceMs` is supplied
// so the ONLY error is the illegal `phase` — not an incidental missing-field one.)
const localProbing: SessionState<never> = {
  // @ts-expect-error — `"probing"` is not a phase a `Prov = never` session can inhabit.
  phase: "probing",
  log: [],
  sinceMs: 0,
  campaignEpoch: 0,
};
void localProbing;

// A DOWN arm requires `error` + `cause` — omitting either is a compile error, not a
// silently-null field a consumer could later invent text for (the `?? "disconnected"`
// fallbacks this split deleted).
// @ts-expect-error — `disconnected` REQUIRES `error` + `cause`; a down arm with no
// reason is exactly the state this split makes unconstructible.
const missingReason: SessionState<never> = {
  phase: "disconnected",
  log: [],
  sinceMs: 0,
  campaignEpoch: 0,
};
void missingReason;

// `failed` + `"network"` is now REPRESENTABLE (#1908 F3): terminality is the `failed`
// phase, orthogonal to the transport cause — a budget-exhausted SILENT provisioning step
// gives up honestly `"network"` (never rewritten to `"remote"` to satisfy terminality).
const failedNetwork: SessionState<never> = {
  phase: "failed",
  error: "gave up — silent copy killed too many times",
  cause: "network",
  log: [],
  sinceMs: 0,
  campaignEpoch: 0,
};
void failedNetwork;

// …but the cause is still CONSTRAINED to the two transport classes — a bogus cause is a
// compile error.
const failedBadCause: SessionState<never> = {
  phase: "failed",
  error: "gave up",
  // @ts-expect-error — `cause` is `"network" | "remote"`; anything else is illegal.
  cause: "banana",
  log: [],
  sinceMs: 0,
  campaignEpoch: 0,
};
void failedBadCause;

// An UP arm carrying an error field is equally illegal — the split cuts both ways.
const upWithStaleError: SessionState<never> = {
  phase: "connecting",
  log: [],
  sinceMs: 0,
  campaignEpoch: 0,
  // @ts-expect-error — the up arm has no `error` field to assign; if this line ever
  // compiles, "live with a stale error" is representable again.
  error: "should not compile",
};
void upWithStaleError;
