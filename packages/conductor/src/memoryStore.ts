/**
 * THE CONDUCTOR'S MEMORY, AND ITS ONE WRITER.
 *
 * Every change to the `memory` record goes through here: the Conductor's
 * proposals, the human's approvals, declines and own edits, an import, a
 * restored backup. Each verb either makes its change or throws
 * {@link MemoryRefused} with the sentence for whoever asked, and nothing is
 * cut short to fit.
 *
 * A proposal is not memory: only an approval, the human's own edit or an
 * import changes `entries`, and those are the changes `entriesChanged` hears.
 */

import {
  EMPTY_MEMORY,
  MEMORY_CAP,
  MEMORY_DECLINED_KEPT,
  MEMORY_WAITING_CAP,
  type Memory,
  type MemoryChange,
  type MemoryEntry,
  type MemoryProposal,
  MemoryRefused,
  type MemoryText,
  memoryDay,
  memoryFullRefusal,
  memorySize,
  memoryTextRefusal,
  memoryUsed,
  memoryWhyRefusal,
  sameMemory,
  tidyMemoryText,
} from "kolu-common/conductorMemory";
import type { RecordWrites } from "./recordWrites.ts";

/** How an approved proposal ended, as its row says it. */
export type MemoryApproved = "remembered" | "edited" | "forgotten";

/** What an import did: how many it added, and how many it already had. */
export interface MemoryImported {
  readonly added: number;
  readonly already: number;
}

export interface MemoryStore {
  /** The boot read. */
  readonly load: (memory: Memory) => void;
  /** The whole record, as it stands. */
  readonly read: () => Memory;
  /** THE CONDUCTOR ASKS. Records the proposal, waiting on the human. `batch`
   *  is the turn it came from, or `null` outside any turn: then it is a batch
   *  of its own, and rings once. */
  readonly propose: (
    change: MemoryChange,
    why: string | null,
    batch: string | null,
  ) => MemoryProposal;
  /** THE HUMAN SAYS YES, as proposed or with their own words. */
  readonly approve: (id: string, edited?: MemoryText) => MemoryApproved;
  /** THE HUMAN SAYS NO. Kept, so the same proposal is refused again. */
  readonly decline: (id: string) => void;
  /** THE HUMAN WRITES: a new entry, or theirs over an existing one. */
  readonly save: (text: MemoryText, entry?: string) => MemoryEntry;
  readonly remove: (entry: string) => void;
  /** THE HUMAN IMPORTS. Never deletes; adds what is not already
   *  remembered, or nothing at all when it would not fit. */
  readonly importEntries: (texts: ReadonlyArray<MemoryText>) => MemoryImported;
  /** THE WHOLE RECORD, REPLACED — a restored backup. */
  readonly restore: (memory: Memory) => void;
}

export interface MemoryStoreDeps {
  readonly records: RecordWrites<"memory">;
  /** The record moved: every reader is owed it. */
  readonly publish: (memory: Memory) => void;
  /** The entries moved: the Conductor is owed its memory again. */
  readonly entriesChanged: () => void;
  readonly now: () => Date;
}

const refused = (kind: MemoryRefused["kind"], why: string): MemoryRefused =>
  new MemoryRefused({ kind, why });

const sameChange = (a: MemoryChange, b: MemoryChange): boolean => {
  switch (a.kind) {
    case "add":
      return b.kind === "add" && sameMemory(a, b);
    case "replace":
      return b.kind === "replace" && a.entry === b.entry && sameMemory(a, b);
    case "forget":
      return b.kind === "forget" && a.entry === b.entry;
  }
};

const tidyChange = (change: MemoryChange): MemoryChange =>
  change.kind === "forget" ? change : { ...change, ...tidyMemoryText(change) };

export const memoryStore = (deps: MemoryStoreDeps): MemoryStore => {
  let memory: Memory = EMPTY_MEMORY;

  const nowIso = (): string => deps.now().toISOString();

  const entryAt = (id: string): MemoryEntry | undefined =>
    memory.entries.find((entry) => entry.id === id);

  const mustEntry = (id: string): MemoryEntry => {
    const entry = entryAt(id);
    if (entry === undefined)
      throw refused("no-such-entry", `There is no memory ${id}.`);
    return entry;
  };

  const mustText = (text: MemoryText): MemoryText => {
    const tidy = tidyMemoryText(text);
    const refusal = memoryTextRefusal(tidy);
    if (refusal !== null) throw refusal;
    return tidy;
  };

  /** Refuses a change that would take the entries past the cap. `replacing`
   *  is the entry whose room the change takes over. */
  const mustFit = (text: MemoryText, replacing?: MemoryEntry): void => {
    const left =
      MEMORY_CAP -
      memoryUsed(memory.entries) +
      (replacing === undefined ? 0 : memorySize(replacing));
    const needs = memorySize(text);
    if (needs > left) throw memoryFullRefusal(needs, Math.max(left, 0));
  };

  const mustBeNew = (text: MemoryText, besides?: string): void => {
    const same = memory.entries.find(
      (entry) => entry.id !== besides && sameMemory(entry, text),
    );
    if (same !== undefined)
      throw refused(
        "already-remembered",
        `This is already remembered, as ${same.id} "${same.title}".`,
      );
  };

  const mint = (prefix: "m" | "p"): string => {
    const id = `${prefix}${memory.next}`;
    memory = { ...memory, next: memory.next + 1 };
    return id;
  };

  const moved = (entries: boolean): void => {
    deps.publish(memory);
    deps.records.schedule("memory");
    if (entries) deps.entriesChanged();
  };

  const mustProposal = (id: string): MemoryProposal => {
    const proposal = memory.proposals.find((one) => one.id === id);
    if (proposal === undefined)
      throw refused(
        "no-such-proposal",
        `There is no proposal ${id} waiting: it was settled already.`,
      );
    return proposal;
  };

  const settle = (id: string): void => {
    memory = {
      ...memory,
      proposals: memory.proposals.filter((one) => one.id !== id),
    };
  };

  const entryFrom = (
    text: MemoryText,
    by: MemoryEntry["by"],
    edited: boolean,
  ): MemoryEntry => ({
    id: mint("m"),
    ...text,
    by,
    edited,
    at: nowIso(),
  });

  return {
    load: (kept) => {
      memory = kept;
    },
    read: () => memory,

    propose: (asked, askedWhy, batch) => {
      const change = tidyChange(asked);
      if (change.kind !== "forget") mustText(change);
      const trimmedWhy = askedWhy?.trim() ?? "";
      const why = trimmedWhy === "" ? null : trimmedWhy;
      const whyRefusal = memoryWhyRefusal(why);
      if (whyRefusal !== null) throw whyRefusal;
      const replacing =
        change.kind === "add" ? undefined : mustEntry(change.entry);
      const declined = memory.declined.find((one) =>
        sameChange(one.change, change),
      );
      if (declined !== undefined)
        throw refused(
          "declined-before",
          `The human declined this on ${memoryDay(declined.at)}. It is not remembered. Do not propose it again.`,
        );
      if (change.kind !== "forget") mustBeNew(change);
      if (memory.proposals.some((one) => sameChange(one.change, change)))
        throw refused(
          "already-waiting",
          "The same proposal is already waiting on the human.",
        );
      if (memory.proposals.length >= MEMORY_WAITING_CAP)
        throw refused(
          "too-many-waiting",
          `${MEMORY_WAITING_CAP} proposals are already waiting on the human. Propose again once they have chosen.`,
        );
      if (change.kind !== "forget") mustFit(change, replacing);
      const id = mint("p");
      const proposal: MemoryProposal = {
        id,
        change,
        why,
        at: nowIso(),
        batch: batch ?? id,
      };
      memory = { ...memory, proposals: [...memory.proposals, proposal] };
      moved(false);
      return proposal;
    },

    approve: (id, editedText) => {
      const { change } = mustProposal(id);
      if (change.kind === "forget") {
        if (editedText !== undefined)
          throw refused("invalid", "A proposal to forget has nothing to edit.");
        settle(id);
        const kept = memory.entries.filter(
          (entry) => entry.id !== change.entry,
        );
        const forgot = kept.length !== memory.entries.length;
        memory = { ...memory, entries: kept };
        moved(forgot);
        return "forgotten";
      }
      const proposed = tidyMemoryText(change);
      const text = editedText === undefined ? proposed : mustText(editedText);
      const edited =
        text.title !== proposed.title ||
        text.about !== proposed.about ||
        text.body !== proposed.body;
      const replacing =
        change.kind === "replace" ? entryAt(change.entry) : undefined;
      mustBeNew(text, replacing?.id);
      mustFit(text, replacing);
      settle(id);
      if (replacing === undefined) {
        const entry = entryFrom(text, "conductor", edited);
        memory = { ...memory, entries: [...memory.entries, entry] };
      } else
        memory = {
          ...memory,
          entries: memory.entries.map((entry) =>
            entry.id === replacing.id
              ? { ...entry, ...text, by: "conductor", edited, at: nowIso() }
              : entry,
          ),
        };
      moved(true);
      return edited ? "edited" : "remembered";
    },

    decline: (id) => {
      const { change } = mustProposal(id);
      settle(id);
      memory = {
        ...memory,
        declined: [...memory.declined, { change, at: nowIso() }].slice(
          -MEMORY_DECLINED_KEPT,
        ),
      };
      moved(false);
    },

    save: (written, id) => {
      const text = mustText(written);
      const replacing = id === undefined ? undefined : mustEntry(id);
      mustBeNew(text, replacing?.id);
      mustFit(text, replacing);
      const entry: MemoryEntry =
        replacing === undefined
          ? entryFrom(text, "you", false)
          : {
              ...replacing,
              ...text,
              edited: replacing.by === "conductor" || replacing.edited,
              at: nowIso(),
            };
      memory = {
        ...memory,
        entries:
          replacing === undefined
            ? [...memory.entries, entry]
            : memory.entries.map((one) => (one.id === entry.id ? entry : one)),
      };
      moved(true);
      return entry;
    },

    remove: (id) => {
      mustEntry(id);
      memory = {
        ...memory,
        entries: memory.entries.filter((entry) => entry.id !== id),
      };
      moved(true);
    },

    importEntries: (texts) => {
      const fresh: Array<MemoryText> = [];
      for (const text of texts.map(mustText)) {
        const known =
          memory.entries.some((entry) => sameMemory(entry, text)) ||
          fresh.some((one) => sameMemory(one, text));
        if (!known) fresh.push(text);
      }
      const needs = memoryUsed(fresh);
      const left = MEMORY_CAP - memoryUsed(memory.entries);
      if (needs > left)
        throw refused(
          "full",
          `Nothing was added. ${memoryFullRefusal(needs, Math.max(left, 0)).why}`,
        );
      if (fresh.length > 0) {
        const added = fresh.map((text) => entryFrom(text, "you", false));
        memory = { ...memory, entries: [...memory.entries, ...added] };
        moved(true);
      }
      return { added: fresh.length, already: texts.length - fresh.length };
    },

    restore: (kept) => {
      memory = kept;
      moved(true);
    },
  };
};
