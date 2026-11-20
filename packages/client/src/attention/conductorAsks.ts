import type { NeedsYou, WorkId } from "kolu-work";

export interface BellReading {
  readonly ownAsks: readonly string[];
  readonly workAsks: readonly string[];
  readonly works: ReadonlySet<WorkId>;
  readonly needs: ReadonlyArray<NeedsYou>;
}

export interface ConductorBellHooks {
  alertsEnabled(): boolean;
  isItemWatched(item: NeedsYou): boolean;
  isConversationWatched(): boolean;
  deliver(items: ReadonlyArray<NeedsYou>, ownOpen: number | null): void;
}

export interface ConductorBell {
  observe(reading: BellReading): boolean;
  settle(): void;
}

const tokenOf = (item: NeedsYou): string =>
  item.why.why === "question" ? `ask:${item.why.ask}` : item.key;

export function createConductorBell(hooks: ConductorBellHooks): ConductorBell {
  let started = false;
  const heard = new Set<string>();
  const known = new Set<WorkId>();
  let pending: NeedsYou[] = [];
  let pendingOwn = false;
  let current: ReadonlySet<string> = new Set();
  let ownOpen = 0;
  return {
    observe(reading) {
      current = new Set(reading.needs.map(tokenOf));
      ownOpen = reading.ownAsks.length;
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
