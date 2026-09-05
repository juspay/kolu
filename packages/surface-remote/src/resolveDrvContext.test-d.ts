/**
 * The documented resolver idiom, pinned at the TYPE level.
 *
 * `arch.ts`'s module header tells a consumer to write
 * `resolveSystem(host, ctx)` inside `resolveDrvPath` — forwarding the WHOLE
 * dial context rather than hand-building `{ signal, onProgress }`. That is not
 * a style preference: `ResolveSystemOptions.keepalive` is optional (it has
 * out-of-tree callers and cannot be made required without breaking them), so a
 * hand-built options bag silently omits the dial's policy and opens the arch
 * probe's shared `ControlMaster` under the DEFAULT one — a second warm master,
 * right argv, wrong behaviour.
 *
 * Forwarding `ctx` is what closes that, and it only closes it while the idiom
 * actually COMPILES. It did not before: `ResolveDrvPathContext` carried
 * `localProgress` where `ResolveSystemOptions` wanted `onProgress`, so the
 * documented remedy typechecked nowhere and the hazardous hand-built form was
 * the path of least resistance. This file makes that regression a red build
 * rather than a doc that quietly rots.
 */
import { expectTypeOf, it } from "vitest";
import type { ResolveSystemOptions } from "./arch";
import type { ResolveDrvPathContext } from "./sshConnector";

it("a dial context can be forwarded whole to `resolveSystem`", () => {
  expectTypeOf<ResolveDrvPathContext>().toExtend<ResolveSystemOptions>();
});

it("the dial context's own keepalive is REQUIRED, not merely inherited", () => {
  // `ResolveSystemOptions` may leave it out; the context a connector hands its
  // resolver may not — that is what makes forwarding `ctx` thread the policy
  // structurally rather than by luck.
  expectTypeOf<ResolveDrvPathContext["keepalive"]>().not.toEqualTypeOf<
    undefined | ResolveDrvPathContext["keepalive"]
  >();
  expectTypeOf<Omit<ResolveDrvPathContext, "keepalive">>().not.toExtend<
    Pick<ResolveDrvPathContext, "keepalive">
  >();
});
