/** The Conductor's bell — when something that needs YOU rings.
 *
 *  What rings here, through the ONE path every alert takes
 *  (`attention/attend.ts`, handed in by `useAttention` — one switch, one
 *  sound, one notification seam):
 *
 *   - an ITEM of the one needs-you reading (`kolu-work`'s `needsYou`): a
 *     question put about a piece of work, or a green PR handed over to you;
 *   - a question the conversation asks that belongs to NO work — the
 *     conversation's own, which has no card;
 *   - proposals the Conductor would like to remember.
 *
 *  What is decided here is only WHAT IS NEW — off the wire, so it is
 *  unit-testable — the same split `attentionCore` makes for terminals.
 *  Whether and how a new thing reaches the human is the one path's business;
 *  this bell knows nothing about where the human is looking.
 *
 *  The rules:
 *    • ONCE PER ITEM. An item's identity is its work, its reason and the ask
 *      or the commit that went green ({@link NeedsYou.key}); a question is
 *      known by its ask alone, so one open in the first reading is heard with
 *      it even though its work's record has not arrived yet. The remembered
 *      set only grows: kolu PR #2400's merge answer went can, cannot, can
 *      about one commit inside two minutes, and that is one ring.
 *    • ATTENTION IS A TRANSITION, NOT A DISCOVERY. The first reading (the
 *      conversation's first frame) is a baseline and never rings. After it,
 *      the works arrive one record at a time, so a work met for the first
 *      time is a discovery too — its wait rang (or did not) before this
 *      browser was looking — UNLESS it is a question: every question open at
 *      the baseline was heard with it, so one not heard yet was asked since,
 *      and its work was born asking.
 *    • SEEN IS SEEN. A thing counts as heard whether or not it rang: one that
 *      arrived while alerts were off must not ring the moment alerts come
 *      back on.
 *    • MEMORY AND THE CONVERSATION'S OWN QUESTIONS each take their first
 *      frame as a baseline of their own, and then ring once per new one. */

import type { MemoryNeed } from "kolu-common/conductorMemory";
import type { NeedsYou, WorkId } from "kolu-work";

/** One reading of everything the bell watches. */
export interface BellReading {
  /** The conversation's own open questions — the ones that belong to no
   *  work. */
  readonly ownAsks: readonly string[];
  /** Every open question about a work, as the server lists them — ahead of
   *  the works' records, which arrive one at a time. */
  readonly workAsks: readonly string[];
  /** The works this browser has the record of. */
  readonly works: ReadonlySet<WorkId>;
  /** The one needs-you reading. */
  readonly needs: ReadonlyArray<NeedsYou>;
  /** Memory's one item, `null` while no proposal waits — `undefined` until
   *  the memory's first frame, which is its own baseline. Its identity is the
   *  turn of its newest waiting proposal, so a batch rings once and a later
   *  turn rings again. */
  readonly memory: MemoryNeed | null | undefined;
}

/** What one reading rang for. */
export interface Rang {
  readonly items: ReadonlyArray<NeedsYou>;
  /** How many of the conversation's own questions are open, when a new one
   *  arrived in this reading; otherwise `null`. */
  readonly ownOpen: number | null;
  readonly memory: MemoryNeed | null;
}

export interface ConductorBellHooks {
  /** Hand over what is new. Whether and how it reaches the human is the one
   *  path's (`attend.ts`), never decided here. */
  deliver(rang: Rang): void;
}

export interface ConductorBell {
  /** Feed one reading. Nothing in it is kept but what is NEW in it. */
  observe(reading: BellReading): void;
}

/** How the bell remembers a thing it has heard. */
const tokenOf = (item: NeedsYou): string =>
  item.why.why === "question" ? `ask:${item.why.ask}` : item.key;

export function createConductorBell(hooks: ConductorBellHooks): ConductorBell {
  let started = false;
  let memoryStarted = false;
  const heard = new Set<string>();
  const known = new Set<WorkId>();
  return {
    observe(reading) {
      let memory: MemoryNeed | null = null;
      if (reading.memory !== undefined) {
        if (reading.memory !== null) {
          const token = `memory:${reading.memory.identity}`;
          if (!heard.has(token)) {
            heard.add(token);
            if (memoryStarted) memory = reading.memory;
          }
        }
        memoryStarted = true;
      }
      const items: NeedsYou[] = [];
      let own = false;
      if (!started) {
        started = true;
        for (const id of [...reading.ownAsks, ...reading.workAsks])
          heard.add(`ask:${id}`);
        for (const item of reading.needs) heard.add(tokenOf(item));
      } else {
        for (const item of reading.needs) {
          const token = tokenOf(item);
          if (heard.has(token)) continue;
          heard.add(token);
          if (known.has(item.work) || item.why.why === "question")
            items.push(item);
        }
        for (const id of reading.ownAsks) {
          const token = `ask:${id}`;
          if (heard.has(token)) continue;
          heard.add(token);
          own = true;
        }
      }
      for (const work of reading.works) known.add(work);
      if (items.length > 0 || own || memory !== null)
        hooks.deliver({
          items,
          ownOpen: own ? reading.ownAsks.length : null,
          memory,
        });
    },
  };
}
