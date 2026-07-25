/**
 * The Ports section's own two concerns: the URL it builds, and the words it puts
 * on a chip that needs a forward.
 *
 * The DECISION behind that chip is not here — `portReach` lives in the vocabulary
 * (both ends of the wire need it, PRT2's forward manager included) and is tested
 * beside `foldPorts` in `terminal-vocab/src/ports.test.ts`. What remains here is
 * presentation, which is the point of the split: rewording the copy no longer
 * touches the decision, and the decision is no longer observed by regex-matching
 * English.
 */

import { describe, expect, it } from "vitest";
import { portUrl } from "../forwards/portUrl";
import {
  FORWARD_REASON,
  NO_MECHANISM_REASON,
  portAction,
} from "./PortsSection";

describe("portUrl", () => {
  it("builds the URL from the host it was given, never a literal localhost", () => {
    // The whole point of the function is the hostname it does NOT use: kolu's real
    // shape is a server on a headless box viewed from a laptop, where "localhost"
    // names the one machine certainly not running the dev server.
    expect(portUrl("pureintent", 5173)).toBe("http://pureintent:5173");
    expect(portUrl("pureintent", 5173)).not.toContain("localhost");
  });

  it("keeps the scheme http rather than guessing https from the port", () => {
    // A guess would produce a broken tab more often than a working one.
    expect(portUrl("box", 443)).toBe("http://box:443");
  });

  it("re-brackets an IPv6 literal, which location.hostname hands over bare", () => {
    // `location.hostname` strips the brackets the URL form requires, so without
    // this a kolu reached over IPv6 built `http://fd7a::2:8123` — the parser reads
    // the trailing `:8123` as part of the address and the URL is malformed. A
    // tailnet address is the ordinary way kolu is reached, not an exotic case.
    expect(portUrl("fd7a:1:2::2", 8123)).toBe("http://[fd7a:1:2::2]:8123");
    expect(portUrl("::1", 5173)).toBe("http://[::1]:5173");
    // A registered name and an IPv4 literal can never contain a colon, so they are
    // left exactly as they were.
    expect(portUrl("192.168.1.10", 5173)).toBe("http://192.168.1.10:5173");
  });
});

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

  it("rescues even the arm no FORWARD can serve", () => {
    // An interface bind on a remote host has no door — but if you are sitting at
    // that machine you can simply open it, which is the one case where "no
    // mechanism" and "unreachable" are not the same thing.
    expect(
      portAction({
        reach: { kind: "no-mechanism", via: "interface-bind" },
        viewerOnHost: true,
      }),
    ).toEqual({ kind: "viewer" });
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
