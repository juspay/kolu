import { describe, expect, it, vi } from "vitest";

// Mock the platform module before importing keyboard
vi.mock("./platform", () => ({ isMac: false }));

import { ACTIONS, isOutsideFocusScope, matchesAnyShortcut } from "./actions";
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

  it("matches cmdOrCtrl (Ctrl on non-mac)", () => {
    const kb: Keybind = { key: "t", modifier: "cmdOrCtrl" };
    expect(matchesKeybind(makeEvent({ key: "t", ctrlKey: true }), kb)).toBe(
      true,
    );
  });

  it("rejects cmdOrCtrl when no modifier pressed", () => {
    const kb: Keybind = { key: "t", modifier: "cmdOrCtrl" };
    expect(matchesKeybind(makeEvent({ key: "t" }), kb)).toBe(false);
  });

  it("rejects when a modifier is pressed but the keybind names none", () => {
    const kb: Keybind = { key: "t" };
    expect(matchesKeybind(makeEvent({ key: "t", ctrlKey: true }), kb)).toBe(
      false,
    );
  });

  it("matches shift", () => {
    const kb: Keybind = {
      key: "]",
      code: "BracketRight",
      modifier: "cmdOrCtrl",
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
      modifier: "cmdOrCtrl",
      shift: true,
    };
    expect(
      matchesKeybind(makeEvent({ code: "BracketRight", ctrlKey: true }), kb),
    ).toBe(false);
  });

  it("rejects when shift pressed but not expected", () => {
    const kb: Keybind = { key: "t", modifier: "cmdOrCtrl" };
    expect(
      matchesKeybind(
        makeEvent({ key: "t", ctrlKey: true, shiftKey: true }),
        kb,
      ),
    ).toBe(false);
  });

  it("prefers code over key for matching", () => {
    const kb: Keybind = { key: "`", code: "Backquote", modifier: "ctrl" };
    // key doesn't match but code does
    expect(
      matchesKeybind(
        makeEvent({ key: "~", code: "Backquote", ctrlKey: true }),
        kb,
      ),
    ).toBe(true);
  });

  it("matches ctrl keybind (physical Ctrl)", () => {
    const kb: Keybind = { key: "Tab", code: "Tab", modifier: "ctrl" };
    expect(matchesKeybind(makeEvent({ code: "Tab", ctrlKey: true }), kb)).toBe(
      true,
    );
  });
});

describe("modifier exactness (one rule, every role)", () => {
  // A chord requires the flag its role names and NOT the other one. Stated once
  // in `matchesKeybind` rather than per role, which is what the three separate
  // booleans could not do: each role used to be loose in its own way, and an
  // extra modifier riding along still matched — swallowing a byte the PTY was
  // owed under a chord the user never meant to press.
  const cases: {
    role: Keybind["modifier"];
    pressed: Partial<KeyboardEvent>;
  }[] = [
    { role: "app", pressed: { metaKey: true, ctrlKey: true } },
    { role: "cmdOrCtrl", pressed: { ctrlKey: true, metaKey: true } },
    { role: "ctrl", pressed: { ctrlKey: true, metaKey: true } },
    { role: undefined, pressed: { ctrlKey: true } },
    { role: undefined, pressed: { metaKey: true } },
  ];

  it.each(cases)("role $role rejects an event carrying an extra modifier", ({
    role,
    pressed,
  }) => {
    const kb: Keybind = { key: "k", code: "KeyK", modifier: role };
    expect(matchesKeybind(makeEvent({ code: "KeyK", ...pressed }), kb)).toBe(
      false,
    );
  });

  it("still matches each role's own exact chord", () => {
    const exact: [Keybind["modifier"], Partial<KeyboardEvent>][] = [
      ["app", { metaKey: true }],
      ["cmdOrCtrl", { ctrlKey: true }],
      ["ctrl", { ctrlKey: true }],
      [undefined, {}],
    ];
    for (const [role, pressed] of exact) {
      const kb: Keybind = { key: "k", code: "KeyK", modifier: role };
      expect(matchesKeybind(makeEvent({ code: "KeyK", ...pressed }), kb)).toBe(
        true,
      );
    }
  });

  it("keeps shiftOptional as the ONE declared exception", () => {
    const kb: Keybind = {
      key: "Tab",
      code: "Tab",
      modifier: "ctrl",
      shiftOptional: true,
    };
    for (const shiftKey of [true, false]) {
      expect(
        matchesKeybind(makeEvent({ code: "Tab", ctrlKey: true, shiftKey }), kb),
      ).toBe(true);
    }
    // Exactness still governs the modifier itself, shiftOptional or not.
    expect(
      matchesKeybind(
        makeEvent({ code: "Tab", ctrlKey: true, metaKey: true }),
        kb,
      ),
    ).toBe(false);
  });
});

describe(`the "app" modifier (Super off macOS — the PTY-safe role)`, () => {
  // `"app"` reads metaKey on EVERY platform: Cmd on macOS, Super/Win elsewhere.
  // Its whole purpose is that a PTY receives Ctrl as a byte and never sees this
  // key at all, so these are the chords kolu may claim over a live terminal.
  const kb: Keybind = { key: "k", code: "KeyK", modifier: "app" };

  it("matches Super+K off macOS", () => {
    expect(
      matchesKeybind(makeEvent({ code: "KeyK", metaKey: true }), kb, false),
    ).toBe(true);
  });

  it("matches ⌘K on macOS — the same chord, unchanged", () => {
    expect(
      matchesKeybind(makeEvent({ code: "KeyK", metaKey: true }), kb, true),
    ).toBe(true);
  });

  it("does NOT match plain Ctrl+K — the byte readline is owed", () => {
    expect(
      matchesKeybind(makeEvent({ code: "KeyK", ctrlKey: true }), kb, false),
    ).toBe(false);
  });

  it("does NOT match Ctrl+Super+K — a different chord, still carrying Ctrl+K", () => {
    // Claiming it would swallow the same kill-line byte, so an `"app"` chord is strict
    // about Ctrl — as every role now is.
    expect(
      matchesKeybind(
        makeEvent({ code: "KeyK", ctrlKey: true, metaKey: true }),
        kb,
        false,
      ),
    ).toBe(false);
  });

  it("does not match a bare keypress", () => {
    expect(matchesKeybind(makeEvent({ code: "KeyK" }), kb, false)).toBe(false);
  });

  it("keybindAsEvent synthesizes metaKey (never ctrlKey) on both platforms", () => {
    for (const isMac of [true, false]) {
      const ev = keybindAsEvent(kb, isMac);
      expect(ev.metaKey).toBe(true);
      expect(ev.ctrlKey).toBe(false);
    }
  });
});

describe("formatKeybind (non-mac)", () => {
  it.each([
    { kb: { key: "t", modifier: "cmdOrCtrl" }, expected: "Ctrl+T" },
    { kb: { key: "Tab", modifier: "ctrl" }, expected: "Ctrl+Tab" },
    {
      kb: { key: "]", modifier: "cmdOrCtrl", shift: true },
      expected: "Ctrl+Shift+]",
    },
    {
      kb: { key: "b", modifier: "cmdOrCtrl", alt: true },
      expected: "Ctrl+Alt+B",
    },
    { kb: { key: "t" }, expected: "T" },
    { kb: { key: "k", modifier: "cmdOrCtrl" }, expected: "Ctrl+K" },
    // `meta` renders as the key Linux/Windows actually call Super.
    { kb: { key: "k", modifier: "app" }, expected: "Super+K" },
    { kb: { key: "Enter", modifier: "app" }, expected: "Super+Enter" },
  ] as const)("formatKeybind → $expected", ({ kb, expected }) => {
    expect(formatKeybind(kb)).toBe(expected);
  });
});

describe("platform injection (isMac param overrides the detected platform)", () => {
  // The module mock pins the *detected* platform to non-mac; these pass
  // `isMac` explicitly to prove the keybind-core is a pure function of
  // platform, not a reader of the `userAgent` singleton.
  it("formatKeybind renders macOS glyphs when isMac=true", () => {
    expect(formatKeybind({ key: "k", modifier: "cmdOrCtrl" }, true)).toBe("⌘K");
    // A `meta` chord is ⌘ on macOS: the palette reads ⌘K there and Super+K off it.
    expect(formatKeybind({ key: "k", modifier: "app" }, true)).toBe("⌘K");
    expect(
      formatKeybind({ key: "]", modifier: "cmdOrCtrl", shift: true }, true),
    ).toBe("⌘⇧]");
    expect(formatKeybind({ key: "Tab", modifier: "ctrl" }, true)).toBe("⌃Tab");
  });

  it("formatKeybind still renders Ctrl when isMac=false", () => {
    expect(formatKeybind({ key: "k", modifier: "cmdOrCtrl" }, false)).toBe(
      "Ctrl+K",
    );
  });

  it("matchesKeybind reads metaKey for cmdOrCtrl when isMac=true", () => {
    const kb: Keybind = { key: "t", modifier: "cmdOrCtrl" };
    expect(
      matchesKeybind(makeEvent({ key: "t", metaKey: true }), kb, true),
    ).toBe(true);
    // Physical Ctrl no longer satisfies a `"cmdOrCtrl"` chord on mac.
    expect(
      matchesKeybind(makeEvent({ key: "t", ctrlKey: true }), kb, true),
    ).toBe(false);
  });

  it("keybindAsEvent targets metaKey for cmdOrCtrl when isMac=true", () => {
    const ev = keybindAsEvent({ key: "k", modifier: "cmdOrCtrl" }, true);
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

  it("matches Super+T (create terminal)", () => {
    expect(
      matchesAnyShortcut(makeEvent({ key: "t", code: "KeyT", metaKey: true })),
    ).toBe(true);
  });

  it.each([
    { chord: "Ctrl+T", code: "KeyT", key: "t" },
    { chord: "Ctrl+K", code: "KeyK", key: "k" },
    { chord: "Ctrl+F", code: "KeyF", key: "f" },
    { chord: "Ctrl+Enter", code: "Enter", key: "Enter" },
  ])("does NOT match $chord — reserved for the PTY, so xterm forwards it", ({
    code,
    key,
  }) => {
    // These four are what `modifier: "app"` bought: createTerminal (+ its alt
    // chord), commandPalette, and findInTerminal used to claim them off macOS.
    // `matchesAnyShortcut` is xterm's gate — a true here means the byte never
    // reaches the shell (readline kill-line / forward-char / transpose-chars,
    // omp's thinking toggle and follow-up send).
    expect(matchesAnyShortcut(makeEvent({ key, code, ctrlKey: true }))).toBe(
      false,
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

describe("findInTerminal scoping (xterm search confined to the terminal)", () => {
  // The action carries a `focusScopeMarker` selector the dispatcher checks
  // against `e.target` after the chord matches: a matching ancestor (focus is
  // in a terminal) → the handler runs (xterm search); no match (focus anywhere
  // else) → the dispatcher declines without preventDefault, so the browser's
  // native find-in-page fires. Tests run under the `node` environment (no DOM),
  // so fake the event target with a `closest` stub rather than real elements.
  const marker = ACTIONS.findInTerminal.focusScopeMarker;
  // Drive the dispatcher's real decline rule (`isOutsideFocusScope` in
  // actions.ts, also used by `dispatch` in useShortcuts.ts): true → the
  // dispatcher declines (no preventDefault → browser find); false → the handler
  // claims the chord. The node test env has no DOM, so fake the event target
  // with a `closest` stub.
  const evt = (target: unknown): KeyboardEvent =>
    ({
      key: "f",
      code: "KeyF",
      metaKey: true,
      target,
    }) as unknown as KeyboardEvent;

  it("is registered with a `focusScopeMarker` selector", () => {
    expect(typeof marker).toBe("string");
  });

  it("claims the chord (xterm search) when focus is inside a terminal", () => {
    // A `data-kolu-terminal-search` ancestor is found → dispatcher runs the
    // handler, opening kolu's terminal search.
    const found = {};
    expect(
      isOutsideFocusScope(
        ACTIONS.findInTerminal,
        evt({ closest: () => found }),
      ),
    ).toBe(false);
  });

  it("defers to native find when focus is outside any terminal", () => {
    // `closest` finds no terminal ancestor → dispatcher declines without
    // preventDefault, leaving ⌘F to the browser's find-in-page on macOS. Off
    // macOS the hand-off is structural — kolu claims Super+F, never Ctrl+F.
    expect(
      isOutsideFocusScope(ACTIONS.findInTerminal, evt({ closest: () => null })),
    ).toBe(true);
  });

  it("defers to native find when the event has no element target", () => {
    // Optional chaining short-circuits to undefined == null → decline → browser.
    expect(isOutsideFocusScope(ACTIONS.findInTerminal, evt(null))).toBe(true);
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
