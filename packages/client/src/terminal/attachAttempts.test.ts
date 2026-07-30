import { describe, expect, it } from "vitest";
import { createAttemptGate } from "./attachAttempts";

describe("createAttemptGate", () => {
  it("keeps the only attempt current", () => {
    const first = createAttemptGate().open();
    expect(first.isCurrent()).toBe(true);
  });

  it("supersedes the previous attempt when a successor opens", () => {
    // The restart window: the old loop has been aborted but has not unwound, so
    // both attempts exist at once. Everything it still delivers must be inert.
    const gate = createAttemptGate();
    const old = gate.open();
    const successor = gate.open();
    expect(old.isCurrent()).toBe(false);
    expect(successor.isCurrent()).toBe(true);
  });

  it("stays superseded — a stale attempt never becomes current again", () => {
    // A queued frame or a stashed write callback can arrive long after the
    // restart (scroll lock can hold a chunk until the user unlocks). Age must
    // not make it live again.
    const gate = createAttemptGate();
    const old = gate.open();
    gate.open();
    expect(old.isCurrent()).toBe(false);
    expect(old.isCurrent()).toBe(false);
  });

  it("lets only the first of several stale callbacks install a successor", () => {
    // Several superseded callbacks can each reach the restart path. Guarding on
    // isCurrent() means the first one installs the replacement and the rest are
    // already stale, so one restart yields exactly one live attempt — not a
    // cascade of loops each racing the others.
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
    // Two gates are independent: one terminal restarting must not silence
    // another's in-flight attempt.
    const a = createAttemptGate().open();
    const b = createAttemptGate();
    b.open();
    b.open();
    expect(a.isCurrent()).toBe(true);
  });
});
