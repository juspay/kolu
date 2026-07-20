/**
 * TYPE-LEVEL pin (P4 — the daemon-status escape-hatch retirement, padi's twin of
 * `kaval/daemonPresentation.test-d.ts`): a `connected` {@link PadiPresence} without
 * `identity` is a COMPILE ERROR.
 *
 * The raw wire facts (`padiLink` + padi's per-host `identity` cell) let a render site
 * show `padiLink === "connected"` beside a `null`/`undefined` build commit — the exact
 * overloaded-null the drain/reconnect bug rode ("status unknown / build commit — /
 * memory unavailable" while padi was provably alive). `PadiPresence` is this package's
 * own, narrower sum every render site must go through — `identity` (and its
 * `buildCommit`) is MANDATORY on the `connected` arm, so "connected but identity
 * unknown" is now UNREPRESENTABLE at the type level. `tsc` GREEN over this file ⇒ the
 * guarantee holds (see `surface-remote/src/localSessionPhase.test-d.ts` for the same
 * pin style).
 *
 * W4 "the switch" adds a SECOND distinction this file also pins: `buildCommit: null`
 * (padi itself DECLARED "no commit" — a dev/off-nix build) is legal on the `connected`
 * arm — it is NOT the same state as "identity unknown" (that absence is the identity
 * CELL never having arrived, which `toPadiPresence` floors to `warming` before a
 * `PadiPresence` is even constructed — see `padiPresentation.test.ts`'s runtime pins).
 */

import type { PadiPresence } from "./padiPresentation";

// A `connected` PadiPresence with every identity field present — legal.
const full: PadiPresence = {
  kind: "connected",
  identity: {
    buildCommit: "deadbeef",
    surfaceVersion: "1.1",
    lifetime: { kind: "forever" },
  },
};
void full;

// A `connected` PadiPresence with a DECLARED-null build commit — legal, and DISTINCT
// from "identity unknown": a dev/off-nix padi genuinely has no commit, and padi (the
// writer) declares exactly that, rather than the cell never having arrived.
const declaredNoCommit: PadiPresence = {
  kind: "connected",
  identity: {
    buildCommit: null,
    surfaceVersion: "1.1",
    lifetime: { kind: "forever" },
  },
};
void declaredNoCommit;

// @ts-expect-error — a `connected` PadiPresence without `identity` must not compile.
// If this line ever compiles, the P4 escape hatch has regressed.
const missingIdentity: PadiPresence = { kind: "connected" };
void missingIdentity;

const missingBuildCommit: PadiPresence = {
  kind: "connected",
  // @ts-expect-error — `identity` without its mandatory `buildCommit` must not compile
  // — the field the whole bug was about. If this line ever compiles, the P4 escape
  // hatch has regressed.
  identity: { surfaceVersion: "1.1" },
};
void missingBuildCommit;

// The non-connected arms carry no identity at all — legal, and distinct from
// "connected but unknown" by `kind`, never by an absent-vs-present field.
const warming: PadiPresence = { kind: "warming" };
void warming;
const unknown: PadiPresence = { kind: "unknown" };
void unknown;
const down: PadiPresence = { kind: "down" };
void down;

// @ts-expect-error — `unknown` carries NO payload: a connected-era fact cannot ride it.
const unknownWithFact: PadiPresence = { kind: "unknown", identity: {} };
void unknownWithFact;
