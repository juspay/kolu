import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type {
  DaemonSession,
  DownSessionState,
  Session,
  SshProv,
} from "@kolu/surface-remote";
import type { Effect } from "effect";
import type { PadiConvergence } from "kolu-common/surface";
import type {
  EntryFailedCause,
  PadiEntryFailure,
  SkewVersionPair,
} from "kolu-common/surfacesWithPadi";

export type PadiEntryFailedDetail =
  | { readonly cause: Exclude<EntryFailedCause, "contract-skew-refused"> }
  | ({ readonly cause: "contract-skew-refused" } & SkewVersionPair);

export function padiFailureOf(
  provisions: boolean,
  detail: PadiEntryFailedDetail | null,
  state: DownSessionState,
): PadiEntryFailure | null {
  if (detail !== null) return { ...detail, reason: state.error };
  if (state.phase !== "failed") return null;
  if (!provisions) return { cause: "local-start-failed", reason: state.error };
  return {
    cause: state.cause === "network" ? "connect-stalled" : "host-setup-failed",
    reason: state.error,
  };
}

export type PadiSession<Prov extends string = SshProv> = Omit<
  DaemonSession<PadiSurfaceClient, PadiConvergence>,
  "onState" | "currentState" | "renew"
> &
  Pick<Session<PadiSurfaceClient, Prov>, "onState" | "currentState"> & {
    entryFailedDetail(): PadiEntryFailedDetail | null;
    renew(): Effect.Effect<void, unknown>;
  };

export const PADI_PRESERVATION = { children: "survive" } as const;

export function asPadiSession<Prov extends string = SshProv>(
  base: Session<PadiSurfaceClient, Prov>,
  members: {
    convergence: () => PadiConvergence | null;
    renew: () => Effect.Effect<void, unknown>;
    entryFailedDetail: () => PadiEntryFailedDetail | null;
  },
): PadiSession<Prov> {
  return {
    ...base,
    convergence: members.convergence,
    entryFailedDetail: members.entryFailedDetail,
    preservation: PADI_PRESERVATION,
    renew: members.renew,
  };
}
