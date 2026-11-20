/**
 * The protocol's compaction reports, read as data.
 *
 * An agent that was told the client takes them (`clientCapabilities.session.
 * compaction`) reports each time it replaces older conversation with a
 * summary: `compaction_update` says where one compaction is, keyed by its id,
 * and `compaction_summary_chunk` appends to its summary. Pure, like
 * {@link ./usage.ts}: folding the chunks per id is the caller's.
 */

/** Where one compaction is. `cancelled` is what an agent says when the turn
 *  that held an unfinished compaction ended. */
export type CompactionStatus =
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

/** One report, in the wire's two kinds. On an `update`, `summary` replaces
 *  the whole summary when it is a string and leaves it as it was when `null`
 *  (the wire's omission; its explicit clear reads as `""`). */
export type CompactionReport =
  | {
      readonly kind: "update";
      readonly id: string;
      readonly status: CompactionStatus;
      readonly summary: string | null;
      readonly error: string | null;
    }
  | { readonly kind: "chunk"; readonly id: string; readonly text: string };

const STATUSES: Readonly<Record<CompactionStatus, true>> = {
  in_progress: true,
  completed: true,
  failed: true,
  cancelled: true,
};

const isStatus = (word: unknown): word is CompactionStatus =>
  typeof word === "string" && Object.hasOwn(STATUSES, word);

const textOf = (block: unknown): string => {
  const shape = block as { readonly type?: unknown; readonly text?: unknown };
  return shape?.type === "text" && typeof shape.text === "string"
    ? shape.text
    : "";
};

/** The report an update carries, or `null` for anything else: another update
 *  kind, a report without an id, a status this reading does not know. */
export const compactionIn = (update: unknown): CompactionReport | null => {
  const frame = update as {
    readonly sessionUpdate?: unknown;
    readonly compactionId?: unknown;
    readonly status?: unknown;
    readonly summary?: unknown;
    readonly error?: unknown;
    readonly content?: unknown;
  } | null;
  const id = frame?.compactionId;
  if (typeof id !== "string" || id === "") return null;
  if (frame?.sessionUpdate === "compaction_summary_chunk") {
    const text = textOf(frame.content);
    return text === "" ? null : { kind: "chunk", id, text };
  }
  if (frame?.sessionUpdate !== "compaction_update") return null;
  const status = frame.status;
  if (!isStatus(status)) return null;
  const summary =
    frame.summary === undefined
      ? null
      : Array.isArray(frame.summary)
        ? frame.summary.map(textOf).join("")
        : "";
  const error =
    typeof frame.error === "string" && frame.error !== "" ? frame.error : null;
  return { kind: "update", id, status, summary, error };
};
