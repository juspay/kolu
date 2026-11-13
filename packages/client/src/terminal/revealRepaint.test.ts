/**
 * Who owes a REPAINT, and who owes a paint.
 *
 * Revealing a pane used to clear the terminal and then open the attach, so the
 * pane sat blank for the whole round trip — a flash of black on every mobile
 * tile switch and every background split tab, where before this work both were
 * instant. The fix is to leave the old screen up and make the reveal's first
 * snapshot arrive as `TERMINAL_RESET + snapshot`, the one-write shape the
 * client already handles for padi's overflow re-attach. This is that decision,
 * where it can be driven without an xterm: exactly one frame of exactly one
 * attempt repaints.
 */

import { describe, expect, it } from "vitest";
import { createRevealRepaint } from "./revealRepaint";

describe("the reveal repaint mark", () => {
  it("the FIRST snapshot of a reveal-opened attempt repaints, the second does not", () => {
    // The second snapshot of a live attach is padi's overflow re-attach, which
    // brings its own RIS — and prepending another onto a screen the user is
    // reading would blank it for no reason at all.
    const r = createRevealRepaint();
    r.armReveal();
    const take = r.openAttempt();
    expect(take()).toBe(true);
    expect(take()).toBe(false);
    expect(take()).toBe(false);
  });

  it("an attempt nobody revealed never repaints", () => {
    // The other opens — a transport re-subscribe, a stale-grid reopen — blank
    // the screen themselves, deliberately, because they are getting rid of
    // bytes the pane must stop looking at.
    const take = createRevealRepaint().openAttempt();
    expect(take()).toBe(false);
  });

  it("the arm is spent by the open it was made for, not by a later one", () => {
    // A reveal arms the attach it is about to open. If the mark outlived that
    // open, the NEXT attempt — a reopen that already reset the terminal by hand
    // — would blank a freshly painted screen a second time.
    const r = createRevealRepaint();
    r.armReveal();
    const revealed = r.openAttempt();
    const reopened = r.openAttempt();
    expect(reopened()).toBe(false);
    expect(revealed()).toBe(true);
  });

  it("each reveal arms its own attempt", () => {
    // Hide, reveal, hide, reveal: every one of them leaves a stale screen
    // standing, and every one of them owes its replacement a reset.
    const r = createRevealRepaint();
    for (let i = 0; i < 3; i++) {
      r.armReveal();
      const take = r.openAttempt();
      expect(take()).toBe(true);
    }
  });

  it("arming twice before an open still repaints once", () => {
    // Idempotent on the arming side: it is a bit, not a count, so a gate that
    // re-observes itself cannot owe two resets to one frame.
    const r = createRevealRepaint();
    r.armReveal();
    r.armReveal();
    const take = r.openAttempt();
    expect(take()).toBe(true);
    expect(take()).toBe(false);
  });
});
