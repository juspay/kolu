import { describe, expect, it } from "vitest";
import { attribute } from "./attribution.ts";

describe("attribute", () => {
  it("prefixes the message with the sender's name", () => {
    expect(attribute("Sridhar", "make the export a chat log")).toBe(
      "from Sridhar: make the export a chat log",
    );
  });

  it("trims the name", () => {
    expect(attribute("  Sridhar  ", "hi")).toBe("from Sridhar: hi");
  });

  it("falls back to 'someone' for an empty or null name (never unattributed)", () => {
    expect(attribute("", "hi")).toBe("from someone: hi");
    expect(attribute(null, "hi")).toBe("from someone: hi");
    expect(attribute(undefined, "hi")).toBe("from someone: hi");
  });
});
