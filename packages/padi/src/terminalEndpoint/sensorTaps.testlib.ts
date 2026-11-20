import { Stream } from "effect";

const TAP_NAMES = ["cwd", "title", "commandRun", "foreground", "exit"] as const;

type TapName = (typeof TAP_NAMES)[number];
type Tap = { get: (...args: never[]) => unknown };

export function emptySensorTaps(
  make: (name: TapName) => Tap = () => ({ get: () => Stream.empty }),
): Record<TapName, Tap> {
  return Object.fromEntries(
    TAP_NAMES.map((name) => [name, make(name)]),
  ) as Record<TapName, Tap>;
}
