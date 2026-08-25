/**
 * What an unknown thrown thing SAYS — padi's one answer, with nothing under it.
 *
 * A leaf by construction: no imports at all, so any module in the package can
 * reach it without dragging a graph along (the reason `terminalVocab.ts` exists
 * one layer below the dial kit is the same reason this does).
 *
 * It is one line, which is exactly why it needs a home. The same ternary was
 * spelled three times across padi — a private `errMessage` in `watch.ts` and an
 * inline copy in `read.ts` and `stateRoot.ts` — and a decision re-made per site
 * is a decision that can be made DIFFERENTLY per site: the unguarded shape
 * (`(err as Error).message`) prints `undefined` for a thrown string or a
 * rejected plain object, silently degrading the one diagnostic that says what
 * broke. kolu-cli states the same rule in its `exit.ts` (`errorMessage`); this
 * is padi's, because padi does not depend on the CLI.
 */

/** The message inside an arbitrary thrown thing, guarded — a non-`Error`
 *  rejection is stringified rather than read for a `.message` it does not
 *  have. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
