/**
 * The EMPTY sensor tap set every `terminalEndpoint` unit test mocks onto the
 * pty-host surface.
 *
 * One fact lives here rather than in each test file: WHICH per-terminal taps the
 * wiring subscribes. Adding a sensor used to mean three `vi.mock` factories
 * learning about it independently, and the copies had already drifted on how an
 * empty tap is spelled.
 *
 * EMPTY, not absent, and the difference is load-bearing: the wiring must not
 * depend on any sensor emitting, while a tap that is MISSING throws — a
 * different case, pinned on its own in `adoptTolerance.test.ts`. Each test file
 * still owns its `terminal` mock (kill/list/spawn semantics differ per test, and
 * `vi.mock`'s hoisting forces the recorders to stay local); only the tap set is
 * shared.
 */

import { Stream } from "effect";

/** A tap that yields nothing and ends. */
const emptyTap = () => Stream.empty;

/** Spread into a pty-host `surface` mock beside its `terminal` member. */
export function emptySensorTaps() {
  return {
    cwd: { get: emptyTap },
    title: { get: emptyTap },
    commandRun: { get: emptyTap },
    foreground: { get: emptyTap },
    exit: { get: emptyTap },
  };
}
