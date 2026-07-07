/**
 * TYPE-LEVEL pin (P4 — the daemon-status escape-hatch retirement, padi's twin of
 * `kaval/daemonPresentation.test-d.ts`): a `connected` {@link PadiPresence} without
 * `identity` is a COMPILE ERROR.
 *
 * The raw wire facts (`padiLink` + `daemonInventory.boundPadi.buildCommit`) let a
 * render site show `padiLink === "connected"` beside a `null` build commit — the exact
 * overloaded-null the drain/reconnect bug rode ("status unknown / build commit — /
 * memory unavailable" while padi was provably alive). `PadiPresence` is this package's
 * own, narrower sum every render site must go through — `identity` (and its
 * `buildCommit`) is MANDATORY on the `connected` arm, so "connected but identity
 * unknown" is now UNREPRESENTABLE at the type level. `tsc` GREEN over this file ⇒ the
 * guarantee holds (see `surface-remote/src/localSessionPhase.test-d.ts` for the same
 * pin style).
 */

import type { PadiPresence } from "./padiPresentation";

// A `connected` PadiPresence with every identity field present — legal.
const full: PadiPresence = {
  kind: "connected",
  identity: {
    buildCommit: "deadbeef",
    surfaceVersion: "1.1",
    convergence: null,
  },
};
void full;

// @ts-expect-error — a `connected` PadiPresence without `identity` must not compile.
// If this line ever compiles, the P4 escape hatch has regressed.
const missingIdentity: PadiPresence = { kind: "connected" };
void missingIdentity;

const missingBuildCommit: PadiPresence = {
  kind: "connected",
  // @ts-expect-error — `identity` without its mandatory `buildCommit` must not compile
  // — the field the whole bug was about. If this line ever compiles, the P4 escape
  // hatch has regressed.
  identity: { surfaceVersion: "1.1", convergence: null },
};
void missingBuildCommit;

// The non-connected arms carry no identity at all — legal, and distinct from
// "connected but unknown" by `kind`, never by an absent-vs-present field.
const warming: PadiPresence = { kind: "warming" };
void warming;
const down: PadiPresence = { kind: "down" };
void down;
