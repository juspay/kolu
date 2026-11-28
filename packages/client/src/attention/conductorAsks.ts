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
 *   - proposals the Conductor would like to remember;
 *   - a finished reply to a message the person typed — once per reply.
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
 *    • MEMORY AND REPLIES TO A MESSAGE THE PERSON TYPED each take their own
 *      first reading as a baseline, and then ring once per new one; the
 *      conversation's own questions are heard with the conversation's first
 *      reading. */

import type { MemoryNeed } from "kolu-common/conductorMemory";
import type { NeedsYou, WorkId } from "kolu-work";
import type { TypedReply } from "../conductor/typedReply";

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
  /** The newest finished reply to a message the person typed; `undefined`
   *  while no conversation is open in this page, and the first reading that
   *  has one is its own baseline. */
  readonly reply: TypedReply | null | undefined;
}

/** What one reading rang for. */
export interface Rang {
  readonly items: ReadonlyArray<NeedsYou>;
  /** How many of the conversation's own questions are open, when a new one
   *  arrived in this reading; otherwise `null`. */
  readonly ownOpen: number | null;
  readonly memory: MemoryNeed | null;
  readonly reply: TypedReply | null;
}

/** WHERE THE PERSON IS, taken with the reading that may ring — carried from
 *  `observe` straight to `deliver`, never read here: a ring is handed the
 *  facts its OWN reading came with, rather than whatever the view says by
 *  the time the delivery runs. */
export interface BellView {
  /** Is the conversation the view on screen? Whether the WINDOW has focus is
   *  a DOM question, asked at the instant of the ring. */
  readonly conductorShown: boolean;
  /** The title of the work a typed reply belongs to, when it has one. */
  readonly replyTitle: string | undefined;
  readonly alertsEnabled: boolean;
}

export interface ConductorBellHooks {
  /** Hand over what is new, with the view its reading was taken with.
   *  Whether and how it reaches the human is the one path's (`attend.ts`),
   *  never decided here. */
  deliver(rang: Rang, view: BellView): void;
}

export interface ConductorBell {
  /** Feed one reading and the view it was taken with. Nothing in it is kept
   *  but what is NEW in it. */
  observe(reading: BellReading, view: BellView): void;
}

/** How the bell remembers a thing it has heard. */
const tokenOf = (item: NeedsYou): string =>
  item.why.why === "question" ? `ask:${item.why.ask}` : item.key;

export function createConductorBell(hooks: ConductorBellHooks): ConductorBell {
  let started = false;
  const heard = new Set<string>();
  const known = new Set<WorkId>();
  const memoryBase = { started: false };
  const replyBase = { started: false };
  /** ONE SOURCE THAT ARRIVES ON ITS OWN CLOCK — memory, or a reply. Its first
   *  reading is its baseline, each token is heard once, and only a token
   *  heard after that baseline is news. Answers the item when it is news,
   *  else `null`. Called on every reading that HAS the source, base or not. */
  const freshItem = <T>(
    baseline: { started: boolean },
    item: T | null,
    token: (item: T) => string,
  ): T | null => {
    const key = item === null ? null : token(item);
    const fresh = baseline.started && key !== null && !heard.has(key);
    if (key !== null) heard.add(key);
    baseline.started = true;
    return fresh ? item : null;
  };
  return {
    observe(reading, view) {
      const memory =
        reading.memory === undefined
          ? null
          : freshItem(
              memoryBase,
              reading.memory,
              (m) => `memory:${m.identity}`,
            );
      const reply =
        reading.reply === undefined
          ? null
          : freshItem(replyBase, reading.reply, (r) => `reply:${r.turn}`);
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
      if (items.length > 0 || own || memory !== null || reply !== null)
        hooks.deliver(
          {
            items,
            ownOpen: own ? reading.ownAsks.length : null,
            memory,
            reply,
          },
          view,
        );
    },
  };
}
