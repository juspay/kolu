/**
 * The port operations that are TERMINAL domain — how a snapshot's honest two-way
 * compares (`portsEqual`) and what kolu decides from a bind (`portReach`).
 *
 * The port FACTS they rest on — the fold and the list equality — moved out with
 * the code to `./ports.ts`, and are tested beside it in `portInfo.test.ts`. What is left here
 * is exactly what that package must not know: a `status` discriminant, and whose
 * host the port is on.
 */

import { describe, expect, it } from "vitest";
import {
  foldPorts,
  type HostListeners,
  hostListenersEqual,
  listenerAt,
  type PortInfo,
  type PortScope,
  portReach,
  portsEqual,
  type TerminalPorts,
  type UnclaimedPorts,
  UNKNOWN_HOST_LISTENERS,
} from "./schema.ts";

const p = (
  port: number,
  scope: PortScope = "any",
  name = "node",
): PortInfo => ({
  port,
  name,
  command: name,
  scope,
  // The IP family plays no part in anything THIS file tests: `portsEqual`
  // compares it like every other field of the schema, and `portReach` never
  // reads it (which loopback a port is on does not change whether a door is
  // needed — only what that door dials). So it is pinned rather than varied.
  family: "v4",
});

/** The known arm, for the equality cases below. */
const known = (list: PortInfo[]): TerminalPorts => ({ status: "known", list });
const unknown: TerminalPorts = { status: "unknown" };

describe("portsEqual delegates the LIST comparison", () => {
  // Not a re-test of `samePortList` (that lives with it in `portInfo.test.ts`) —
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

  it("says NO MECHANISM for an interface bind on the kolu host too", () => {
    // The same observation must not answer differently on either side of one
    // boolean. A host has MANY addresses, and `scope` records that a bind is
    // interface-specific WITHOUT recording which address — so a listener on
    // `192.168.1.5:5173` does not answer at the tailnet `fd7a:…` name in the
    // viewer's address bar, and `direct` renders a plain link to exactly that
    // name. Nor can a door help: the relay dials `127.0.0.1`, where this
    // listener is not. Neither branch has a URL kolu can honestly build, so
    // both say so.
    expect(portReach({ scope: "interface", onKoluHost: true })).toEqual({
      kind: "no-mechanism",
      via: "interface-bind",
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

describe("hostListeners", () => {
  const known = (
    claimed: PortInfo[],
    unclaimed: UnclaimedPorts = { status: "known", list: [] },
  ): HostListeners => ({ status: "known", claimed, unclaimed });

  describe("listenerAt — the four answers", () => {
    it("names a claimed listener with its owner", () => {
      expect(listenerAt(known([p(18440)]), 18440)).toEqual({
        kind: "claimed",
        info: p(18440),
      });
    });

    it("finds an unclaimed bind when no readable program holds the port", () => {
      const bind = { port: 631, scope: "loopback", family: "v4" } as const;
      expect(
        listenerAt(known([], { status: "known", list: [bind] }), 631),
      ).toEqual({ kind: "unclaimed", bind });
    });

    it("answers with the unclaimed bind when its SCOPE is the one a door can use", () => {
      // Our interface-only 5173 beside another user's loopback 5173: the loopback
      // bind is dialable, so the reader must not say "not reachable".
      const bind = { port: 5173, scope: "loopback", family: "v6" } as const;
      expect(
        listenerAt(
          known([p(5173, "interface")], { status: "known", list: [bind] }),
          5173,
        ),
      ).toEqual({ kind: "unclaimed", bind });
      // …and the claimed listener keeps the answer at an equal or wider scope.
      expect(
        listenerAt(
          known([p(5173, "loopback")], { status: "known", list: [bind] }),
          5173,
        ).kind,
      ).toBe("claimed");
    });

    it("says ABSENT only when both halves were read", () => {
      expect(listenerAt(known([p(1)]), 18440)).toEqual({ kind: "absent" });
    });

    it("never says absent while the unclaimed half is blind", () => {
      // macOS 27 hides the sockets nobody claims. A port not in `claimed` may be
      // another user's server, so "nothing is listening" is not ours to say.
      expect(listenerAt(known([p(1)], { status: "unknown" }), 18440)).toEqual({
        kind: "unknown",
      });
    });

    it("still names a claimed listener while the unclaimed half is blind", () => {
      expect(
        listenerAt(known([p(5173)], { status: "unknown" }), 5173).kind,
      ).toBe("claimed");
    });

    it("is unknown for a host that is not scanned", () => {
      expect(listenerAt(UNKNOWN_HOST_LISTENERS, 5173)).toEqual({
        kind: "unknown",
      });
    });
  });

  describe("hostListenersEqual", () => {
    it("treats an unchanged reading as the same fact", () => {
      expect(hostListenersEqual(known([p(1)]), known([p(1)]))).toBe(true);
    });

    it("sees a command change on an otherwise identical port", () => {
      expect(
        hostListenersEqual(
          known([{ ...p(1), command: "node a" }]),
          known([{ ...p(1), command: "node b" }]),
        ),
      ).toBe(false);
    });

    it("sees a status flip on either level", () => {
      expect(hostListenersEqual(known([]), UNKNOWN_HOST_LISTENERS)).toBe(false);
      expect(
        hostListenersEqual(known([]), known([], { status: "unknown" })),
      ).toBe(false);
    });

    it("sees an unclaimed bind appear", () => {
      expect(
        hostListenersEqual(
          known([]),
          known([], {
            status: "known",
            list: [{ port: 631, scope: "loopback", family: "v4" }],
          }),
        ),
      ).toBe(false);
    });
  });
});
