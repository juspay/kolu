import type { SurfaceDispatch } from "@kolu/surface/link";
import { Effect, Stream } from "effect";

export const unreachableDispatch: SurfaceDispatch = {
  unary: (tag) =>
    Effect.die(
      new Error(`unreachableDispatch: nothing should call ${tag} in this test`),
    ),
  stream: (tag) =>
    Stream.die(
      new Error(`unreachableDispatch: nothing should call ${tag} in this test`),
    ),
};

export function scriptedDispatch(
  answer: (tag: string) => (() => Promise<unknown>) | undefined,
): SurfaceDispatch {
  return {
    unary: (tag, _payload) => {
      const run = answer(tag);
      return run === undefined
        ? Effect.die(new Error(`scriptedDispatch: unscripted member ${tag}`))
        : Effect.promise(run);
    },
    stream: (tag) =>
      Stream.die(new Error(`scriptedDispatch: unscripted stream ${tag}`)),
  };
}
