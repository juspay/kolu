/**
 * Stand-in {@link SurfaceDispatch}es for suites that build a fake kaval
 * connection.
 *
 * `KavalConnectionMetadata.dispatch` is the transport seam `ptyHostClient`
 * forwards onto (see `connect.ts`), so every fake connection has to carry one.
 * Two kinds are wanted, and spelling them here keeps a suite from inventing a
 * third that silently swallows a call:
 *
 *   - {@link unreachableDispatch} for a suite that only reads a connection's
 *     IDENTITY fields (`startedAt`, `lifetime`, `pid`) and must never touch the
 *     wire — a call through it is a test bug, and it says so;
 *   - {@link scriptedDispatch} for a suite that genuinely drives one member.
 */

import type { SurfaceDispatch } from "@kolu/surface/link";
import { Effect, Stream } from "effect";

/** A dispatch that REFUSES every call by name. For fakes whose connection is
 *  identity-only: a member reached through it means the test wired a wire it
 *  did not mean to exercise, so it fails loud rather than resolving `undefined`. */
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

/** A dispatch that answers the members `answer` recognises and refuses the rest.
 *  `answer` is keyed by the member TAG's suffix (`"terminal/killAll"`), which is
 *  how a surface member is addressed on the wire, so a fake cannot drift from the
 *  spelling the face produces without failing loudly. */
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
