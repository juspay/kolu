/**
 * The per-terminal sensor tap set every `terminalEndpoint` unit test mocks onto
 * the pty-host surface.
 *
 * One fact lives here rather than in each test file: WHICH per-terminal taps the
 * wiring subscribes. Adding a sensor used to mean three `vi.mock` factories
 * learning about it independently, and the copies had already drifted on how an
 * empty tap is spelled.
 *
 * The NAME LIST is the shared part; what each tap DOES is the caller's, which is
 * why the factory is a parameter. The default builds EMPTY taps, and empty (not
 * absent) is load-bearing: the wiring must not depend on any sensor emitting,
 * while a tap that is MISSING throws — a different case, pinned on its own in
 * `adoptTolerance.test.ts`. A test that needs to OBSERVE the subscribe (the heal,
 * which is about re-wiring) passes a recording factory instead of re-listing the
 * five names. Each test file still owns its `terminal` mock (kill/list/spawn
 * semantics differ per test, and `vi.mock`'s hoisting forces the recorders to
 * stay local); only the tap set is shared.
 */

import { Stream } from "effect";

/** The taps the per-terminal sensor wiring subscribes, in wiring order. */
const TAP_NAMES = ["cwd", "title", "commandRun", "foreground", "exit"] as const;

type TapName = (typeof TAP_NAMES)[number];
type Tap = { get: (...args: never[]) => unknown };

/** Spread into a pty-host `surface` mock beside its `terminal` member. `make`
 *  builds ONE tap and is called once per name — the default yields nothing and
 *  ends. */
export function emptySensorTaps(
  make: (name: TapName) => Tap = () => ({ get: () => Stream.empty }),
): Record<TapName, Tap> {
  return Object.fromEntries(
    TAP_NAMES.map((name) => [name, make(name)]),
  ) as Record<TapName, Tap>;
}
