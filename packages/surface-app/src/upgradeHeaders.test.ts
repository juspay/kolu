import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { checkUpgradeHeaders, pickUpgradeHeaders } from "./upgradeHeaders";

const request = (headers: IncomingMessage["headers"]) =>
  ({ headers }) as IncomingMessage;

describe("checkUpgradeHeaders — the grammar an app can refuse a list against", () => {
  // Exported so an app that ASSEMBLES its allowlist fails the part that offered
  // a bad name where it mints the list, rather than leaving every accept to the
  // quiet `UpgradeHeadersRefused`. `serve.test.ts` pins the same three rules at
  // the bind; these pin them at the door an app calls directly, and pin that a
  // good list comes back UNCHANGED (which is what carries `H` to the pick).
  it("hands a good list back unchanged", () => {
    const asked = ["Tailscale-User-Login", "x-forwarded-for"] as const;
    expect(checkUpgradeHeaders(asked)).toBe(asked);
  });

  it("refuses a name outside HTTP's field-name grammar", () => {
    expect(() => checkUpgradeHeaders(["not a name"])).toThrow(
      /"not a name" is not an HTTP header name/,
    );
  });

  it("refuses set-cookie, whose value a joined string cannot carry", () => {
    expect(() => checkUpgradeHeaders(["Set-Cookie"])).toThrow(
      /"Set-Cookie" cannot be read off an upgrade/,
    );
  });

  it("refuses ONE wire header named twice", () => {
    expect(() =>
      checkUpgradeHeaders(["X-Forwarded-For", "x-forwarded-for"]),
    ).toThrow(/"x-forwarded-for" names a header already in upgradeHeaders/);
  });
});

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
