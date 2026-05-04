/** Normalize a thrown value into an `Error`. Pierre throws are typed as
 *  `unknown`; the wrappers route them through `props.onError(Error)`, so a
 *  bare string or non-Error throw needs to be wrapped. */
export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
