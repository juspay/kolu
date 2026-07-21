/**
 * Mechanical guard for the cross-module timeout ordering (#1908 C1). Correctness of the
 * layered provisioning timeouts depends on the session's pre-connected liveness backstop
 * out-lasting the ssh connector's maximum budgeted step silence, so the per-step budget
 * always fires FIRST on a slow copy/build and the backstop only bites a genuinely silent
 * campaign. That relationship lived only in prose across two files; this test binds the
 * REAL exported constants so the build breaks the moment they cross (bump
 * `PROVISION_STEP_MAX_EXPIRIES`, lower the session default, …).
 */
import { describe, expect, it } from "vitest";
import {
  PROVISION_STEP_MAX_EXPIRIES,
  PROVISION_STEP_SILENCE_BASE_MS,
} from "./nixCopy";
import { DEFAULT_PRE_CONNECTED_LIVENESS_MS } from "./session";

describe("pre-connected liveness backstop vs. per-step budget ordering", () => {
  it("the session default backstop exceeds the connector's max budgeted step silence", () => {
    // The last NON-terminal grant is base × 2^(maxExpiries − 1); the backstop must sit
    // above it so a healthy slow copy/build is never pre-empted by the campaign backstop.
    const maxBudgetedSilenceMs =
      PROVISION_STEP_SILENCE_BASE_MS * 2 ** (PROVISION_STEP_MAX_EXPIRIES - 1);
    expect(DEFAULT_PRE_CONNECTED_LIVENESS_MS).toBeGreaterThan(
      maxBudgetedSilenceMs,
    );
  });
});
