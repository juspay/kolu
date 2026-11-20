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

export interface WakeTurn {
  readonly idle: boolean;
  readonly wake: (
    text: string,
    events: ReadonlyArray<ConductorWakeEvent>,
  ) => Promise<unknown>;
}

export interface Wakes {
  readonly ring: (
    member: MemberState,
    seen: WatchObservation,
    level: ConductorWakeLevel,
  ) => void;
  readonly hold: (ref: string, event: ConductorWakeEvent) => void;
  readonly answered: (news: AnsweredNews) => void;
  readonly noTerminals: (news: NoTerminalsNews) => void;
  readonly withdraw: (ref: string) => boolean;
  readonly refs: () => ReadonlyArray<string>;
  readonly handoverHeld: (ref: string) => boolean;
  readonly clear: () => void;
  readonly flush: () => Promise<void>;
}

export const wakes = (deps: {
  readonly turn: () => Promise<WakeTurn>;
  readonly say: (text: string) => void;
  readonly changed: () => void;
  readonly membership: (ref: string) => WakeMembership | null;
  readonly told: (ref: string, level: ConductorWakeLevel) => void;
  readonly stopped: () => boolean;
  readonly log: Logger;
}): Wakes => {
  const HERE = "the conversation";
  const held: Held<string, ConductorWakeEvent> = holding({
    keyOf: () => HERE,
  });
  const answers: Held<string, AnsweredNews> = holding({ keyOf: () => HERE });
  const emptied: Held<string, NoTerminalsNews> = holding({ keyOf: () => HERE });
  let flushing = false;
  let failure: string | null = null;
  let missedEdge = false;

  const sentenceOf = (err: unknown): string => {
    if (typeof err === "object" && err !== null && "why" in err) {
      const { why } = err;
      if (typeof why === "string" && why !== "") return why;
    }
    return err instanceof Error ? err.message : String(err);
  };

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
      for (const slot of slots) {
        if (!held.has(HERE, slot.from))
          held.hold(HERE, slot.from, slot.value, slot.from);
      }
      for (const slot of said) {
        if (!answers.has(HERE, slot.from))
          answers.hold(HERE, slot.from, slot.value, slot.from);
      }
      for (const slot of empty) {
        if (!emptied.has(HERE, slot.from))
          emptied.hold(HERE, slot.from, slot.value, slot.from);
      }
      deps.changed();
      throw err;
    }
    failure = null;
    for (const event of events) {
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
    withdraw: (ref) => held.withdraw(HERE, ref),
    refs: () => held.refs(HERE),
    handoverHeld: (ref) => {
      const waiting = held.peek(HERE, ref);
      return (
        waiting?.level === "taken-over" || waiting?.level === "handed-back"
      );
    },
    clear: () => {
      held.clear(HERE);
    },
    ring: (member, seen, level) => {
      held.hold(
        HERE,
        seen.ref,
        {
          ref: seen.ref,
          host: seen.host,
          terminalId: seen.terminalId,
          hostName: seen.hostName,
          name: member.name,
          agent: member.agent ?? "",
          level,
          at: new Date().toISOString(),
        },
        seen.ref,
      );
    },
  };
};
