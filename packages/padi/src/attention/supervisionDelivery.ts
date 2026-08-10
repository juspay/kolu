/**
 * SUPERVISION-EDGE DELIVERY — the structural half of the attention flow.
 *
 * The recurring failure this ends: a worker blocks on its supervisor, and the ask
 * waits to be DISCOVERED rather than DELIVERED. Every patch that adds a listener
 * (a watcher process, a hook, a discipline) fails the same way — the listener is a
 * SEPARATE act, so "dispatch a worker without arming its notification" stays
 * spellable, and a coordinator that forgets once drops a report on the floor.
 *
 * So the notification is not a thing you attach; it is what the supervision edge
 * MEANS. A terminal already records who spawned it (`parentId`, refused if it
 * would cycle), and kaval already serializes input into a terminal — a mailbox
 * with a single writer. Put those together and a worker going blocked delivers
 * into its supervisor's mailbox BY CONSTRUCTION: dispatching a worker creates its
 * notification path, because the edge IS the subscription. There is nothing to
 * arm, so there is nothing to forget.
 *
 * **The nudge is minimal, and that is deliberate.** It names the terminal and why,
 * and stops. The supervisor reads the worker's screen itself — so it acts on the
 * CURRENT output rather than a copy that aged in a queue, and one delivery can't
 * flood a supervisor's context with another agent's transcript.
 *
 * **ONE nudge per supervisor per frame.** A fold that retires twenty lanes at once
 * (a kaval recycle, a `killAll`) is ONE fact to its supervisor, so the frame is
 * grouped by `parentId` before anything is written: twenty submits into one
 * mailbox is not a policy anybody chose, it is what a per-event fan-out would
 * leave behind.
 *
 * **Only agent terminals are notified.** A supervisor that is a person's shell
 * gets nothing: injecting a line into a prompt someone is typing at would be a
 * defect, and a human already has the canvas, the Dock and the OS notification for
 * this exact fact. The guard is a live agent on the parent record — the same
 * `active` ∧ `agent` narrowing every other padi read uses.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { activeAgent, type PadiTerminal } from "../surface.ts";
import type { SettleEvent } from "./settleEvents.ts";

export interface SupervisionDeliveryDeps {
  /** Write into a terminal's mailbox (kaval's serialized input). A write that
   *  races a kill quiet-drops, as every other padi write does. */
  write: (id: TerminalId, data: string) => void;
  log: Logger;
}

/** One event's sentence, WITHOUT the prefix — what a supervisor is told about a
 *  single lane. Phrased as the instruction it is: a bare fact would leave a
 *  supervisor guessing whether to act on it. */
function settleSentence(event: SettleEvent): string {
  const intent = event.intent === undefined ? "" : ` (${event.intent})`;
  if (event.kind === "gone") {
    // A departure has no screen left to read, so the instruction differs: there
    // is nothing to respond to, only a lane to account for.
    return `Worker terminal ${event.id}${intent} is gone — it exited, was killed, or its id was retired. Do not wait for it.`;
  }
  const what =
    event.kind === "asking"
      ? "is asking for input"
      : "finished its turn and went quiet";
  return `Worker terminal ${event.id}${intent} ${what}. Read it with screen_text and respond — nobody else was told.`;
}

/** The line a supervisor receives for ONE frame's worth of its lanes. Prefixed
 *  once so an agent can recognise it as kolu's own message rather than something
 *  a person typed, and kept to a SINGLE line: a newline inside a PTY write would
 *  submit early in whatever the supervisor's agent CLI is reading with. A
 *  one-event frame renders byte-identically to a per-event delivery. */
export function nudgeText(events: readonly SettleEvent[]): string {
  return `[kolu] ${events.map(settleSentence).join(" ")}`;
}

export interface SupervisionDelivery {
  /** Deliver one observed FRAME along the supervision edges it carries: at most
   *  one write per supervisor, and only where the supervisor is an agent
   *  terminal. A no-op otherwise. `terminals` is the frame the events were
   *  computed from — the supervisor's record is read from IT, never re-fetched
   *  through a second path into the registry. */
  deliver(
    events: readonly SettleEvent[],
    terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  ): void;
}

export function createSupervisionDelivery(
  deps: SupervisionDeliveryDeps,
): SupervisionDelivery {
  return {
    deliver(events, terminals) {
      // GROUP FIRST. A root terminal has no supervisor — nobody spawned it, so
      // there is no edge to deliver along. Not a failure; the standing
      // subscriptions are how an MCP-only supervisor hears about these.
      const byParent = new Map<TerminalId, SettleEvent[]>();
      for (const event of events) {
        const parentId = event.parentId;
        if (parentId === undefined) continue;
        const bucket = byParent.get(parentId);
        if (bucket === undefined) byParent.set(parentId, [event]);
        else bucket.push(event);
      }

      for (const [parentId, mine] of byParent) {
        const parent = terminals.get(parentId);
        if (parent === undefined) {
          // The supervisor is gone (killed, or its record dropped) while a child
          // still names it. Nothing to deliver into; say so at debug rather than
          // silently — a supervision edge pointing at nothing is worth seeing
          // when reading logs, but it is an ordinary consequence of killing a
          // parent.
          deps.log.debug(
            { terminals: mine.map((e) => e.id), parentId },
            "settle events: supervisor terminal is gone, not delivering",
          );
          continue;
        }

        // THE HUMAN-SHELL GUARD. `activeAgent` is null for a sleeping/parked
        // record and for a live terminal running no agent — a person's shell.
        // Writing a line into that would type into whatever they were composing.
        if (activeAgent(parent) === null) {
          deps.log.debug(
            { terminals: mine.map((e) => e.id), parentId },
            "settle events: supervisor is not an agent terminal, not delivering",
          );
          continue;
        }

        // `\r` SUBMITS the line. A supervisor mid-turn has it queued by its own
        // agent CLI (kaval serializes; last one wins); a supervisor at its prompt
        // is re-invoked by it. Delivering without submitting would leave the
        // nudge sitting unsent in an input buffer — the ask discovered, not
        // delivered, which is the whole failure this module exists to end.
        deps.write(parentId, `${nudgeText(mine)}\r`);
        deps.log.info(
          {
            terminals: mine.map((e) => e.id),
            parentId,
            kinds: mine.map((e) => e.kind),
          },
          "settle events delivered to supervisor",
        );
      }
    },
  };
}
