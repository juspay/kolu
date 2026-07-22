/**
 * The padi WIRING for the effective-finish gate — the padi-local inputs the pure
 * {@link createFinishGate} fold stands on, kept here so the fold knows nothing of the
 * registry, the agent-bucket channel, or kaval:
 *   - `listWaiting` reads the live registry for terminals that are ACTIVE and whose
 *     agent is in the `waiting` bucket (through the ONE shared `agentBucket` fence) —
 *     a boot/adopt seed for `enteredWaitingAt`;
 *   - `subscribeAgentObservations` rides the synchronous agent-bucket edge
 *     (`commitSnapshot` → `publishAgentBucket`), so the fold sees every
 *     waiting-episode boundary the moment it happens;
 *   - `subscribeActivity` consumes kaval's host-global `activity` stream — the
 *     meaningful-output edge, with resize repaints already excluded at the source.
 *
 * There is no byte tap and no per-terminal subscription here anymore: activity is
 * owned by kaval (the process that sees every byte AND every resize), and this padi
 * subscribes ONCE to its local kaval for the whole host.
 */

import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { createFinishGate, type FinishGate } from "./finishGate.ts";
import { ptyHostClient } from "./ptyHost/index.ts";
import { subscribeAgentBucket } from "./publisher.ts";
import { registryMap, type TerminalProcess } from "./terminal-registry.ts";
import { bridgeStream } from "./terminalEndpoint/local.ts";

/** Delay before re-subscribing to kaval's `activity` stream after it ends (a daemon
 *  recycle / reconnect) — long enough not to hot-loop while kaval is down, short
 *  enough that finish detection resumes promptly. Mirrors the inventory reconciler's
 *  re-subscribe cadence. */
const ACTIVITY_RESUBSCRIBE_DELAY_MS = 2_000;

/** The registry projection the gate's membership seed reads — a terminal's authored
 *  `meta` (union arm) and its live `agent`. Exported for the filter's unit test. */
export type WaitingCandidate = {
  meta: TerminalProcess["meta"];
  agent: AgentInfo | null;
};

/** The finish gate's MEMBERSHIP set: the ids of ACTIVE terminals whose agent is in
 *  the `waiting` bucket. Pure over a registry projection (not the live registry), so
 *  the `active` + `waiting`-bucket filter is unit-testable on its own. Only an active
 *  terminal is a finish candidate; a sleeping/parked arm and an awaiting/working agent
 *  are excluded, through the ONE shared `agentBucket` fence. */
export function selectWaitingTerminals(
  entries: ReadonlyMap<TerminalId, WaitingCandidate>,
): Set<TerminalId> {
  const waiting = new Set<TerminalId>();
  for (const [id, entry] of entries) {
    if (entry.meta.state !== "active") continue;
    if (!entry.agent) continue;
    if (agentBucket(entry.agent.state) === "waiting") waiting.add(id);
  }
  return waiting;
}

/** Build the effective-finish gate wired to padi's registry, agent-bucket edge, and
 *  the local kaval's meaningful-output stream. Disposed by the caller (daemonMain)
 *  alongside the surface runtime's `close`. */
export function createPadiFinishGate(deps: { log: Logger }): FinishGate {
  const { log } = deps;
  return createFinishGate({
    listWaiting: () =>
      selectWaitingTerminals(
        registryMap((e) => ({ meta: e.meta, agent: e.snapshot.agent })),
      ),
    // The RELIABLE agent-state edge — a synchronous fan-out `commitSnapshot` publishes
    // on every `waiting` bucket transition (never a missed episode boundary).
    subscribeAgentObservations: (onObserve) =>
      subscribeAgentBucket((id, isWaiting) =>
        onObserve(id as TerminalId, isWaiting),
      ),
    // kaval's host-global meaningful-output edge (resize-excluded at the source). One
    // subscription per host, re-established across a kaval recycle so a working
    // terminal's window can't be starved into a false finish by a lost stream.
    subscribeActivity: (onOutput) => {
      const abort = new AbortController();
      const { signal } = abort;
      void (async () => {
        while (!signal.aborted) {
          try {
            // The forwarding client calls `liveClient()` eagerly, so `activity.get`
            // THROWS synchronously when kaval isn't connected — this try owns that
            // pre-subscribe throw (distinct from the stream draining, which
            // `bridgeStream` resolves and never rejects).
            await bridgeStream(
              ptyHostClient.surface.activity.get({}, { signal }),
              signal,
              (edge) => onOutput(edge.id as TerminalId),
            );
          } catch (err) {
            if (signal.aborted) return;
            log.debug(
              { err },
              "kaval activity subscribe failed; will re-subscribe",
            );
          }
          if (signal.aborted) return;
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, ACTIVITY_RESUBSCRIBE_DELAY_MS);
            t.unref?.();
            signal.addEventListener("abort", () => {
              clearTimeout(t);
              resolve();
            });
          });
        }
      })();
      return () => abort.abort();
    },
  });
}
