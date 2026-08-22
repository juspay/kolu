import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { pickUpgradeHeaders } from "./pickUpgradeHeaders";

const request = (headers: IncomingMessage["headers"]) =>
  ({ headers }) as IncomingMessage;

describe("pickUpgradeHeaders", () => {
  it("refuses an array-shaped value rather than folding it", () => {
    // Unreachable from the wire — node folds a repeated header into one
    // `", "`-joined string, and only `set-cookie` arrives as a list, which the
    // allowlist refuses at bind. An array here is a defect, not a second
    // spelling of that fold.
    expect(() =>
      pickUpgradeHeaders(
        request({ "x-forwarded-for": ["1.1.1.1", "2.2.2.2"] }),
        ["x-forwarded-for"],
      ),
    ).toThrow(/arrived as a list/);
  });

  it("reports a string as the string, including empty", () => {
    expect(
      pickUpgradeHeaders(
        request({ "x-forwarded-for": "10.0.0.1", "x-empty": "" }),
        ["x-forwarded-for", "x-empty"],
      ),
    ).toEqual({ "x-forwarded-for": "10.0.0.1", "x-empty": "" });
  });
});
