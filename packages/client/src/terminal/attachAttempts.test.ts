import { describe, expect, it, vi } from "vitest";
import { createAttemptGate, onlyWhenCurrent } from "./attachAttempts";

describe("onlyWhenCurrent", () => {
  it("runs an effect for the live attempt, with its arguments", () => {
    const effect = vi.fn();
    const attempt = createAttemptGate().open();
    onlyWhenCurrent(attempt, effect)("frame", 7);
    expect(effect).toHaveBeenCalledWith("frame", 7);
  });

  it("silences EVERY effect a superseded attempt can still trigger", () => {
    const gate = createAttemptGate();
    const old = gate.open();
    const onRetry = vi.fn();
    const onReattach = vi.fn();
    const noteData = vi.fn();
    const onFrame = vi.fn();
    const guarded = [onRetry, onReattach, noteData, onFrame].map((f) =>
      onlyWhenCurrent(old, f),
    );

    gate.open(); // the successor takes over
    for (const run of guarded) run();

    expect(onRetry).not.toHaveBeenCalled();
    expect(onReattach).not.toHaveBeenCalled();
    expect(noteData).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("keeps silencing however late the superseded effect fires", () => {
    const gate = createAttemptGate();
    const old = gate.open();
    const effect = vi.fn();
    const run = onlyWhenCurrent(old, effect);
    gate.open();
    run();
    run();
    expect(effect).not.toHaveBeenCalled();
  });
});

describe("createAttemptGate", () => {
  it("keeps the only attempt current", () => {
    const first = createAttemptGate().open();
    expect(first.isCurrent()).toBe(true);
  });

  it("supersedes the previous attempt when a successor opens", () => {
    const gate = createAttemptGate();
    const old = gate.open();
    const successor = gate.open();
    expect(old.isCurrent()).toBe(false);
    expect(successor.isCurrent()).toBe(true);
  });

  it("stays superseded — a stale attempt never becomes current again", () => {
    const gate = createAttemptGate();
    const old = gate.open();
    gate.open();
    expect(old.isCurrent()).toBe(false);
    expect(old.isCurrent()).toBe(false);
  });

  it("lets only the first of several stale callbacks install a successor", () => {
    const gate = createAttemptGate();
    const stale = gate.open();
    const restarts: number[] = [];
    for (const _ of [1, 2, 3]) {
      if (!stale.isCurrent()) continue;
      restarts.push(1);
      gate.open();
    }
    expect(restarts).toHaveLength(1);
  });

  it("gives each attempt its own identity rather than sharing one flag", () => {
    const a = createAttemptGate().open();
    const b = createAttemptGate();
    b.open();
    b.open();
    expect(a.isCurrent()).toBe(true);
  });
});
