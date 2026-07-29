import { describe, expect, it, vi } from "vitest";
import { createFocusProvenance } from "./focusProvenance";

describe("terminal focus provenance", () => {
  it("keeps chrome-triggered programmatic focus outside pane provenance", () => {
    const provenance = createFocusProvenance(() => 0);
    const writeFocusFact = vi.fn();
    const mockFocus = () => provenance.consume(writeFocusFact);
    const chromeGesture = vi.fn();

    chromeGesture();
    expect(mockFocus()).toBe(false);
    expect(chromeGesture).toHaveBeenCalledOnce();
    expect(writeFocusFact).not.toHaveBeenCalled();
  });

  it("forwards one focus after a pane gesture, then consumes the token", () => {
    const provenance = createFocusProvenance(() => 0);
    const writeFocusFact = vi.fn();
    const mockFocus = () => provenance.consume(writeFocusFact);

    provenance.arm();

    expect(mockFocus()).toBe(true);
    expect(mockFocus()).toBe(false);
    expect(writeFocusFact).toHaveBeenCalledOnce();
  });

  it("keeps the token through microtasks but disarms it on the next frame", async () => {
    let onFrame: FrameRequestCallback | undefined;
    const provenance = createFocusProvenance((callback) => {
      onFrame = callback;
      return 0;
    });
    const writeFocusFact = vi.fn();

    provenance.arm();
    await Promise.resolve();
    expect(provenance.consume(writeFocusFact)).toBe(true);
    expect(writeFocusFact).toHaveBeenCalledOnce();

    writeFocusFact.mockClear();
    provenance.arm();
    onFrame?.(0);

    expect(provenance.consume(writeFocusFact)).toBe(false);
    expect(writeFocusFact).not.toHaveBeenCalled();
  });
});
