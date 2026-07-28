import { expect, it } from "vitest";
import { formatProcessMemoryText } from "./processMemoryText";

it("keeps the mixed-version gate window numeric-free on the host chip", () => {
  expect(formatProcessMemoryText({ status: "gate-format-unsupported" })).toBe(
    "memory unavailable",
  );
});
