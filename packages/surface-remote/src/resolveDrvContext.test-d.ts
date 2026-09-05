/**
 * The documented resolver idiom, pinned at the TYPE level.
 *
 * `arch.ts`'s module header tells a consumer to write `ctx.resolveSystem()`
 * inside `resolveDrvPath` — the arch probe with every dial-owned argument
 * already supplied — rather than assembling `resolveSystem(host, {…})` itself.
 * That is not a style preference: `ResolveSystemOptions.keepalive` is optional
 * (it has out-of-tree callers and cannot be made required without breaking
 * them), so a hand-built options bag silently omits the dial's policy and opens
 * the arch probe's shared `ControlMaster` under the DEFAULT one — a second warm
 * master, right argv, wrong behaviour.
 *
 * This file makes a regression in either half of that a red build: the bound
 * probe's shape, and the context's own required `keepalive` (which is what
 * still threads the policy for a resolver that forwards `ctx` whole).
 */
import { expectTypeOf, it } from "vitest";
import type { ResolveSystemOptions } from "./arch";
import type { ResolveDrvPathContext } from "./sshConnector";

it("a dial context can be forwarded whole to `resolveSystem`", () => {
  expectTypeOf<ResolveDrvPathContext>().toExtend<ResolveSystemOptions>();
});

it("the arch probe arrives BOUND — no host, no options bag to get wrong", () => {
  expectTypeOf<ResolveDrvPathContext["resolveSystem"]>().toEqualTypeOf<
    () => Promise<string>
  >();
});

it("the dial context's own keepalive is REQUIRED, not merely inherited", () => {
  // `ResolveSystemOptions` may leave it out; the context a connector hands its
  // resolver may not — that is what makes forwarding `ctx` thread the policy
  // structurally rather than by luck. An optional field would make the Omit
  // assignable to the Pick, so this is the assertion that actually proves it.
  expectTypeOf<Omit<ResolveDrvPathContext, "keepalive">>().not.toExtend<
    Pick<ResolveDrvPathContext, "keepalive">
  >();
});
