import { Data, type Effect } from "effect";

/** A remembered store could not be read or written, and why. */
export class MemoryFailure extends Data.TaggedError("MemoryFailure")<{
  readonly why: string;
}> {
  override get message(): string {
    return this.why;
  }
}

export interface MemorySnapshot {
  /** Which agent the conversation is with. */
  readonly agent: string;
  readonly session: string;
  /** `null` for "nothing says" — a conversation entered but never heard of
   *  again, a record written before models were remembered, or a client that
   *  has not yet been told which model it is on. */
  readonly model: string | null;
}

export interface Memory {
  /** What this directory's client was last in and on, or `null` when nothing
   *  has been written down yet. */
  readonly recall: Effect.Effect<MemorySnapshot | null, MemoryFailure>;
  /** ... and writing it down. Called whenever the client enters a conversation
   *  or learns that the model under it has moved, which are the only two
   *  moments the answer changes. */
  readonly remember: (
    held: MemorySnapshot,
  ) => Effect.Effect<void, MemoryFailure>;
}

/** One conversation with one agent — the key a model choice is kept under. */
export interface Conversing {
  readonly agent: string;
  readonly session: string;
}

/** The model a person confirmed for a conversation, kept by the caller. */
export interface Models {
  readonly read: (
    to: Conversing,
  ) => Effect.Effect<string | null, MemoryFailure>;
  readonly write: (
    to: Conversing,
    model: string,
  ) => Effect.Effect<void, MemoryFailure>;
}
