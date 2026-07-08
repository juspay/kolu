/**
 * TYPE-LEVEL pin (juspay/kolu#1716's copying-unrepresentable split, carried down
 * to its LAST consumer): a LOCAL padi session's `onState` can never report
 * `"copying"` — the local endpoint connector provisions nothing (the daemon is
 * already here), so the provisioning phase is a remote-only fact. Before
 * `PadiSession` became generic over `Prov`, `asPadiSession` took a fixed
 * `base: Session<PadiSurfaceClient>` (Prov defaulting to the FULL
 * `ProvisioningPhase`), so the local arm's narrowed `Session<_, never>` base was
 * silently WIDENED back to the full union the moment it passed through — this
 * file pins that the narrowing now survives instead.
 *
 * `tsc` GREEN over this file ⇒ the guarantee holds; deleting the `Prov`
 * parameterization from `PadiSession`/`asPadiSession` would make the
 * `@ts-expect-error` line below compile and fail the pin.
 */

import type { PadiSurfaceClient } from "@kolu/padi/dial";
import type { Session } from "@kolu/surface-remote";
import type { PadiConvergence } from "kolu-common/surface";
import { asPadiSession, type PadiSession } from "./padiSession.ts";

declare const localBase: Session<PadiSurfaceClient, never>;

// The LOCAL arm's own construction path (`padiBinding.ts`): a `Session<_, never>`
// base yields a `PadiSession<never>` — the local narrowing carried all the way
// through `asPadiSession`, not discarded at its parameter.
const localPadi: PadiSession<never> = asPadiSession(localBase, {
  convergence: () => null satisfies PadiConvergence | null,
  renew: () => Promise.resolve(),
  clockOffset: () => null,
  entryFailedDetail: () => null,
});

localPadi.onState((s) => {
  // @ts-expect-error — a LOCAL padi session's connection can never be
  // `"copying"` (the local endpoint connector provisions nothing); the up-arm
  // union here is exactly `"connecting" | "connected"`. If this line ever
  // compiles, the copying-unrepresentable split has regressed for padi's last
  // consumer.
  if (s.connection === "copying") {
    // unreachable — pinned above, not exercised at runtime.
  }
});

// The REMOTE ssh arm keeps the default (full `ProvisioningPhase`): `"copying"` is
// its actual opening phase (`remotePadiBinding.ts`'s `initialConnection:
// "copying"`), so it must stay legal to read here — the split cuts only ONE way.
declare const remotePadi: PadiSession;
remotePadi.onState((s) => {
  if (s.connection === "copying") {
    // reachable for the remote (provisioning) arm — no `@ts-expect-error` here.
  }
});
