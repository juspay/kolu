import { describe, expect, it } from "vitest";
import { notePointerMove, type PointerPos } from "./pointerHoverGate";

describe("notePointerMove — real-mousemove hover gate", () => {
  it("seeds the first event without arming hover (open under cursor)", () => {
    const r = notePointerMove(null, { x: 100, y: 200 });
    expect(r.hoverArmed).toBe(false);
    expect(r.pos).toEqual({ x: 100, y: 200 });
  });

  it("ignores zero-delta moves after seed (synthetic reflow mousemove)", () => {
    let pos: PointerPos | null = null;
    const seed = notePointerMove(pos, { x: 50, y: 60 });
    pos = seed.pos;
    const again = notePointerMove(pos, { x: 50, y: 60 });
    expect(again.hoverArmed).toBe(false);
    expect(again.pos).toEqual({ x: 50, y: 60 });
  });

  it("arms hover only when coordinates actually change", () => {
    let pos: PointerPos | null = null;
    pos = notePointerMove(pos, { x: 10, y: 10 }).pos;
    const moved = notePointerMove(pos, { x: 11, y: 10 });
    expect(moved.hoverArmed).toBe(true);
    expect(moved.pos).toEqual({ x: 11, y: 10 });
  });

  it("re-arms after a keyboard-style reset of the armed flag (pos kept)", () => {
    // After keyboard nav: hover disarmed but last pos retained. Stationary
    // synthetic moves must not re-arm; a real delta must.
    const pos: PointerPos | null = { x: 20, y: 30 };
    expect(notePointerMove(pos, { x: 20, y: 30 }).hoverArmed).toBe(false);
    const real = notePointerMove(pos, { x: 25, y: 30 });
    expect(real.hoverArmed).toBe(true);
  });
});
