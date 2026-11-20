import type { PadiPresence } from "./padiPresentation";

const full: PadiPresence = {
  kind: "connected",
  identity: {
    buildCommit: "deadbeef",
    surfaceVersion: "1.1",
    lifetime: { kind: "forever" },
  },
};
void full;

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
const missingIdentity: PadiPresence = { kind: "connected" };
void missingIdentity;

const missingBuildCommit: PadiPresence = {
  kind: "connected",
  // @ts-expect-error — `identity` without its mandatory `buildCommit` must not compile
  identity: { surfaceVersion: "1.1" },
};
void missingBuildCommit;

const warming: PadiPresence = { kind: "warming" };
void warming;
const unknown: PadiPresence = { kind: "unknown" };
void unknown;
const down: PadiPresence = { kind: "down" };
void down;

// @ts-expect-error — `unknown` carries NO payload: a connected-era fact cannot ride it.
const unknownWithFact: PadiPresence = { kind: "unknown", identity: {} };
void unknownWithFact;
