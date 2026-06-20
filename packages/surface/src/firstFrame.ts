/**
 * Read the first frame of a snapshot-then-delta stream — the surface protocol
 * guarantees every cell/collection subscription OPENS with a snapshot frame, so
 * "the first value the stream yields" is the current snapshot.
 *
 * The single axis here is the snapshot contract; the only thing that varies per
 * consumer is the empty-stream POLICY — an empty stream means "no snapshot ever
 * arrived", which some callers treat as a benign "no value yet" and others as a
 * hard link/protocol failure. That policy is the parameter, captured by two thin
 * named exports over one shared core so the contract assumption lives in one
 * place:
 *
 *   - `firstFrameOrUndefined` — empty stream ⇒ `undefined` (benign absence).
 *   - `firstFrameOrThrow`     — empty stream ⇒ throw (a missing snapshot is a
 *                               failure; collapsing it to `undefined` would hide
 *                               a broken link — see `.agency/code-police.md` →
 *                               caught-error-must-not-collapse-to-empty).
 *
 * Returning out of the loop closes the underlying subscription.
 */

/** The first value an async stream yields, or `undefined` if it ends empty. */
export async function firstFrameOrUndefined<T>(
  stream: AsyncIterable<T>,
): Promise<T | undefined> {
  for await (const frame of stream) return frame;
  return undefined;
}

/** The first value an async stream yields; throws `onEmptyMessage` if the stream
 *  ends without ever yielding a snapshot frame. */
export async function firstFrameOrThrow<T>(
  stream: AsyncIterable<T>,
  onEmptyMessage: string,
): Promise<T> {
  for await (const frame of stream) return frame;
  throw new Error(onEmptyMessage);
}
