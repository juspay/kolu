import { describe, expect, it } from "vitest";
import { skewRenewVerdict } from "./renewVerdict";

describe("skewRenewVerdict — the honest post-renew card copy", () => {
  it("is first-time before any renew is attempted", () => {
    expect(skewRenewVerdict(false, false)).toBe("first-time");
  });

  it("stays first-time WHILE a renew is in flight (outcome not settled yet)", () => {
    // Attempted but still running: the button shows its own in-flight label; the
    // honest "did not converge" must not fire until the attempt has SETTLED.
    expect(skewRenewVerdict(true, true)).toBe("first-time");
  });

  it("is did-not-converge once a renew SETTLED and the host is STILL incompatible", () => {
    // This function is only called where the incompatible card renders, so a
    // settled-and-not-in-flight attempt means the renew looped, not converged.
    expect(skewRenewVerdict(true, false)).toBe("did-not-converge");
  });

  it("a fresh in-flight renew (attempted flag not yet set) is first-time", () => {
    // Defensive: the two markers can momentarily disagree; in flight always wins
    // toward first-time so a proven failure is never claimed mid-attempt.
    expect(skewRenewVerdict(false, true)).toBe("first-time");
  });
});
