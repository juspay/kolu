/**
 * padi's unhandled-rejection BACKSTOP is loud, not fatal.
 *
 * The pin for half 2 of the #1719 fix: an injected float must (a) log a
 * LOUD, greppable, marker-carrying ERROR, (b) reach the health sink where
 * one is registered, and (c) NEVER exit the process — padi SURVIVES so an
 * unidentified future float is a diagnosable line, not a dead daemon.
 *
 * We invoke the installed listener DIRECTLY (grabbed off
 * `process.listeners`) rather than emitting a real `unhandledRejection` —
 * emitting would also run vitest's own handler and fail the run. That keeps
 * the pin deterministic and isolated to our boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "./log.ts";
import {
  __resetUnhandledRejectionBoundaryForTest,
  type BoundaryFloat,
  installUnhandledRejectionBoundary,
  PADI_UNHANDLED_REJECTION_MARKER,
  registerBoundaryHealthSink,
} from "./unhandledRejectionBoundary.ts";

/** A logger double capturing only what the boundary uses (`error`). */
function fakeLogger(): {
  log: Logger;
  errors: Array<{ obj: Record<string, unknown>; msg: string }>;
} {
  const errors: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const log = {
    error: (obj: Record<string, unknown>, msg: string) =>
      errors.push({ obj, msg }),
  } as unknown as Logger;
  return { log, errors };
}

/** The single listener our install added, so we can invoke it in isolation
 *  (and remove it on teardown — a leaked process listener would bleed into
 *  sibling test files). */
function grabInstalledListener(
  before: ReadonlyArray<unknown>,
): (reason: unknown, promise: Promise<unknown>) => void {
  const after = process.listeners("unhandledRejection");
  const added = after.filter((h) => !before.includes(h));
  expect(added).toHaveLength(1);
  return added[0] as (reason: unknown, promise: Promise<unknown>) => void;
}

describe("installUnhandledRejectionBoundary — loud, not fatal", () => {
  let added: ((reason: unknown, promise: Promise<unknown>) => void) | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetUnhandledRejectionBoundaryForTest();
    // If the boundary EVER calls process.exit, this throws instead of killing
    // the vitest worker — turning "padi died" into a visible test failure.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit must NOT be called by the boundary");
    }) as never);
  });

  afterEach(() => {
    if (added) process.off("unhandledRejection", added);
    added = undefined;
    exitSpy.mockRestore();
    __resetUnhandledRejectionBoundaryForTest();
  });

  it("logs a loud marker-carrying ERROR and does NOT exit on a float", () => {
    const { log, errors } = fakeLogger();
    const before = process.listeners("unhandledRejection");
    installUnhandledRejectionBoundary(log);
    added = grabInstalledListener(before);

    const reason = new Error("a background task floated");
    expect(() => added?.(reason, Promise.resolve())).not.toThrow();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj.marker).toBe(PADI_UNHANDLED_REJECTION_MARKER);
    // The Error rides under `err` (pino serializes it with its stack).
    expect(errors[0]?.obj.err).toBe(reason);
    expect(errors[0]?.msg).toContain(PADI_UNHANDLED_REJECTION_MARKER);
    expect(errors[0]?.msg).toContain("a background task floated");
    // The load-bearing survival assertion: never exited.
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("surfaces the float to a registered health sink (where reachable)", () => {
    const { log } = fakeLogger();
    const seen: BoundaryFloat[] = [];
    registerBoundaryHealthSink((f) => seen.push(f));
    const before = process.listeners("unhandledRejection");
    installUnhandledRejectionBoundary(log);
    added = grabInstalledListener(before);

    const reason = new Error("float to health");
    added?.(reason, Promise.resolve());

    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toBe(reason);
    expect(seen[0]?.message).toBe("float to health");
  });

  it("a throwing health sink cannot itself float — it is caught and logged", () => {
    const { log, errors } = fakeLogger();
    registerBoundaryHealthSink(() => {
      throw new Error("sink blew up");
    });
    const before = process.listeners("unhandledRejection");
    installUnhandledRejectionBoundary(log);
    added = grabInstalledListener(before);

    expect(() => added?.(new Error("x"), Promise.resolve())).not.toThrow();
    // Two ERROR lines: the float itself, then the sink failure — both marked.
    expect(errors).toHaveLength(2);
    expect(errors[1]?.obj.marker).toBe(PADI_UNHANDLED_REJECTION_MARKER);
    expect(errors[1]?.msg).toContain("health sink threw");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("handles a non-Error reason without throwing", () => {
    const { log, errors } = fakeLogger();
    const before = process.listeners("unhandledRejection");
    installUnhandledRejectionBoundary(log);
    added = grabInstalledListener(before);

    added?.("a bare string reason", Promise.resolve());
    expect(errors[0]?.obj.reason).toBe("a bare string reason");
    expect(errors[0]?.obj.err).toBeUndefined();
    expect(errors[0]?.msg).toContain("a bare string reason");
  });

  it("is idempotent — a second install adds no second listener", () => {
    const { log } = fakeLogger();
    const before = process.listeners("unhandledRejection");
    installUnhandledRejectionBoundary(log);
    installUnhandledRejectionBoundary(log);
    added = grabInstalledListener(before); // grabInstalled asserts exactly ONE added
  });
});
