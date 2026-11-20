import type { EndpointState } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { log } from "../log.ts";
import type { KavalObservation } from "../kavalObservation.ts";
import { healClaimed, restartClaimed, withHealClaim } from "./endpointClaim.ts";
import type { ConvergeVerdict } from "./reconcileConverged.ts";

const BACKOFF_MS = 1_000;
const BACKOFF_CEILING_MS = 30_000;

export interface LinkLossHealer {
  observe(state: EndpointState): void;
}

export function startLinkLossHealer(deps: {
  readonly reconverge: Effect.Effect<ConvergeVerdict, unknown>;
  readonly onRecovered: (verdict: ConvergeVerdict) => void;
  readonly kavalResidency: Effect.Effect<KavalObservation["kind"]>;
  readonly backoffMs?: number;
}): LinkLossHealer {
  const firstMs = deps.backoffMs ?? BACKOFF_MS;
  let state: EndpointState | undefined;
  const published = (): EndpointState | undefined => state;
  let everConnected = false;
  let incompleteHealPending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let waitMs = firstMs;

  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    attempts = 0;
    waitMs = firstMs;
  };

  const arm = (): void => {
    if (timer !== undefined || healClaimed()) return;
    const backoffMs = waitMs;
    timer = setTimeout(() => {
      timer = undefined;
      void tick(backoffMs);
    }, backoffMs);
    timer.unref?.();
  };

  const backOff = (): void => {
    waitMs = Math.min(waitMs * 2, BACKOFF_CEILING_MS);
  };

  const cleared = (): boolean => {
    if (healClaimed()) return false;
    if (restartClaimed()) {
      arm();
      return false;
    }
    return (
      published() === "degraded" ||
      (incompleteHealPending && published() === "connected")
    );
  };

  const runAttempt = async (
    attemptNo: number,
  ): Promise<ConvergeVerdict | undefined> => {
    try {
      const verdict = await Effect.runPromise(deps.reconverge);
      log.info(
        { attempt: attemptNo, verdict },
        `kaval re-converge settled — ${verdict}`,
      );
      return verdict;
    } catch (err) {
      log.error(
        { err, attempt: attemptNo },
        "kaval re-converge attempt failed — the link is still down; retrying after the next backoff",
      );
      return undefined;
    }
  };

  const tick = async (backoffMs: number): Promise<void> => {
    if (!cleared()) return;
    const observed = await Effect.runPromise(deps.kavalResidency).catch(
      (err: unknown) => {
        log.error(
          { err, nextAttempt: attempts + 1 },
          "kaval residency probe THREW — the reading is a bug in the sensor, not a verdict about the daemon; re-checking after the next backoff",
        );
        return undefined;
      },
    );
    if (!cleared()) return;
    if (observed !== "healthy") {
      if (observed !== undefined) {
        log.warn(
          { observed, nextAttempt: attempts + 1 },
          observed === "unreachable"
            ? "kaval link lost and nothing is serving the socket — a converge here would SPAWN, which is the steady-state probe arm's ledgered job; re-checking after the next backoff"
            : "kaval link lost and the daemon is not answering — a wedged daemon is the steady-state probe arm's to repair; re-checking after the next backoff",
        );
      }
      arm();
      return;
    }
    attempts += 1;
    const attemptNo = attempts;
    log.warn(
      { attempt: attemptNo, backoffMs },
      `kaval link lost mid-session — re-converging (attempt ${attemptNo}, backoff ${backoffMs}ms)`,
    );
    const verdict = await withHealClaim(() => runAttempt(attemptNo));
    if (verdict === "incomplete") {
      incompleteHealPending = true;
      backOff();
      arm();
      return;
    }
    if (verdict !== undefined && published() === "connected") {
      incompleteHealPending = false;
      cancel();
      deps.onRecovered(verdict);
      return;
    }
    backOff();
    arm();
  };

  return {
    observe: (next: EndpointState): void => {
      state = next;
      if (next === "connected") {
        everConnected = true;
        if (!incompleteHealPending) cancel();
        return;
      }
      if (next !== "degraded") return;
      if (!everConnected) return;
      arm();
    },
  };
}
