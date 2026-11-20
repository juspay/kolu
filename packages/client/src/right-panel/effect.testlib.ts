import { Effect } from "effect";

export function asEffect<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Effect.Effect<R, unknown> {
  return (...args) =>
    Effect.tryPromise({
      try: () => fn(...args),
      catch: (e) => e,
    });
}
