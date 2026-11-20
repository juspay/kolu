/** THE CONDUCTOR'S MEMORY in the browser — ONE subscription to kolu-server's
 *  `conductorMemory` cell, and the human's five choices on it.
 *
 *  Each choice answers a promise: `null` when it was made, or the store's
 *  sentence when it was refused, so the face that asked can show the refusal
 *  where the person is looking (on the card, in the editor). A failure that
 *  is not a refusal is a toast. */

import {
  type ConductorMemoryView,
  EMPTY_MEMORY_VIEW,
  type MemoryEntry,
  type MemoryProposal,
  type MemoryText,
  memoryNeed,
  memoryUsed,
} from "kolu-common/conductorMemory";
import type { Effect } from "effect";
import { type Accessor, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../../createSharedRoot";
import { runActionPromise } from "../../runAction";
import { createDisclosure } from "../../ui/createDisclosure";
import { app } from "../../wire";

/** The Memory sheet — opened from the `⋯` menu, the header chip and a
 *  memory notification. */
export const memorySheet = createDisclosure();

/** A choice was made (`null`), or refused with this sentence. */
export type MemoryAnswer = string | null;

export interface ConductorMemory {
  /** The cell as it arrived — `undefined` until kolu-server's first frame. */
  readonly cell: Accessor<ConductorMemoryView | undefined>;
  readonly view: Accessor<ConductorMemoryView>;
  /** Characters of titles and bodies remembered. */
  readonly used: Accessor<number>;
  /** The proposal by that id while it still waits; settled, it is gone. */
  readonly waiting: (proposal: string) => MemoryProposal | undefined;
  /** How many proposals of this proposal's turn wait with it. */
  readonly inBatch: (proposal: string) => number;
  readonly approve: (
    proposal: string,
    edited: MemoryText | null,
  ) => Promise<MemoryAnswer>;
  readonly decline: (proposal: string) => Promise<MemoryAnswer>;
  readonly save: (
    text: MemoryText,
    entry: string | null,
  ) => Promise<MemoryAnswer>;
  readonly remove: (entry: MemoryEntry) => Promise<MemoryAnswer>;
  readonly importEntries: (
    entries: ReadonlyArray<MemoryText>,
  ) => Promise<MemoryAnswer>;
}

const refusalOf = (err: unknown): string | null =>
  typeof err === "object" &&
  err !== null &&
  "_tag" in err &&
  err._tag === "MemoryRefused" &&
  "why" in err &&
  typeof err.why === "string"
    ? err.why
    : null;

/** Run a choice; a refusal comes back as its sentence, anything else is a
 *  toast naming what failed. */
const choose = <A>(
  label: string,
  effect: Effect.Effect<A, unknown>,
  done?: (value: A) => void,
): Promise<MemoryAnswer> =>
  runActionPromise(effect).then(
    (value) => {
      done?.(value);
      return null;
    },
    (err: unknown) => {
      const refusal = refusalOf(err);
      if (refusal !== null) return refusal;
      toast.error(
        `${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return `${label}.`;
    },
  );

export const useMemory = createSharedRoot((): ConductorMemory => {
  const { value: cell } = app.cells.conductorMemory.use();
  const view = createMemo(() => cell() ?? EMPTY_MEMORY_VIEW);
  const memory = app.procedures.conductor;
  return {
    cell,
    view,
    used: createMemo(() => memoryUsed(view().entries)),
    waiting: (id) => view().proposals.find((one) => one.id === id),
    inBatch: (id) => {
      const batch = view().proposals.find((one) => one.id === id)?.batch;
      return batch === undefined
        ? 0
        : view().proposals.filter((one) => one.batch === batch).length;
    },
    approve: (proposal, edited) =>
      choose(
        "Could not remember it",
        memory.approveMemory({ proposal, edited }),
      ),
    decline: (proposal) =>
      choose("Could not decline it", memory.declineMemory({ proposal })),
    save: (text, entry) =>
      choose("Could not save the memory", memory.saveMemory({ entry, text })),
    remove: (entry) =>
      choose(
        "Could not delete the memory",
        memory.deleteMemory({ entry: entry.id }),
      ),
    importEntries: (entries) =>
      choose(
        "Could not import",
        memory.importMemory({ entries: [...entries] }),
        (added) => {
          toast.success(
            added.added === 1
              ? "Added 1 memory"
              : `Added ${added.added} memories`,
          );
        },
      ),
  };
});

/** Memory's one item in "what needs you", or `null` while nothing waits —
 *  `undefined` before kolu-server's first frame, which the bell takes as its
 *  baseline rather than as news. */
export const useMemoryNeed = createSharedRoot(() => {
  const memory = useMemory();
  return createMemo(() => {
    const cell = memory.cell();
    return cell === undefined ? undefined : memoryNeed(cell);
  });
});
