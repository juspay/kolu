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
 *      known by its ask alone, so a question this browser first heard of as
 *      the conversation's own (its work's record had not arrived yet) is not
 *      rung a second time when the record lands. The remembered set only
 *      grows: kolu PR #2400's merge answer went can, cannot, can about one
 *      commit inside two minutes, and that is one ring.
 *    • ATTENTION IS A TRANSITION, NOT A DISCOVERY. The first reading (the
 *      conversation's first frame) is a baseline and never rings. After it,
 *      the works arrive one record at a time, so a work met for the first
 *      time is a discovery too — its wait rang (or did not) before this
 *      browser was looking — UNLESS it is a question that was not open in the
 *      baseline, which is a work born asking.
 *    • SEEN IS SEEN. An item counts as heard whether or not it rang: one that
 *      arrived while alerts were off, or while it was on screen in a focused
 *      window, must not ring the moment you look away or turn alerts back on.
 *    • ON SCREEN IS THE ONLY SILENCE. Looking at the Conductor does not quiet
 *      a new item; that very item being visible does — its question, or for a
 *      merge its card. The conversation's own question has no card, so it is
 *      quiet while the Conductor is on screen in a focused window. */

import type { NeedsYou, WorkId } from "kolu-work";

/** One reading of everything the bell watches. */
export interface BellReading {
  /** Every open ask the conversation reports — its own and every work's. */
  readonly openAsks: readonly string[];
  /** The asks among those no work owns: the conversation's own questions. */
  readonly ownAsks: readonly string[];
  /** The works this browser has the record of. */
  readonly works: ReadonlySet<WorkId>;
  /** The one needs-you reading. */
  readonly needs: ReadonlyArray<NeedsYou>;
}

export interface ConductorBellHooks {
  /** The master gate — the `attentionAlerts` preference. */
  alertsEnabled(): boolean;
  /** Is this item on screen in a focused window? ({@link isItemInView}) */
  isItemWatched(item: NeedsYou): boolean;
  /** Is the conversation on screen in a focused window? — the silence for a
   *  question that belongs to no work. */
  isConversationWatched(): boolean;
  /** Reach the user — one sound — with each work item that rang, and how many
   *  of the conversation's own questions are open if one of them rang. */
  deliver(items: ReadonlyArray<NeedsYou>, ownOpen: number | null): void;
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

/** IS THIS ITEM IN VIEW — in a focused window, its question (wherever it is
 *  drawn) or, for a merge wait, its card. Looking at the Conductor is not
 *  looking at the item, and an unfocused window is looking at nothing. */
export function isItemInView(
  item: NeedsYou,
  focused: boolean,
  onScreen: (what: { kind: "ask" | "card"; id: string }) => boolean,
): boolean {
  return (
    focused &&
    onScreen(
      item.why.why === "question"
        ? { kind: "ask", id: item.why.ask }
        : { kind: "card", id: item.work },
    )
  );
}

/** How the bell remembers a thing it has heard. */
const tokenOf = (item: NeedsYou): string =>
  item.why.why === "question" ? `ask:${item.why.ask}` : item.key;

export function createConductorBell(hooks: ConductorBellHooks): ConductorBell {
  let baseline: ReadonlySet<string> | undefined;
  const heard = new Set<string>();
  const known = new Set<WorkId>();
  /** What was heard and not yet decided about. */
  let pending: NeedsYou[] = [];
  let pendingOwn = false;
  /** The latest reading's items and own asks — what is still waiting when
   *  the bell comes to decide. */
  let current: ReadonlySet<string> = new Set();
  let ownOpen = 0;
  return {
    observe(reading) {
      current = new Set([
        ...reading.needs.map(tokenOf),
        ...reading.ownAsks.map((id) => `ask:${id}`),
      ]);
      ownOpen = reading.ownAsks.length;
      if (baseline === undefined) {
        baseline = new Set(reading.openAsks);
        for (const id of reading.openAsks) heard.add(`ask:${id}`);
        for (const item of reading.needs) heard.add(tokenOf(item));
        for (const work of reading.works) known.add(work);
        return false;
      }
      const opened = baseline;
      for (const item of reading.needs) {
        const token = tokenOf(item);
        if (heard.has(token)) continue;
        heard.add(token);
        const news =
          known.has(item.work) ||
          (item.why.why === "question" && !opened.has(item.why.ask));
        if (news) pending.push(item);
      }
      for (const id of reading.ownAsks) {
        const token = `ask:${id}`;
        if (heard.has(token)) continue;
        heard.add(token);
        pendingOwn = true;
      }
      for (const work of reading.works) known.add(work);
      return pending.length > 0 || pendingOwn;
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
      pending = [];
      pendingOwn = false;
      if (items.length > 0 || own) hooks.deliver(items, own ? ownOpen : null);
    },
  };
}
