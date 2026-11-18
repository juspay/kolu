/**
 * WHAT THE CLIENT ASKS ITS CALLER TO REMEMBER, as the interfaces its options
 * take.
 *
 * Where a machine keeps "which conversation, on which model" is the product's
 * fact, not a protocol fact, so the client never stores anything itself: it is
 * handed a {@link Memory} and a {@link Models} and calls them. These are the
 * shapes of those two doors and of the one failure they report; the stores
 * behind them stay with the product that owns them.
 */

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

/**
 * Two verbs and a record: the socket, and everything volatile is behind it.
 *
 * What CHANGES back there is where the file lives, what is in it, whether it is
 * one file or a row of an index, and whether a machine keeps this at all. What
 * does not is the pair below — the client says where it is and what it is on,
 * and a boot asks what that was.
 */
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
