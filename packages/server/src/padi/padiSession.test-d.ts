import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { Session } from "@kolu/surface-remote";
import { Effect } from "effect";
import type { PadiConvergence } from "kolu-common/surface";
import { asPadiSession, type PadiSession } from "./padiSession.ts";

declare const localBase: Session<PadiSurfaceClient, never>;

const localPadi: PadiSession<never> = asPadiSession(localBase, {
  convergence: () => null satisfies PadiConvergence | null,
  renew: () => Effect.void,
  entryFailedDetail: () => null,
});

localPadi.onState((s) => {
  // @ts-expect-error
  if (s.phase === "provisioning") {
  }
});

declare const remotePadi: PadiSession;
remotePadi.onState((s) => {
  if (s.phase === "provisioning") {
  }
});

{
  const local = localPadi.currentState();
  // @ts-expect-error
  if (local.phase === "provisioning") {
  }
}
{
  const remote = remotePadi.currentState();
  if (remote.phase === "provisioning") {
  }
}
