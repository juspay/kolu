/**
 * TYPE-LEVEL pin (juspay/kolu#1716): `"copying"` is UNREPRESENTABLE for the local
 * (endpoint) session arm — not merely unused, but a COMPILE error.
 *
 * `"copying"` is the nix-closure-PROVISIONING phase, a remote-only fact. A
 * `makeSession<_, never>` (the non-provisioning endpoint arm, `Prov = never`) types
 * `initialConnection` as `LocalConnectionState` — so declaring the provisioning phase
 * is a type error. `tsc` GREEN over this file ⇒ the guarantee holds; deleting the
 * type-split would make the `@ts-expect-error` line below compile and fail the pin.
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
