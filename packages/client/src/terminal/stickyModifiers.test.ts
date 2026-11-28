import { flush } from "solid-js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyStickyModifiers,
  clearStickyModifiers,
  stickyAlt,
  stickyCtrl,
  toggleStickyAlt,
  toggleStickyCtrl,
} from "./stickyModifiers";

// Module-level singleton state — reset before each case so order doesn't leak.
// Arming and the keystroke that consumes it are separate turns in the app (a
// key-bar tap, then input), so each write is settled with `flush()` before the
// next read — the staged write is only visible from the flush onward.
beforeEach(() => {
  clearStickyModifiers();
  flush();
});

describe("toggle / clear", () => {
  it("toggles each modifier independently", () => {
    expect(stickyCtrl()).toBe(false);
    toggleStickyCtrl();
    flush();
    expect(stickyCtrl()).toBe(true);
    expect(stickyAlt()).toBe(false);
    toggleStickyAlt();
    flush();
    expect(stickyAlt()).toBe(true);
    toggleStickyCtrl();
    flush();
    expect(stickyCtrl()).toBe(false);
    expect(stickyAlt()).toBe(true);
  });

  it("clears both", () => {
    toggleStickyCtrl();
    toggleStickyAlt();
    clearStickyModifiers();
    flush();
    expect(stickyCtrl()).toBe(false);
    expect(stickyAlt()).toBe(false);
  });
});

describe("applyStickyModifiers", () => {
  it("is a no-op when nothing is armed", () => {
    expect(applyStickyModifiers("r")).toBe("r");
    expect(applyStickyModifiers("\x1b[A")).toBe("\x1b[A");
  });

  it("folds Ctrl into a lowercase letter (Ctrl+R → 0x12)", () => {
    toggleStickyCtrl();
    flush();
    expect(applyStickyModifiers("r")).toBe("\x12");
  });

  it("treats Ctrl as shift-invariant (Ctrl+R === Ctrl+r)", () => {
    toggleStickyCtrl();
    flush();
    expect(applyStickyModifiers("R")).toBe("\x12");
  });

  it("prefixes ESC for Alt (Alt+f)", () => {
    toggleStickyAlt();
    flush();
    expect(applyStickyModifiers("f")).toBe("\x1bf");
  });

  it("composes Ctrl then Alt (Alt+Ctrl+C → ESC + 0x03)", () => {
    toggleStickyCtrl();
    toggleStickyAlt();
    flush();
    expect(applyStickyModifiers("c")).toBe("\x1b\x03");
  });

  it("leaves a non-control char unmapped under Ctrl but still disarms", () => {
    toggleStickyCtrl();
    flush();
    expect(applyStickyModifiers("5")).toBe("5");
    flush();
    expect(stickyCtrl()).toBe(false);
  });

  it("disarms after one keystroke (one-shot)", () => {
    toggleStickyCtrl();
    flush();
    expect(applyStickyModifiers("a")).toBe("\x01");
    flush();
    expect(stickyCtrl()).toBe(false);
    // Subsequent input is no longer modified.
    expect(applyStickyModifiers("a")).toBe("a");
  });

  it("passes escape sequences and pastes through untouched, but disarms", () => {
    toggleStickyCtrl();
    flush();
    expect(applyStickyModifiers("\x1b[A")).toBe("\x1b[A");
    flush();
    expect(stickyCtrl()).toBe(false);
    toggleStickyAlt();
    flush();
    expect(applyStickyModifiers("hello world")).toBe("hello world");
    flush();
    expect(stickyAlt()).toBe(false);
  });
});
