/** The composer's keyboard rule: `Enter` sends only when no menu is open, the
 *  arrows walk a wrapping list, and Tab can never send. */

import { describe, expect, it } from "vitest";
import { completionIntent } from "./completion";

describe("completionIntent", () => {
  it("sends on Enter when no menu is open", () => {
    expect(completionIntent("Enter", false, 0, 0)).toEqual({ kind: "send" });
  });

  it("passes Shift+Enter through as a newline", () => {
    expect(completionIntent("Enter", true, 0, 0)).toEqual({ kind: "pass" });
    expect(completionIntent("Enter", true, 3, 1)).toEqual({ kind: "pass" });
  });

  it("accepts instead of sending while a menu is open", () => {
    // `@fix⏎` completed the token rather than sending a prompt that names a
    // terminal nobody has.
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
    // One more typed letter can shrink the matches under the highlight; the
    // key still lands on a row that exists.
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
    // With no menu the key belongs to the pane, which leaves the mode.
    expect(completionIntent("Escape", false, 0, 0)).toEqual({ kind: "pass" });
  });
});
