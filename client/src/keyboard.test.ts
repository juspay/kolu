import { describe, it, expect, vi } from "vitest";

// Mock the platform module before importing keyboard
vi.mock("./platform", () => ({ isMac: false }));

import {
  matchesKeybind,
  formatKeybind,
  matchesAnyShortcut,
  type Keybind,
} from "./keyboard";

function makeEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("matchesKeybind (non-mac)", () => {
  it("matches simple key", () => {
    const kb: Keybind = { key: "t" };
    expect(matchesKeybind(makeEvent({ key: "t" }), kb)).toBe(true);
  });

  it("rejects wrong key", () => {
    const kb: Keybind = { key: "t" };
    expect(matchesKeybind(makeEvent({ key: "x" }), kb)).toBe(false);
  });

  it("matches mod (Ctrl on non-mac)", () => {
    const kb: Keybind = { key: "t", mod: true };
    expect(matchesKeybind(makeEvent({ key: "t", ctrlKey: true }), kb)).toBe(
      true,
    );
  });

  it("rejects mod when no modifier pressed", () => {
    const kb: Keybind = { key: "t", mod: true };
    expect(matchesKeybind(makeEvent({ key: "t" }), kb)).toBe(false);
  });

  it("rejects when modifier pressed but keybind has no mod", () => {
    const kb: Keybind = { key: "t" };
    expect(matchesKeybind(makeEvent({ key: "t", ctrlKey: true }), kb)).toBe(
      false,
    );
  });

  it("matches shift", () => {
    const kb: Keybind = {
      key: "]",
      code: "BracketRight",
      mod: true,
      shift: true,
    };
    expect(
      matchesKeybind(
        makeEvent({ code: "BracketRight", ctrlKey: true, shiftKey: true }),
        kb,
      ),
    ).toBe(true);
  });

  it("rejects when shift expected but not pressed", () => {
    const kb: Keybind = {
      key: "]",
      code: "BracketRight",
      mod: true,
      shift: true,
    };
    expect(
      matchesKeybind(makeEvent({ code: "BracketRight", ctrlKey: true }), kb),
    ).toBe(false);
  });

  it("rejects when shift pressed but not expected", () => {
    const kb: Keybind = { key: "t", mod: true };
    expect(
      matchesKeybind(
        makeEvent({ key: "t", ctrlKey: true, shiftKey: true }),
        kb,
      ),
    ).toBe(false);
  });

  it("prefers code over key for matching", () => {
    const kb: Keybind = { key: "`", code: "Backquote", ctrl: true };
    // key doesn't match but code does
    expect(
      matchesKeybind(
        makeEvent({ key: "~", code: "Backquote", ctrlKey: true }),
        kb,
      ),
    ).toBe(true);
  });

  it("matches ctrl keybind (physical Ctrl)", () => {
    const kb: Keybind = { key: "Tab", code: "Tab", ctrl: true };
    expect(matchesKeybind(makeEvent({ code: "Tab", ctrlKey: true }), kb)).toBe(
      true,
    );
  });
});

describe("formatKeybind (non-mac)", () => {
  it("formats mod key as Ctrl", () => {
    expect(formatKeybind({ key: "t", mod: true })).toBe("Ctrl+T");
  });

  it("formats ctrl key as Ctrl", () => {
    expect(formatKeybind({ key: "Tab", ctrl: true })).toBe("Ctrl+Tab");
  });

  it("formats shift", () => {
    expect(formatKeybind({ key: "]", mod: true, shift: true })).toBe(
      "Ctrl+Shift+]",
    );
  });

  it("formats bare key", () => {
    expect(formatKeybind({ key: "t" })).toBe("T");
  });

  it("uppercases single-char keys", () => {
    expect(formatKeybind({ key: "k", mod: true })).toBe("Ctrl+K");
  });
});

describe("matchesAnyShortcut", () => {
  it("matches Alt+Tab", () => {
    expect(matchesAnyShortcut(makeEvent({ altKey: true, key: "Tab" }))).toBe(
      true,
    );
  });

  it("matches Ctrl+T (create terminal)", () => {
    expect(matchesAnyShortcut(makeEvent({ key: "t", ctrlKey: true }))).toBe(
      true,
    );
  });

  it("does not match random key", () => {
    expect(matchesAnyShortcut(makeEvent({ key: "z" }))).toBe(false);
  });
});
