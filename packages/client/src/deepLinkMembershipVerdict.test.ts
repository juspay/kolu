import { describe, expect, it } from "vitest";
import {
  type MembershipFacts,
  membershipVerdict,
} from "./deepLinkMembershipVerdict";

/** #1900 (secondary — the reattach-window gone-verdict).
 *
 *  The router's settle effect verdicts "gone" off the FIRST settled snapshot
 *  (`listSub.pending()` false) with the routed id absent. But a first settled
 *  frame is "the list stream delivered a frame", NOT "membership has converged":
 *  right after a server deploy the first frame can precede kaval-survivor
 *  reattachment, so a genuinely-fresh deep link (a cold bookmark / notification,
 *  the one class the primary boot-stamp fix still lets route) reads its live
 *  terminal as absent → the lying "no longer on that host" toast, and the disarm
 *  also eats the hydration intent.
 *
 *  The honest reattach fact is `converged` — the route host's kaval reporting
 *  `connected` (the server populates the terminal registry that feeds the list
 *  BEFORE it publishes `connected`; see `padi/terminalEndpoint/reattach.ts`). The
 *  fix consults it: a settled-but-NOT-converged absent id is "not yet" (wait,
 *  bounded by the 8s backstop), never "gone".
 *
 *  These pins target the pure decision seam because the router's module-singleton
 *  harness (`useTerminalStore`, `activeHost`, the daemon subscription) makes
 *  effect-level stubbing infeasible — the same reason this file's sibling
 *  `useDeepLinks.test.ts` pins at the source. */
describe("membershipVerdict — the gone-verdict decision", () => {
  const facts = (over: Partial<MembershipFacts>): MembershipFacts => ({
    settled: true,
    listError: null,
    converged: true,
    inList: false,
    ...over,
  });

  // ── GREEN controls: the verdicts that already hold and must keep holding ──

  it("waits while the list is unsettled (pending)", () => {
    expect(membershipVerdict(facts({ settled: false }))).toEqual({
      kind: "wait",
    });
  });

  it("surfaces a list-stream fault as list-error (never invents a verdict)", () => {
    expect(membershipVerdict(facts({ listError: "socket closed" }))).toEqual({
      kind: "list-error",
      message: "socket closed",
    });
  });

  it("enacts when the routed id is present in the settled snapshot", () => {
    expect(membershipVerdict(facts({ inList: true }))).toEqual({
      kind: "present",
    });
  });

  it("verdicts gone for an HONEST gone: settled AND converged with the id absent", () => {
    // The GREEN control the brief asks for — an honestly-closed terminal (the
    // membership authority has converged and the id is truly not there) still
    // toasts exactly once and disarms.
    expect(
      membershipVerdict(
        facts({ settled: true, converged: true, inList: false }),
      ),
    ).toEqual({ kind: "gone" });
  });

  // ── RED: the reattach-window pin (flip `it.fails` → `it` with the fix) ──

  it.fails("does NOT verdict gone for a settled-but-not-yet-converged absent id (#1900)", () => {
    // The deploy/reattach window: the list settled (a frame arrived) but the
    // route host's kaval has not reported `connected`, so the survivor is
    // merely NOT-YET in the list. The honest verdict is `wait` — the route
    // stays armed (no lying toast, hydration intent intact) and flips to
    // `present` when the id lands a frame later. Today the seam ignores
    // `converged` and returns `gone`, so this fails until the fix lands.
    expect(
      membershipVerdict(
        facts({ settled: true, converged: false, inList: false }),
      ),
    ).toEqual({ kind: "wait" });
  });
});
