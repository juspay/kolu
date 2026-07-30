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
    // The ones that bite are not frame delivery — they are the lifecycle hooks
    // that reach past it. A superseded loop's transport-retry and re-attach
    // hooks would RESET the screen, wiping the successor's authoritative
    // snapshot; its render-recovery ping would report activity for a stream
    // nobody reads. All of them go through the same guard.
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
    // Scroll lock can stash a write callback until the user unlocks, so a
    // superseded effect can arrive arbitrarily long after the restart.
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
