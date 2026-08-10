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
  /** Write into a terminal's mailbox (kaval's serialized input) — but ONLY if it
   *  is still an agent terminal at the instant of the write. A write that races a
   *  kill quiet-drops, as every other padi write does.
   *
   *  The re-check is the dep's, not this module's, because the two facts live in
   *  different places: this module holds the observed FRAME (which is what groups
   *  the events and names the supervisor), while the byte write resolves the LIVE
   *  registry entry. Those can disagree — the flush is deferred off the
   *  derivation, so a supervisor's agent can exit in the gap while its shell stays
   *  alive, and a frame-only guard would then type into a human's shell after all.
   *  The human-shell guard is the one rule that must hold at the moment bytes
   *  move, so it is enforced where the bytes move.
   *
   *  Returns whether the write landed, so the caller logs the truth rather than
   *  an intention. */
  write: (id: TerminalId, data: string) => boolean;
  log: Logger;
}

/** How much of a lane's intent rides the nudge. Long enough to identify the
 *  lane, short enough that twenty of them stay one readable line. */
const INTENT_BUDGET = 60;

/** Make an operator-authored string SAFE TO PUT ON A PTY.
 *
 *  `intent` is free-form multi-line markdown — the editor is a `<textarea>`, the
 *  schema constrains only non-emptiness, and `firstIntentLine` exists downstream
 *  precisely because intents contain newlines. This module's write is terminated
 *  by `\r`, so an unsanitized intent does not merely render badly: every embedded
 *  newline or carriage return SUBMITS, turning one nudge into several lines
 *  entered at a supervisor's agent prompt. The tail after such a break is
 *  attacker- or accident-chosen text arriving as its own instruction.
 *
 *  So the sentence is built from a stripped projection, never the raw field:
 *  every C0/C7F control (newline, carriage return, escape — so no CSI sequence
 *  can be smuggled either) becomes a space, runs collapse, and the result is
 *  budget-capped. The rule lives at the boundary that writes bytes, not at the
 *  boundary that accepted them, because the hazard is the PTY, not the store. */
function ptySafe(text: string, budget: number): string {
  // C0 (\u0000-\u001f — includes \n, \r, \t and ESC) plus DEL (\u007f):
  // everything a terminal ACTS on rather than prints.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping controls is the point
  const flattened = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  const collapsed = flattened.replace(/\s{2,}/g, " ");
  return collapsed.length > budget
    ? `${collapsed.slice(0, budget - 1).trimEnd()}…`
    : collapsed;
}

/** One event's sentence, WITHOUT the prefix — what a supervisor is told about a
 *  single lane. Phrased as the instruction it is: a bare fact would leave a
 *  supervisor guessing whether to act on it. */
function settleSentence(event: SettleEvent): string {
  // The id is a UUID by schema, so only `intent` can carry anything hostile.
  const safeIntent =
    event.intent === undefined ? "" : ptySafe(event.intent, INTENT_BUDGET);
  const intent = safeIntent === "" ? "" : ` (${safeIntent})`;
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

        // THE HUMAN-SHELL GUARD. `activeAgent` is null for a live terminal
        // running no agent — a person's shell. Writing a line into that would
        // type into whatever they were composing, and a human already has the
        // canvas, the Dock and an OS notification for this exact fact. A
        // by-design skip, so it stays at debug.
        if (activeAgent(parent) === null) {
          // ...EXCEPT when the supervisor is DORMANT (sleeping/parked — its PTY
          // released), which is not the same skip at all. There is no mailbox to
          // write into and no second chance: this push is the only one, so the
          // event reaches that supervisor never. The fact itself is not lost —
          // it is in the `urgency` cell and in every standing subscription that
          // matched — but the EDGE is, and the whole premise of this module is
          // that the edge cannot be. Retention across a wake would need a
          // delivery contract this module does not have (how long to hold, what
          // flushes it, what if the supervisor never wakes), so what it does
          // instead is REFUSE TO BE QUIET about it: an operator reading logs
          // sees a supervision edge that could not be honoured, rather than the
          // silence that reads exactly like a calm workspace.
          const dormant = parent.state !== "active";
          if (dormant) {
            deps.log.warn(
              {
                terminals: mine.map((e) => e.id),
                parentId,
                state: parent.state,
              },
              "settle events NOT delivered — supervisor is dormant (no live PTY); it will not learn of these on wake",
            );
          } else {
            deps.log.debug(
              { terminals: mine.map((e) => e.id), parentId },
              "settle events: supervisor is a plain shell, not delivering",
            );
          }
          continue;
        }

        // `\r` SUBMITS the line. A supervisor mid-turn has it queued by its own
        // agent CLI (kaval serializes; last one wins); a supervisor at its prompt
        // is re-invoked by it. Delivering without submitting would leave the
        // nudge sitting unsent in an input buffer — the ask discovered, not
        // delivered, which is the whole failure this module exists to end.
        //
        // `write` re-checks the human-shell guard against LIVE state and answers
        // whether it landed — the frame above is an observation, and an agent can
        // exit in the gap before this deferred flush.
        if (!deps.write(parentId, `${nudgeText(mine)}\r`)) {
          deps.log.debug(
            { terminals: mine.map((e) => e.id), parentId },
            "settle events: supervisor stopped being an agent terminal before the write, not delivering",
          );
          continue;
        }
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
