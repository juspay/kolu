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

import type { Connector } from "./session";
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
