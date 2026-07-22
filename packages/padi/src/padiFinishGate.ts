/**
 * The padi WIRING for the effective-finish gate — the volatile transport the pure
 * {@link createFinishGate} core stands on, kept here so the core knows nothing of
 * the registry or the endpoint:
 *   - `listWaiting` reads the live registry for terminals that are ACTIVE and whose
 *     agent is in the `waiting` bucket (through the ONE shared `agentBucket` fence),
 *     mapping each to its endpoint routing location;
 *   - `openTap` opens a kaval byte tap (the same `terminalAttach` deltas the browser
 *     green dot reads) and reports the FACT of each output chunk — never the bytes.
 *
 * This mirrors `liveActivity.ts`'s tap wiring; the two differ only in WHICH
 * terminals they tap (liveActivity every active terminal while its stream is
 * watched; the gate only the `waiting` ones, always) and the window, both owned by
 * the core.
 */

import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { createFinishGate, type FinishGate } from "./finishGate.ts";
import { registryMap } from "./terminal-registry.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";

/** The live location a terminal record carries — the arg `resolveTerminalEndpoint`
 *  routes an attach by. Read off the active arm (only active terminals have a live
 *  PTY to tap), exactly as `liveActivity.ts` reads it. */
type TerminalLocation = Parameters<typeof resolveTerminalEndpoint>[0];

/** Build the effective-finish gate wired to padi's registry + byte taps. Disposed
 *  by the caller (daemonMain) alongside the surface runtime's `close`. */
export function createPadiFinishGate(deps: { log: Logger }): FinishGate {
  const { log } = deps;
  return createFinishGate<TerminalLocation>({
    listWaiting: () => {
      const waiting = new Map<TerminalId, TerminalLocation>();
      for (const [id, entry] of registryMap((e) => ({
        meta: e.meta,
        agent: e.snapshot.agent,
      }))) {
        // Only an ACTIVE terminal has a live PTY to tap; only a `waiting` agent is a
        // finish candidate. A sleeping/parked entry (a different meta arm) and an
        // awaiting/working agent are both excluded here.
        if (entry.meta.state !== "active") continue;
        if (!entry.agent) continue;
        if (agentBucket(entry.agent.state) === "waiting") {
          waiting.set(id, entry.meta.location);
        }
      }
      return waiting;
    },
    openTap: (id, location, { onReady, onOutput, onClosed }) => {
      const abort = new AbortController();
      void (async () => {
        try {
          const { deltas } = await resolveTerminalEndpoint(location).attach(
            id,
            abort.signal,
          );
          // The attach has ESTABLISHED — a live observer now exists, so the quiet
          // window may start. Reporting readiness here (not when the tap was
          // requested) is what stops a slow/wedged attach from letting a terminal
          // settle before anything actually watched it.
          onReady();
          // Each delta is fresh output — the FACT of bytes, not the bytes. The
          // attach's first frame (the scrollback snapshot) is delivered separately
          // (never through `deltas`), so replayed screen can't false-light it.
          for await (const _chunk of deltas) onOutput();
        } catch (err) {
          if (!abort.signal.aborted) {
            log.debug({ err, terminal: id }, "finish-gate byte-tap ended");
          }
        } finally {
          // The stream ended (graceful end or a transient kaval drop) without us
          // aborting — signal the core to re-tap (a terminal still `waiting` mustn't
          // be believed watched, or it falsely settles). An abort is OUR disposer
          // (the terminal left `waiting`), so it needs no recovery.
          if (!abort.signal.aborted) onClosed();
        }
      })();
      return () => abort.abort();
    },
  });
}
