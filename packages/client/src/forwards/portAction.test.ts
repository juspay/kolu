/**
 * What a port row DOES and what it SAYS — the pure decision, with no DOM.
 *
 * The reachability decision itself is not here: `portReach` lives in the
 * vocabulary (both ends of the wire need it, the forward manager included) and
 * is tested beside `foldPorts` in `terminal-vocab/src/ports.test.ts`. What is
 * here is the join with "where is the viewer?", the row-kind branch, and the
 * words — which is the point of the split: rewording the copy no longer touches
 * the decision, and the decision is no longer observed by regex-matching
 * English.
 */

import type { PortInfo } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  FORWARD_REASON,
  NO_MECHANISM_REASON,
  portAction,
  reachReason,
  rowAction,
} from "./portAction";
import type { PortRow } from "./portRows";
describe("FORWARD_REASON", () => {
  it("has words for every forward mechanism, and says which is which", () => {
    // A `Record` over the union makes a missing arm a compile error; this pins that
    // each arm names its OWN situation rather than sharing one vague sentence.
    expect(FORWARD_REASON["remote-host"]).toMatch(/remote host/);
    expect(FORWARD_REASON.loopback).toMatch(/loopback/);
  });

  it("promises a forward rather than a future release", () => {
    // PRT1's copy said "coming next" because the chips were inert. They are not
    // any more, and copy that still apologises for a shipped feature is a lie the
    // regex here exists to catch.
    for (const reason of Object.values(FORWARD_REASON)) {
      expect(reason).not.toMatch(/coming/);
      expect(reason).toMatch(/forward/);
    }
  });
});

describe("NO_MECHANISM_REASON", () => {
  it("offers nothing, because there is nothing to offer", () => {
    // The one arm with no action behind it: a port bound to a single interface of
    // a REMOTE host answers at that address, and both forward mechanisms dial the
    // far side's loopback. Its sentence must state the situation rather than
    // promise a door — a row that said "needs a forward" here would invite a click
    // that opens a listener refusing every connection through it.
    expect(NO_MECHANISM_REASON["interface-bind"]).toMatch(/no forward/);
  });
});

describe("portAction", () => {
  // The production complaint: the human browses kolu from zest, and zest is ALSO
  // one of kolu's hosts. Every port chip on zest's terminals offered a forward —
  // a door on the kolu server so that zest's browser could reach a port on zest.
  // It worked, by way of a third machine, and made no sense to look at.

  it("opens on the PAGE's host when the port already answers there", () => {
    expect(
      portAction({ reach: { kind: "direct" }, viewerOnHost: false }),
    ).toEqual({ kind: "here" });
  });

  it("opens on the VIEWER's own loopback when the viewer is on that host", () => {
    // No door is needed OR possible: the browser and the listener are on the
    // same machine, so the browser's own loopback reaches it.
    expect(
      portAction({
        reach: { kind: "needs-forward", via: "remote-host" },
        viewerOnHost: true,
      }),
    ).toEqual({ kind: "viewer" });
    expect(
      portAction({
        reach: { kind: "needs-forward", via: "loopback" },
        viewerOnHost: true,
      }),
    ).toEqual({ kind: "viewer" });
  });

  it("does NOT rescue the arm no forward can serve, even for a viewer on that host", () => {
    // This once returned `viewer`, reasoning that someone sitting at the machine
    // can simply open the port. True of the PERSON, false of the LINK: the
    // viewer arm builds `localhost:<port>`, and an interface-bound listener is
    // bound to ONE address — say `192.168.1.5:5173` — so loopback does not reach
    // it and the tab lands on a connection refused.
    //
    // Building the working link is not an option either: `scope: "interface"`
    // records THAT the bind is interface-specific, not WHICH address, because
    // the scanner folds a terminal's binds and the address is exactly what the
    // fold drops. So kolu cannot construct a URL that works, and saying "not
    // reachable" is the honest answer — the same one the non-viewer case gets,
    // and the reason this arm exists at all.
    expect(
      portAction({
        reach: { kind: "no-mechanism", via: "interface-bind" },
        viewerOnHost: true,
      }),
    ).toEqual({ kind: "none" });
  });

  it("does NOT rewrite a directly-answering port to localhost", () => {
    // The one case the viewer arm must not win. A `direct` port already answers
    // on the page's own host — a link that means the same thing on every
    // machine, and one the user can paste elsewhere. `localhost` is the single
    // hostname that means something DIFFERENT on every machine, which is the
    // trap this whole feature exists to avoid; using it where a real name works
    // would be trading a good link for a private one.
    expect(
      portAction({ reach: { kind: "direct" }, viewerOnHost: true }),
    ).toEqual({ kind: "here" });
  });

  it("keeps the forward when kolu cannot tell where the viewer is", () => {
    // The safe direction, and the reason an inexact identity check is acceptable
    // at all: every way of failing to recognise the viewer — a NAT, a proxy, an
    // ssh alias DNS cannot resolve — lands here, on the behaviour that works.
    expect(
      portAction({
        reach: { kind: "needs-forward", via: "remote-host" },
        viewerOnHost: false,
      }),
    ).toEqual({ kind: "forward" });
    expect(
      portAction({
        reach: { kind: "needs-forward", via: "loopback" },
        viewerOnHost: false,
      }),
    ).toEqual({ kind: "forward" });
  });

  it("says nothing is reachable when nothing is", () => {
    expect(
      portAction({
        reach: { kind: "no-mechanism", via: "interface-bind" },
        viewerOnHost: false,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("rowAction — the row KIND decides before any reach is judged", () => {
  const info = (scope: PortInfo["scope"]): PortInfo => ({
    port: 5173,
    name: "node",
    scope,
    family: "v4",
  });
  const orphan: PortRow = {
    kind: "orphan",
    port: 5173,
    forward: {
      key: "remote:pu-dev:5173",
      host: { kind: "remote", target: "pu-dev" },
      remotePort: 5173,
      localPort: 61003,
      origin: "auto",
      createdAt: 0,
    },
  };

  it("points an orphan at its own DOOR, even for a viewer on that host", () => {
    // An orphan is a door with no scanned port behind it — the scanner has
    // positively said nothing is listening. The `viewer` arm would link to
    // `localhost:<remotePort>`, a port nothing answers on, while the live door
    // sits one field away. The row fabricated a `needs-forward` reach behind an
    // `as` cast to get here; branching on the kind is the honest version, and it
    // is what keeps `PortReach` a union only its judge produces.
    expect(
      rowAction({ row: orphan, onKoluHost: false, viewerOnHost: true }),
    ).toEqual({ action: { kind: "forward" }, reason: undefined });
    expect(
      rowAction({ row: orphan, onKoluHost: true, viewerOnHost: false }),
    ).toEqual({ action: { kind: "forward" }, reason: undefined });
  });

  it("gives a scanned row the judge's answer and the judge's sentence", () => {
    const row: PortRow = {
      kind: "port",
      port: 5173,
      info: info("loopback"),
      forward: undefined,
    };
    expect(rowAction({ row, onKoluHost: true, viewerOnHost: false })).toEqual({
      action: { kind: "forward" },
      reason: FORWARD_REASON.loopback,
    });
  });

  it("says the same about an interface bind on either host", () => {
    const row: PortRow = {
      kind: "port",
      port: 5173,
      info: info("interface"),
      forward: undefined,
    };
    for (const onKoluHost of [true, false]) {
      expect(rowAction({ row, onKoluHost, viewerOnHost: false })).toEqual({
        action: { kind: "none" },
        reason: NO_MECHANISM_REASON["interface-bind"],
      });
    }
  });
});

describe("reachReason", () => {
  it("is total over PortReach, and silent for the arm that needs no sentence", () => {
    expect(reachReason({ kind: "direct" })).toBeUndefined();
    expect(reachReason({ kind: "needs-forward", via: "loopback" })).toBe(
      FORWARD_REASON.loopback,
    );
    expect(reachReason({ kind: "no-mechanism", via: "interface-bind" })).toBe(
      NO_MECHANISM_REASON["interface-bind"],
    );
  });
});
