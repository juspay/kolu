import { isNoListenerError } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import {
  heldKaval,
  type KavalProbe,
  probeKavalStatus,
} from "./hostInventory.ts";

export type KavalObservation =
  | { readonly kind: "healthy" }
  | { readonly kind: "wedged"; readonly err: unknown }
  | { readonly kind: "unreachable" };

export function classifyKavalProbe(
  outcome:
    | { readonly ok: true; readonly probe: KavalProbe }
    | { readonly ok: false; readonly err: unknown },
): KavalObservation {
  if (!outcome.ok) {
    return isNoListenerError(outcome.err)
      ? { kind: "unreachable" }
      : { kind: "wedged", err: outcome.err };
  }
  const { terminalCount, contractVersion } = outcome.probe;
  return terminalCount === null && contractVersion === null
    ? { kind: "unreachable" }
    : { kind: "healthy" };
}

export function observeHeldKaval(
  stateRoot: string,
): Effect.Effect<KavalObservation> {
  return Effect.suspend(() =>
    probeKavalStatus(heldKaval(stateRoot).socket).pipe(
      Effect.match({
        onSuccess: (probe) => ({ ok: true, probe }) as const,
        onFailure: (err) => ({ ok: false, err }) as const,
      }),
      Effect.map(classifyKavalProbe),
    ),
  );
}
