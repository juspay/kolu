import { describe, expect, it, vi } from "vitest";

// Mock the platform module before importing keyboard
vi.mock("./platform", () => ({ isMac: false }));

import { ACTIONS, matchesAnyShortcut } from "./actions";
import {
  formatKeybind,
  type Keybind,
  keybindAsEvent,
  matchesKeybind,
} from "./keyboard";
import { PROHIBITED_KEYBINDS } from "./prohibitedKeybinds";

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
  it.each([
    { kb: { key: "t", mod: true }, expected: "Ctrl+T" },
    { kb: { key: "Tab", ctrl: true }, expected: "Ctrl+Tab" },
    { kb: { key: "]", mod: true, shift: true }, expected: "Ctrl+Shift+]" },
    { kb: { key: "b", mod: true, alt: true }, expected: "Ctrl+Alt+B" },
    { kb: { key: "t" }, expected: "T" },
    { kb: { key: "k", mod: true }, expected: "Ctrl+K" },
  ] as const)("formatKeybind → $expected", ({ kb, expected }) => {
    expect(formatKeybind(kb)).toBe(expected);
  });
});

describe("platform injection (isMac param overrides the detected platform)", () => {
  // The module mock pins the *detected* platform to non-mac; these pass
  // `isMac` explicitly to prove the keybind-core is a pure function of
  // platform, not a reader of the `userAgent` singleton.
  it("formatKeybind renders macOS glyphs when isMac=true", () => {
    expect(formatKeybind({ key: "k", mod: true }, true)).toBe("⌘K");
    expect(formatKeybind({ key: "]", mod: true, shift: true }, true)).toBe(
      "⌘⇧]",
    );
    expect(formatKeybind({ key: "Tab", ctrl: true }, true)).toBe("⌃Tab");
  });

  it("formatKeybind still renders Ctrl when isMac=false", () => {
    expect(formatKeybind({ key: "k", mod: true }, false)).toBe("Ctrl+K");
  });

  it("matchesKeybind reads metaKey for mod when isMac=true", () => {
    const kb: Keybind = { key: "t", mod: true };
    expect(
      matchesKeybind(makeEvent({ key: "t", metaKey: true }), kb, true),
    ).toBe(true);
    // Physical Ctrl no longer satisfies a `mod` chord on mac.
    expect(
      matchesKeybind(makeEvent({ key: "t", ctrlKey: true }), kb, true),
    ).toBe(false);
  });

  it("keybindAsEvent targets metaKey for mod when isMac=true", () => {
    const ev = keybindAsEvent({ key: "k", mod: true }, true);
    expect(ev.metaKey).toBe(true);
    expect(ev.ctrlKey).toBe(false);
  });
});

describe("matchesAnyShortcut", () => {
  it("matches Alt+Tab", () => {
    expect(
      matchesAnyShortcut(makeEvent({ altKey: true, key: "Tab", code: "Tab" })),
    ).toBe(true);
  });

  it("matches Ctrl+T (create terminal)", () => {
    expect(matchesAnyShortcut(makeEvent({ key: "t", ctrlKey: true }))).toBe(
      true,
    );
  });

  it("matches Ctrl+Shift+B (toggle dock)", () => {
    // Mod+Shift+B drives toggleDock; bare Ctrl+B is reserved for the
    // PTY (see prohibitedKeybinds.ts).
    expect(
      matchesAnyShortcut(
        makeEvent({ code: "KeyB", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("does NOT match Ctrl+B (reserved for PTY)", () => {
    expect(
      matchesAnyShortcut(makeEvent({ key: "b", code: "KeyB", ctrlKey: true })),
    ).toBe(false);
  });

  it("matches Ctrl+Shift+M (toggle canvas maximize)", () => {
    expect(
      matchesAnyShortcut(
        makeEvent({ key: "M", code: "KeyM", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("matches Ctrl+Alt+B (toggle right panel)", () => {
    expect(
      matchesAnyShortcut(
        makeEvent({ key: "b", code: "KeyB", ctrlKey: true, altKey: true }),
      ),
    ).toBe(true);
  });

  it("matches Ctrl+Shift+C (copy selection — physical Ctrl)", () => {
    expect(
      matchesAnyShortcut(
        makeEvent({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("does not match Cmd+Shift+C (copy chord requires physical Ctrl)", () => {
    expect(
      matchesAnyShortcut(
        makeEvent({ key: "C", code: "KeyC", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
  });

  it("does not match random key", () => {
    expect(matchesAnyShortcut(makeEvent({ key: "z" }))).toBe(false);
  });
});

describe("findInTerminal scoping (native find inside the Code tab)", () => {
  // The action carries a `nativeFindMarker` selector the dispatcher checks
  // against `e.target` after the chord matches: a matching ancestor → the
  // dispatcher declines (no preventDefault) so the browser's find-in-page
  // fires; no match → kolu opens its terminal search via the handler. Tests
  // run under the `node` environment (no DOM), so fake the event target with a
  // `closest` stub rather than building real elements.
  const marker = ACTIONS.findInTerminal.nativeFindMarker;
  const evt = (target: unknown): KeyboardEvent =>
    ({ key: "f", ctrlKey: true, target }) as unknown as KeyboardEvent;

  // Mirror the dispatcher's `insideNativeFind` decision (useShortcuts.ts
  // `dispatch`): skip (decline, no preventDefault) when the target sits inside
  // the marker; otherwise the handler claims the chord. Keep this in sync with
  // that branch — it's reproduced here because the node test env has no DOM to
  // drive the real dispatcher through.
  const declines = (e: KeyboardEvent): boolean =>
    marker != null && (e.target as Element | null)?.closest?.(marker) != null;

  it("is registered with a `nativeFindMarker` selector", () => {
    expect(typeof marker).toBe("string");
  });

  it("claims the chord (terminal search) when focus is outside any Code-tab marker", () => {
    // `closest` finds no marked ancestor → dispatcher runs the handler.
    expect(declines(evt({ closest: () => null }))).toBe(false);
  });

  it("defers to native find when focus is inside the Code tab", () => {
    // A `data-kolu-native-find` ancestor is found → dispatcher skips without
    // preventDefault, leaving Cmd/Ctrl+F to the browser's find-in-page.
    const found = {};
    expect(declines(evt({ closest: () => found }))).toBe(true);
  });

  it("claims the chord when the event has no element target", () => {
    // Optional chaining short-circuits to undefined → no skip → handler runs.
    expect(declines(evt(null))).toBe(false);
  });
});

describe("PROHIBITED_KEYBINDS", () => {
  // Synthesize the prohibited chord as a KeyboardEvent and ask
  // every registered action whether it would intercept it. A match
  // means the action would steal a keystroke meant for the PTY.
  it.each(PROHIBITED_KEYBINDS)("no action collides with $tool: $reason", ({
    keybind,
  }) => {
    const event = keybindAsEvent(keybind) as KeyboardEvent;
    const collisions = Object.entries(ACTIONS).filter(
      ([, action]) =>
        matchesKeybind(event, action.keybind) ||
        (action.altKeybind != null && matchesKeybind(event, action.altKeybind)),
    );
    expect(collisions.map(([id]) => id)).toEqual([]);
  });
});
