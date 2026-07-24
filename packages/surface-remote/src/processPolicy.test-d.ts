/**
 * D1b type-level pin (#1908 R9) — a lifetime {@link LifetimePolicy} is REQUIRED on
 * `runCapture`. An unowned child is UNSPELLABLE: omitting the policy (or
 * the whole opts object) is a COMPILE error. The runtime pins in
 * `processLifetime.test.ts` exercise behaviour but cannot see requiredness — this
 * does. Checked by `tsc --noEmit`: a `@ts-expect-error` that stops erroring (a dropped
 * requiredness) becomes an "unused directive" failure.
 */
import { runCapture } from "./process";

// @ts-expect-error — opts is required (no 2-arg form): a child must have an owner.
void runCapture("nix-store", ["-q", "--outputs"]);

// @ts-expect-error — policy is required, even with an opts object.
void runCapture("nix-store", ["-q", "--outputs"], {});

// With a policy, the call typechecks.
void runCapture("nix-store", ["-q", "--outputs"], {
  policy: { kind: "deadline", ms: 1000 },
});
