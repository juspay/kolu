import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import {
  completionIntent,
  completionQuestion,
  createCompletionHighlight,
} from "./completion";
import type { TokenQuery } from "./mentions";

describe("completionIntent", () => {
  it("sends on Enter when no menu is open", () => {
    expect(completionIntent("Enter", false, 0, 0)).toEqual({ kind: "send" });
  });

  it("passes Shift+Enter through as a newline", () => {
    expect(completionIntent("Enter", true, 0, 0)).toEqual({ kind: "pass" });
    expect(completionIntent("Enter", true, 3, 1)).toEqual({ kind: "pass" });
  });

  it("accepts instead of sending while a menu is open", () => {
    expect(completionIntent("Enter", false, 3, 2)).toEqual({
      kind: "accept",
      index: 2,
    });
    expect(completionIntent("Tab", false, 3, 1)).toEqual({
      kind: "accept",
      index: 1,
    });
  });

  it("leaves Tab alone when no menu is open", () => {
    expect(completionIntent("Tab", false, 0, 0)).toEqual({ kind: "pass" });
  });

  it("walks the list and wraps at both ends", () => {
    expect(completionIntent("ArrowDown", false, 3, 0)).toEqual({
      kind: "move",
      index: 1,
    });
    expect(completionIntent("ArrowDown", false, 3, 2)).toEqual({
      kind: "move",
      index: 0,
    });
    expect(completionIntent("ArrowUp", false, 3, 0)).toEqual({
      kind: "move",
      index: 2,
    });
  });

  it("clamps a selection the list has outgrown", () => {
    expect(completionIntent("Enter", false, 2, 7)).toEqual({
      kind: "accept",
      index: 1,
    });
    expect(completionIntent("ArrowDown", false, 2, 7)).toEqual({
      kind: "move",
      index: 0,
    });
  });

  it("closes on Escape only while the menu is open", () => {
    expect(completionIntent("Escape", false, 2, 0)).toEqual({ kind: "close" });
    expect(completionIntent("Escape", false, 0, 0)).toEqual({ kind: "pass" });
  });
});

const typed = (query: string): TokenQuery => ({
  start: 0,
  end: query.length + 1,
  query,
});

describe("completionQuestion", () => {
  it("tells a bare trigger apart from no token at all", () => {
    expect(completionQuestion(typed(""), null)).not.toBe(
      completionQuestion(null, null),
    );
  });

  it("tells the two menus apart on the same letters", () => {
    expect(completionQuestion(typed("fix"), null)).not.toBe(
      completionQuestion(null, typed("fix")),
    );
  });

  it("is the letters typed, so one more changes it", () => {
    expect(completionQuestion(typed("fi"), null)).not.toBe(
      completionQuestion(typed("fix"), null),
    );
    expect(completionQuestion(typed("fi"), null)).toBe(
      completionQuestion(typed("fi"), null),
    );
  });
});

describe("createCompletionHighlight", () => {
  it("survives a fleet tick and starts over on a new question", () =>
    createRoot((dispose) => {
      const [query, setQuery] = createSignal("fi");
      const [fleetTick, setFleetTick] = createSignal(0);
      const [selected, setSelected] = createCompletionHighlight(() => {
        fleetTick();
        return completionQuestion(typed(query()), null);
      });

      setSelected(2);
      setFleetTick(1);
      expect(selected()).toBe(2);

      setQuery("fix");
      expect(selected()).toBe(0);
      dispose();
    }));
});
