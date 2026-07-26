/**
 * Web-link policy — loopback → card, ⌘-click → raw, external → raw.
 *
 * Pure over the event modifiers + URI shape; the card store is the act.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWebLink } from "./handleWebLink";
import { closePrintedUrlCard, printedUrlCardTarget } from "./printedUrlCard";

afterEach(() => {
  closePrintedUrlCard();
  vi.restoreAllMocks();
});

function click(mods: { meta?: boolean; ctrl?: boolean } = {}): MouseEvent {
  return {
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    clientX: 40,
    clientY: 80,
  } as MouseEvent;
}

describe("handleWebLink", () => {
  it("opens the card for a loopback URL click", () => {
    handleWebLink(click(), "http://localhost:5173/app", "t1" as never);
    expect(printedUrlCardTarget()).toMatchObject({
      terminalId: "t1",
      port: 5173,
      pathname: "/app",
      x: 40,
      y: 80,
    });
  });

  it("opens raw and skips the card on ⌘-click", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    handleWebLink(
      click({ meta: true }),
      "http://localhost:5173/",
      "t1" as never,
    );
    expect(printedUrlCardTarget()).toBeNull();
    expect(open).toHaveBeenCalledWith("http://localhost:5173/", "_blank");
  });

  it("opens raw for a non-loopback URL", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    handleWebLink(click(), "https://github.com/juspay/kolu", "t1" as never);
    expect(printedUrlCardTarget()).toBeNull();
    expect(open).toHaveBeenCalledWith(
      "https://github.com/juspay/kolu",
      "_blank",
    );
  });
});
