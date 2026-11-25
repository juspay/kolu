/**
 * WHEN NEWS REACHES THE CONVERSATION — the held queue, the one-flight flush,
 * the failure-episode latch, and the `told` write-back.
 *
 * A turn is running and a watched terminal stops. Injecting that into the turn
 * would interrupt work nobody asked to interrupt; starting a second turn would
 * queue it behind the first. So it WAITS (`@kolu/acp-harness`'s holding list
 * discipline) and leaves when there is somebody to tell. This module is the
 * decision of WHEN that is, which is a clock of its own: it has nothing to say
 * about what a work is and nothing to ask the works store except who a ref is
 * a member of, for the wording.
 */

import type {
  ConductorWakeEvent,
  ConductorWakeLevel,
} from "kolu-common/conductor";
import type { Logger } from "pino";
import { type Held, holding } from "@kolu/acp-harness";
import type { MemberState } from "./members.ts";
import type { WatchObservation } from "./observation.ts";
import {
  type AnsweredNews,
  type NoTerminalsNews,
  type WakeMembership,
  wakeText,
} from "./wakeText.ts";

/** THE CONVERSATION, as a wake needs it: whether it can be interrupted right
 *  now, and how to put the words into it.
 *
 *  One value rather than two callbacks because the order is the whole rule —
 *  the agent is brought up FIRST (a wake may start it; that is the one place
 *  this package spawns for something a person did not type) and only then
 *  asked whether it is idle. Two independent thunks would let a caller check
 *  idleness against a conversation that is not the one it then wakes. */
export interface WakeTurn {
  readonly idle: boolean;
  readonly wake: (
    text: string,
    events: ReadonlyArray<ConductorWakeEvent>,
  ) => Promise<unknown>;
}

export interface Wakes {
  /** One terminal's news, as the event a wake is composed from — held, and
   *  flushed now if the conversation is idle. ALWAYS held first, which is what
   *  makes "one slot per terminal, newest only, in the position the first one
   *  took" true of the busy path and the idle path alike. */
  readonly ring: (
    member: MemberState,
    seen: WatchObservation,
    level: ConductorWakeLevel,
  ) => void;
  /** News that came from somewhere other than a reading — a hand-over. */
  readonly hold: (ref: string, event: ConductorWakeEvent) => void;
  /** THE HUMAN ANSWERED A QUESTION the Conductor asked (or declined it, or
   *  the work ended under it). Held by the ASK, so two answers that land
   *  while a turn is running are two pieces of news rather than one
   *  overwriting the other — an ask settles once, so no slot is ever
   *  replaced. */
  readonly answered: (news: AnsweredNews) => void;
  /** A PIECE OF WORK LOST ITS LAST TERMINAL. Held by the work, so it is said
   *  ONCE per emptying — and it is never an ending. */
  readonly noTerminals: (news: NoTerminalsNews) => void;
  /** A RE-KEYED WORK: every held piece of news about `from` now says `to` —
   *  an answer in its own slot, an emptying re-held under its new id. */
  readonly workMoved: (from: string, to: string) => void;
  readonly withdraw: (ref: string) => boolean;
  readonly refs: () => ReadonlyArray<string>;
  /** Whether what is waiting about a terminal is a HAND-OVER rather than an
   *  agent state. News about who may type into a terminal is not made untrue
   *  by the agent in it going back to work, so it is the one slot the
   *  `working` withdrawal must leave alone. */
  readonly handoverHeld: (ref: string) => boolean;
  readonly clear: () => void;
  readonly flush: () => Promise<void>;
}

export const wakes = (deps: {
  /** Bring the conversation up and say whether it can take a turn. */
  readonly turn: () => Promise<WakeTurn>;
  /** kolu's own sentence in the transcript, for a wake that could not go. */
  readonly say: (text: string) => void;
  /** A reader would see something different — the held list is on the frame. */
  readonly changed: () => void;
  /** What a member terminal IS, for the wording. */
  readonly membership: (ref: string) => WakeMembership | null;
  /** ... and the write-back: this level HAS been told. */
  readonly told: (ref: string, level: ConductorWakeLevel) => void;
  /** Whether the host has been torn down. */
  readonly stopped: () => boolean;
  readonly log: Logger;
}): Wakes => {
  /** THE ONE CONVERSATION this file holds for — the address every verb of the
   *  shared list is asked with. kolu has one, so it is a constant; its two caps
   *  are `undefined`, because the watch list is the bound. */
  const HERE = "the conversation";
  const held: Held<string, ConductorWakeEvent> = holding({
    keyOf: () => HERE,
  });
  /** WHAT THE HUMAN SAID, waiting — a queue of its own, keyed by the ask
   *  rather than by a terminal. The two are separate lists because they are
   *  keyed by different things and coalesce differently: a terminal's news is
   *  replaced by its newer news, while two answers are two answers. They are
   *  flushed TOGETHER, into one turn. */
  const answers: Held<string, AnsweredNews> = holding({ keyOf: () => HERE });
  /** PIECES OF WORK THAT LOST THEIR LAST TERMINAL — keyed by the work, so a
   *  work that empties twice while a turn runs is said once. Its own queue
   *  beside the other two for the same reason they are two: a different key,
   *  and a different way of coalescing. */
  const emptied: Held<string, NoTerminalsNews> = holding({ keyOf: () => HERE });
  /** A flush in flight. One at a time, because the whole point of a flush is
   *  that everything waiting leaves in ONE turn — two of them racing would be
   *  two wakes for one boundary. */
  let flushing = false;
  /** THE FAILURE EPISODE a wake is in, as the sentence that was said about it
   *  — or `null` when the last wake went. One notice per episode: a flush
   *  that fails is retried on every edge that could make it work, and a row
   *  per attempt would bury the conversation under kolu's own apologies. */
  let failure: string | null = null;
  /** Something rang (or a turn ended) while a flush was already running. The
   *  dropped edge is re-run when that flush ends, so news that landed in the
   *  window does not wait for an edge that has already passed. */
  let missedEdge = false;

  const sentenceOf = (err: unknown): string => {
    if (typeof err === "object" && err !== null && "why" in err) {
      const { why } = err;
      if (typeof why === "string" && why !== "") return why;
    }
    return err instanceof Error ? err.message : String(err);
  };

  /**
   * EVERYTHING WAITING, OUT AS ONE TURN — or held a little longer.
   *
   * Called from the edges that can make it possible: a terminal ringing while
   * nothing is running, a turn ending, and the agent coming up at all. All
   * arrive asynchronously and any of them may find the conversation busy,
   * which is why the decision is made HERE rather than at the callers — a wake
   * is sent only into an IDLE conversation, and anything else leaves the news
   * exactly where it was.
   *
   * A WAKE MAY START THE AGENT. That is the one place this package brings a
   * conversation up for something a person did not type, and it is deliberate:
   * the whole feature is kolu noticing that a watched terminal needs the
   * Conductor, and a Conductor that is not running is one that will never
   * notice anything again. What must NOT start it is reading the list.
   *
   * The slots are TAKEN before the wake is awaited, so a terminal that rings
   * during the round trip is held for the next flush rather than sent twice;
   * a wake that then fails puts back the ones nothing newer has replaced.
   *
   * ## When a wake cannot go at all
   *
   * It is SAID — one `notice` row naming the terminals still waiting and the
   * sentence behind the failure — and then retried on the next edge that could
   * make it work. A caught error that only reached the log is the thing
   * `AGENTS.md` refuses: the held news would sit behind an idle-looking
   * conversation with nothing on screen to say why.
   *
   * THE RETRY IS EVENT-DRIVEN AND HAS NO TIMER, because the whole design has
   * none. Each edge is a real change in the world: the conversation going idle
   * (which includes a replacement agent finishing its bring-up, a sign-in
   * landing, and a person's own turn ending), the agent coming up at all, and
   * the next reading from the watcher. One notice per FAILURE EPISODE rather
   * than per retry: the news that could not go is one piece of news, and a row
   * per attempt would be a conversation full of kolu apologising to itself.
   * The latch lifts the moment a wake lands.
   *
   * AN EDGE THAT ARRIVES WHILE A FLUSH IS RUNNING IS NOT LOST. Only one flush
   * runs at a time — two would be two wakes for one boundary — so a second one
   * is dropped, and `missedEdge` remembers that something happened while the
   * first was on the wire. The dropped edge is re-run when that flush ends,
   * whichever way it ended: a terminal that rang during a wake that then
   * failed would otherwise wait for an edge that has already been and gone. It
   * cannot spin, because the re-run needs a REAL edge to have landed in the
   * window, and an empty list returns at the top.
   */
  /** ONE attempt, start to finish — separated from {@link flush} only so its
   *  early returns (the conversation is busy, nothing is waiting any more)
   *  cannot skip the re-run of an edge that landed while it was on the wire.
   *  A `return` out of the body below is a flush that did nothing, which is
   *  exactly when a dropped edge most needs its turn. */
  const deliver = async (): Promise<void> => {
    const conversation = await deps.turn();
    if (!conversation.idle) return;
    const slots = held.waiting(HERE);
    const said = answers.waiting(HERE);
    const empty = emptied.waiting(HERE);
    if (slots.length === 0 && said.length === 0 && empty.length === 0) return;
    const events = slots.map((slot) => slot.value);
    const answered = said.map((slot) => slot.value);
    const noTerminals = empty.map((slot) => slot.value);
    held.took(HERE, slots);
    answers.took(HERE, said);
    emptied.took(HERE, empty);
    deps.changed();
    try {
      await conversation.wake(
        wakeText(events, deps.membership, answered, noTerminals),
        events,
      );
    } catch (err) {
      // The words never went. They go back on the list — except for a
      // terminal that has rung AGAIN since, whose newer news is the truth
      // and must not be overwritten by this one.
      for (const slot of slots) {
        if (!held.has(HERE, slot.from))
          held.hold(HERE, slot.from, slot.value, slot.from);
      }
      // An ask settles once, so nothing newer can have taken its slot: an
      // answer that could not be delivered goes back exactly as it was.
      for (const slot of said) {
        if (!answers.has(HERE, slot.from))
          answers.hold(HERE, slot.from, slot.value, slot.from);
      }
      // ... and a work empties once per emptying, for the same reason.
      for (const slot of empty) {
        if (!emptied.has(HERE, slot.from))
          emptied.hold(HERE, slot.from, slot.value, slot.from);
      }
      deps.changed();
      throw err;
    }
    // DELIVERED, so the episode is over: the next failure is news again.
    failure = null;
    // TOLD is set when the wake was DELIVERED — its turn started — and not a
    // moment before: news that waited through a turn and then failed to go
    // is still owed, and a restart must ring about it again.
    for (const event of events) {
      // A HAND-OVER IS NOT A STANDING. `told` is what stops kolu ringing
      // twice about the same agent state, and "the person took this one
      // over" is not one of those — writing it here would make the next
      // real stop look like news already delivered.
      if (event.level === "taken-over" || event.level === "handed-back")
        continue;
      deps.told(event.ref, event.level);
    }
  };

  const flush = async (): Promise<void> => {
    if (deps.stopped()) return;
    if (flushing) {
      missedEdge = true;
      return;
    }
    if (
      held.waiting(HERE).length === 0 &&
      answers.waiting(HERE).length === 0 &&
      emptied.waiting(HERE).length === 0
    )
      return;
    flushing = true;
    try {
      await deliver();
    } catch (err) {
      // A wake nobody could deliver is not thrown — there is no caller to
      // tell, this runs off a watcher's frame or a turn ending — so it is
      // LOGGED for the operator and SAID for the person reading the panel.
      deps.log.warn({ err }, "kolu-server: the conductor could not be woken");
      const why = sentenceOf(err);
      if (failure === null) {
        failure = why;
        const waiting = [...held.refs(HERE), ...answers.refs(HERE)];
        deps.say(
          `kolu could not wake this conversation about ${waiting.length === 0 ? "a terminal working on one of your pieces of work" : waiting.join(", ")} — ${why} — the news is still waiting, and goes out on the next thing that happens: the conversation going idle, the agent coming back up, or the next reading of a member terminal.`,
        );
      }
    } finally {
      flushing = false;
    }
    // ... and whatever rang while that was on the wire gets its own turn now.
    if (missedEdge) {
      missedEdge = false;
      void flush();
    }
  };

  return {
    flush,
    hold: (ref, event) => {
      held.hold(HERE, ref, event, ref);
    },
    answered: (news) => {
      answers.hold(HERE, news.ask, news, news.ask);
    },
    noTerminals: (news) => {
      emptied.hold(HERE, news.work, news, news.work);
    },
    workMoved: (from, to) => {
      for (const slot of answers.waiting(HERE)) {
        if (slot.value.work !== from) continue;
        answers.hold(HERE, slot.from, { ...slot.value, work: to }, slot.from);
      }
      const emptiedNews = emptied.peek(HERE, from, from);
      if (emptiedNews === undefined) return;
      emptied.withdraw(HERE, from, from);
      emptied.hold(HERE, to, { ...emptiedNews, work: to }, to);
    },
    withdraw: (ref) => held.withdraw(HERE, ref),
    refs: () => held.refs(HERE),
    handoverHeld: (ref) => {
      const waiting = held.peek(HERE, ref);
      return (
        waiting?.level === "taken-over" || waiting?.level === "handed-back"
      );
    },
    // THE FLEET'S NEWS GOES WITH THE CONVERSATION that is being deleted — it
    // is about terminals a wiped conversation has no memory of. AN ANSWER
    // DOES NOT: the question belongs to the WORK, which outlives the chat, so
    // what the human said is still owed to whatever conversation comes next.
    clear: () => {
      held.clear(HERE);
    },
    ring: (member, seen, level) => {
      // THE TERMINAL IS BOTH the sender and its own coalescing key: one slot per
      // watched terminal, newest news only, kept where the first one landed.
      held.hold(
        HERE,
        seen.ref,
        {
          ref: seen.ref,
          host: seen.host,
          terminalId: seen.terminalId,
          hostName: seen.hostName,
          name: member.name,
          // EMPTY is a real answer here, and exactly one level gives it: `ended`
          // is about a terminal no agent was ever seen in, so there is no name to
          // put. Every other level is about an agent, and the sticky reading has
          // one (`./members.ts`).
          agent: member.agent ?? "",
          level,
          at: new Date().toISOString(),
        },
        seen.ref,
      );
    },
  };
};
