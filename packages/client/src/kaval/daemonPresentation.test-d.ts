/**
 * TYPE-LEVEL pin (P4 — the daemon-status escape-hatch retirement): a `connected`
 * {@link KavalPresence} without `identity` is a COMPILE ERROR.
 *
 * The WIRE's `DaemonStatusSchema` (`@kolu/padi/vocab.ts`) keeps `identity` OPTIONAL on
 * its `connected` arm for one reason: a pre-identity kaval build's own `system.version`
 * predates the field (`@kolu/padi/ptyHost/connect.ts`'s backward-compat seam — that
 * package's call, not this one's). That optionality is exactly the overloaded-null the
 * drain/reconnect bug rode: a render site could construct/consume a `connected` status
 * with no identity and paint a synthesized "—" beside a claimed-live daemon.
 *
 * `KavalPresence` is this package's OWN, narrower sum every render site must go
 * through — `identity` is MANDATORY on its `connected` arm, so "connected but identity
 * unknown" is now UNREPRESENTABLE at the type level. `tsc` GREEN over this file ⇒ the
 * guarantee holds; making `identity` optional again on `KavalPresence` would compile
 * the `@ts-expect-error` line below and fail the pin (see
 * `surface-remote/src/localSessionPhase.test-d.ts` for the same pin style).
 */

import type { KavalPresence } from "./daemonPresentation";

// A `connected` KavalPresence with every field present — legal.
const full: KavalPresence = {
  kind: "connected",
  identity: { staleKey: "abc123", navigableCommit: "deadbeef" },
  contractVersion: "5.1",
  startedAt: 0,
  socketPath: undefined,
  lifetime: { kind: "forever" },
};
void full;

// @ts-expect-error — a `connected` KavalPresence without `identity` must not compile.
// If this line ever compiles, the P4 escape hatch has regressed: a render site could
// again synthesize a "connected but identity unknown" value.
const missingIdentity: KavalPresence = {
  kind: "connected",
  contractVersion: "5.1",
  startedAt: 0,
  socketPath: undefined,
  lifetime: { kind: "forever" },
};
void missingIdentity;

// The non-connected arms carry no identity at all — legal, and distinct from
// "connected but unknown" (the whole point: a render site can tell the two apart by
// `kind`, never by an absent-vs-present field on the SAME kind).
const warming: KavalPresence = { kind: "warming" };
void warming;
const down: KavalPresence = { kind: "down", state: "dead" };
void down;
