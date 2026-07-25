/**
 * The port operations that are TERMINAL domain — how a snapshot's honest two-way
 * compares (`portsEqual`) and what kolu decides from a bind (`portReach`).
 *
 * The port FACTS they rest on — the fold and the list equality — moved out with
 * the code to `@kolu/port-scan/ports`, and are tested beside it. What is left here
 * is exactly what that package must not know: a `status` discriminant, and whose
 * host the port is on.
 */

import {
  foldPorts,
  type PortInfo,
  portReach,
  type PortScope,
  portsEqual,
  type TerminalPorts,
} from "./schema.ts";
import { describe, expect, it } from "vitest";

const p = (
  port: number,
  scope: PortScope = "any",
  name = "node",
): PortInfo => ({
  port,
  name,
  scope,
});

/** The known arm, for the equality cases below. */
const known = (list: PortInfo[]): TerminalPorts => ({ status: "known", list });
const unknown: TerminalPorts = { status: "unknown" };

describe("portsEqual delegates the LIST comparison", () => {
  // Not a re-test of `samePortList` (that lives with it in `@kolu/port-scan`) —
  // these pin that `portsEqual` actually consults the list for a known/known pair
  // rather than short-circuiting on the matching status, which is the one way this
  // wrapper can be wrong on its own.
  it("accepts an unchanged sample, so an idle scan emits nothing", () => {
    expect(
      portsEqual(known([p(8080), p(9229)]), known([p(8080), p(9229)])),
    ).toBe(true);
  });

  it("notices a port appearing, a bind changing, or a name changing", () => {
    expect(portsEqual(known([p(8080)]), known([p(8080), p(9229)]))).toBe(false);
    // A dev server restarted with `--host` keeps its number but stops needing a
    // forward. A port-number-only comparison would leave the chip inert forever.
    expect(
      portsEqual(known([p(5173, "loopback")]), known([p(5173, "any")])),
    ).toBe(false);
    expect(
      portsEqual(known([p(3000)]), known([p(3000, "any", "workerd")])),
    ).toBe(false);
  });

  it("sees an order-independent fold as unchanged", () => {
    // The two halves meeting: the fold's set-determinism only pays off if this
    // gate reads it. Two programs on one port, observed in either order.
    const rows = [p(8080, "loopback", "python"), p(8080, "loopback", "node")];
    expect(
      portsEqual(known(foldPorts(rows)), known(foldPorts([...rows].reverse()))),
    ).toBe(true);
  });
});

describe("portReach", () => {
  it("is direct for an ANY-address port on the kolu host", () => {
    expect(portReach({ scope: "any", onKoluHost: true })).toEqual({
      kind: "direct",
    });
  });

  it("names LOOPBACK for a loopback-bound port on the kolu host", () => {
    expect(portReach({ scope: "loopback", onKoluHost: true })).toEqual({
      kind: "needs-forward",
      via: "loopback",
    });
  });

  it("is direct for an INTERFACE bind on the kolu host — no door exists or is needed", () => {
    // A port bound to one routable address of the kolu server's OWN host already
    // answers off-box, and no door could improve on that: the relay dials
    // `127.0.0.1`, where this listener is not. Offering a forward would open a
    // listener that refuses every connection through it — which is precisely what
    // the old `wildcard: false` reading did, since it could not tell this case
    // from the loopback one above.
    expect(portReach({ scope: "interface", onKoluHost: true })).toEqual({
      kind: "direct",
    });
  });

  it("names REMOTE HOST even for an ANY-address port — the arm e2e cannot reach", () => {
    // The load-bearing case: a port bound to 0.0.0.0 on a remote ssh host is
    // reachable on THAT machine, and `location.hostname` is not that machine. If
    // the scope arm won here, kolu would offer an open that lands on the kolu
    // server's own (probably empty) port instead.
    expect(portReach({ scope: "any", onKoluHost: false })).toEqual({
      kind: "needs-forward",
      via: "remote-host",
    });
  });

  it("prefers the remote-host arm over the loopback one", () => {
    // Both are true for a loopback port on a remote host; the host is the more
    // informative fact, and PRT2 needs a different forward for each case — which
    // is why the answer is a TAG a caller can switch on rather than a sentence.
    expect(portReach({ scope: "loopback", onKoluHost: false })).toEqual({
      kind: "needs-forward",
      via: "remote-host",
    });
  });

  it("says NO MECHANISM for an interface bind on a remote host", () => {
    // The one combination no door reaches: `ssh -L` connects to the remote's
    // `127.0.0.1`, and this listener is on a different address of that machine.
    // Saying so is the honest answer; offering a forward is not.
    expect(portReach({ scope: "interface", onKoluHost: false })).toEqual({
      kind: "no-mechanism",
      via: "interface-bind",
    });
  });
});

describe("portsEqual over the honest two-way", () => {
  it("never swallows a status flip", () => {
    // The two transitions a dedup gate must always let through: "we finally saw"
    // and "we still cannot see". Swallowing either is how a blind terminal keeps
    // rendering as one that serves nothing.
    expect(portsEqual(unknown, known([]))).toBe(false);
    expect(portsEqual(known([]), unknown)).toBe(false);
    expect(portsEqual(unknown, known([p(8080)]))).toBe(false);
  });

  it("treats two unknowns as the same fact", () => {
    // A repeatedly-blind terminal must not churn the wire once per pass.
    expect(portsEqual(unknown, unknown)).toBe(true);
  });

  it("distinguishes 'we looked and found nothing' from 'we never looked'", () => {
    // The whole reason the arm exists: `[]` is an answer, `unknown` is not.
    expect(portsEqual(known([]), known([]))).toBe(true);
    expect(portsEqual(known([]), unknown)).toBe(false);
  });
});
