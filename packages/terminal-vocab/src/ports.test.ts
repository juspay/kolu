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
  family: "v4",
});

const known = (list: PortInfo[]): TerminalPorts => ({ status: "known", list });
const unknown: TerminalPorts = { status: "unknown" };

describe("portsEqual delegates the LIST comparison", () => {
  it("accepts an unchanged sample, so an idle scan emits nothing", () => {
    expect(
      portsEqual(known([p(8080), p(9229)]), known([p(8080), p(9229)])),
    ).toBe(true);
  });

  it("notices a port appearing, a bind changing, or a name changing", () => {
    expect(portsEqual(known([p(8080)]), known([p(8080), p(9229)]))).toBe(false);
    expect(
      portsEqual(known([p(5173, "loopback")]), known([p(5173, "any")])),
    ).toBe(false);
    expect(
      portsEqual(known([p(3000)]), known([p(3000, "any", "workerd")])),
    ).toBe(false);
  });

  it("sees an order-independent fold as unchanged", () => {
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
    expect(portReach({ scope: "interface", onKoluHost: true })).toEqual({
      kind: "no-mechanism",
      via: "interface-bind",
    });
  });

  it("names REMOTE HOST even for an ANY-address port — the arm e2e cannot reach", () => {
    expect(portReach({ scope: "any", onKoluHost: false })).toEqual({
      kind: "needs-forward",
      via: "remote-host",
    });
  });

  it("prefers the remote-host arm over the loopback one", () => {
    expect(portReach({ scope: "loopback", onKoluHost: false })).toEqual({
      kind: "needs-forward",
      via: "remote-host",
    });
  });

  it("says NO MECHANISM for an interface bind on a remote host", () => {
    expect(portReach({ scope: "interface", onKoluHost: false })).toEqual({
      kind: "no-mechanism",
      via: "interface-bind",
    });
  });
});

describe("portsEqual over the honest two-way", () => {
  it("never swallows a status flip", () => {
    expect(portsEqual(unknown, known([]))).toBe(false);
    expect(portsEqual(known([]), unknown)).toBe(false);
    expect(portsEqual(unknown, known([p(8080)]))).toBe(false);
  });

  it("treats two unknowns as the same fact", () => {
    expect(portsEqual(unknown, unknown)).toBe(true);
  });

  it("distinguishes 'we looked and found nothing' from 'we never looked'", () => {
    expect(portsEqual(known([]), known([]))).toBe(true);
    expect(portsEqual(known([]), unknown)).toBe(false);
  });
});

describe("hostListeners", () => {
  const known = (
    claimed: PortInfo[],
    unclaimed: UnclaimedPorts = { status: "known", list: [] },
  ): HostListeners => ({
    status: "known",
    claimed: claimed.map((c) => ({ ...c, heldByTerminal: false })),
    unclaimed,
  });

  describe("listenerAt — the four answers", () => {
    it("names a claimed listener with its owner", () => {
      expect(listenerAt(known([p(18440)]), 18440)).toEqual({
        kind: "claimed",
        info: { ...p(18440), heldByTerminal: false },
      });
    });

    it("finds an unclaimed bind when no readable program holds the port", () => {
      const bind = { port: 631, scope: "loopback", family: "v4" } as const;
      expect(
        listenerAt(known([], { status: "known", list: [bind] }), 631),
      ).toEqual({ kind: "unclaimed", bind });
    });

    it("answers with the unclaimed bind when its SCOPE is the one a door can use", () => {
      const bind = { port: 5173, scope: "loopback", family: "v6" } as const;
      expect(
        listenerAt(
          known([p(5173, "interface")], { status: "known", list: [bind] }),
          5173,
        ),
      ).toEqual({ kind: "unclaimed", bind });
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
