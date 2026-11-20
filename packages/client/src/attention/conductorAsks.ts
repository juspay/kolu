/** The Conductor's bell — when something that needs YOU rings.
 *
 *  Two kinds of thing ring here, through the SAME channel the terminals use
 *  (`useAttention` hands the delivery in: one sound, one notification seam,
 *  one switch):
 *
 *   - an ITEM of the one needs-you reading (`kolu-work`'s `needsYou`): a
 *     question put about a piece of work, or a green PR handed over to you;
 *   - a question the conversation asks that belongs to NO work — the
 *     conversation's own, which has no card.
 *
 *  What is decided here is only WHEN, off the wire so it is unit-testable —
 *  the same split `attentionCore` makes for terminals.
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
 *    • SEEN IS SEEN. An item counts as heard whether or not it rang: one that
 *      arrived while alerts were off, or while it was on screen in a focused
 *      window, must not ring the moment you look away or turn alerts back on.
 *    • ON SCREEN IS THE ONLY SILENCE. Looking at the Conductor does not quiet
 *      a new item; that very item being visible does — its question, or for a
 *      merge its card. The conversation's own question has no card, so it is
 *      quiet while the Conductor is on screen in a focused window. */

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

export interface ConductorBellHooks {
  /** The master gate — the `attentionAlerts` preference. */
  alertsEnabled(): boolean;
  /** Is this item on screen in a focused window? (`isNeedInView`) */
  isItemWatched(item: NeedsYou): boolean;
  /** Is the conversation on screen in a focused window? — the silence for a
   *  question that belongs to no work, and for memory. */
  isConversationWatched(): boolean;
  /** Reach the user — one sound — with each work item that rang, how many
   *  of the conversation's own questions are open if one of them rang, and
   *  memory's item if it rang. */
  deliver(
    items: ReadonlyArray<NeedsYou>,
    ownOpen: number | null,
    memory: MemoryNeed | null,
  ): void;
}

export interface ConductorBell {
  /** Feed one reading. Read during the call; nothing in it is kept but what
   *  is NEW in it. Answers whether anything new is waiting for
   *  {@link ConductorBell.settle}. */
  observe(reading: BellReading): boolean;
  /** DECIDE about what `observe` heard — called once the page has had the
   *  chance to draw and measure it. A new question arrives in the same pass
   *  that mounts its box, and the box can only say it is in view after
   *  layout; asking at `observe` would find every new item off screen. An
   *  item that has left the list since is not rung for. */
  settle(): void;
}

/** How the bell remembers a thing it has heard. */
const tokenOf = (item: NeedsYou): string =>
  item.why.why === "question" ? `ask:${item.why.ask}` : item.key;

export function createConductorBell(hooks: ConductorBellHooks): ConductorBell {
  let started = false;
  const heard = new Set<string>();
  const known = new Set<WorkId>();
  /** What was heard and not yet decided about. */
  let pending: NeedsYou[] = [];
  let pendingOwn = false;
  let memoryStarted = false;
  let pendingMemory = false;
  /** The latest reading's items, how many of the conversation's own
   *  questions it had open, and memory's item — what is still waiting when
   *  the bell comes to decide. */
  let current: ReadonlySet<string> = new Set();
  let ownOpen = 0;
  let memory: MemoryNeed | null = null;
  return {
    observe(reading) {
      current = new Set(reading.needs.map(tokenOf));
      ownOpen = reading.ownAsks.length;
      if (reading.memory !== undefined) {
        memory = reading.memory;
        const token =
          reading.memory === null ? null : `memory:${reading.memory.identity}`;
        if (!memoryStarted) {
          memoryStarted = true;
          if (token !== null) heard.add(token);
        } else if (token !== null && !heard.has(token)) {
          heard.add(token);
          pendingMemory = true;
        }
      }
      if (!started) {
        started = true;
        for (const id of [...reading.ownAsks, ...reading.workAsks])
          heard.add(`ask:${id}`);
        for (const item of reading.needs) heard.add(tokenOf(item));
        for (const work of reading.works) known.add(work);
        return false;
      }
      for (const item of reading.needs) {
        const token = tokenOf(item);
        if (heard.has(token)) continue;
        heard.add(token);
        if (known.has(item.work) || item.why.why === "question")
          pending.push(item);
      }
      for (const id of reading.ownAsks) {
        const token = `ask:${id}`;
        if (heard.has(token)) continue;
        heard.add(token);
        pendingOwn = true;
      }
      for (const work of reading.works) known.add(work);
      return pending.length > 0 || pendingOwn || pendingMemory;
    },
    settle() {
      const items = pending.filter(
        (item) =>
          current.has(tokenOf(item)) &&
          hooks.alertsEnabled() &&
          !hooks.isItemWatched(item),
      );
      const own =
        pendingOwn &&
        ownOpen > 0 &&
        hooks.alertsEnabled() &&
        !hooks.isConversationWatched();
      const rang =
        pendingMemory &&
        memory !== null &&
        hooks.alertsEnabled() &&
        !hooks.isConversationWatched()
          ? memory
          : null;
      pending = [];
      pendingOwn = false;
      pendingMemory = false;
      if (items.length > 0 || own || rang !== null)
        hooks.deliver(items, own ? ownOpen : null, rang);
    },
  };
}
