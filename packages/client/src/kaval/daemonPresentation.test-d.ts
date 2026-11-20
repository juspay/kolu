import type { KavalPresence } from "./daemonPresentation";

const full: KavalPresence = {
  kind: "connected",
  identity: { staleKey: "abc123", navigableCommit: "deadbeef" },
  contractVersion: "5.0",
  startedAt: 0,
  socketPath: undefined,
  lifetime: { kind: "forever" },
};
void full;

// @ts-expect-error
const missingIdentity: KavalPresence = {
  kind: "connected",
  contractVersion: "5.0",
  startedAt: 0,
  socketPath: undefined,
  lifetime: { kind: "forever" },
};
void missingIdentity;

const warming: KavalPresence = { kind: "warming", state: "connecting" };
void warming;
const unknown: KavalPresence = { kind: "unknown" };
void unknown;
const down: KavalPresence = { kind: "down", state: "dead" };
void down;

const unknownWithFact: KavalPresence = {
  kind: "unknown",
  // @ts-expect-error
  contractVersion: "5.2",
};
void unknownWithFact;
