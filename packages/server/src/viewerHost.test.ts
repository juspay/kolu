/**
 * The "is the viewer sitting at this host?" decision — the seam that stops kolu
 * offering a forward through a third machine to reach the machine the browser is
 * already on.
 *
 * Every case here is either a spelling two sources of the same address disagree
 * on, or a way the comparison must decline. The declining cases matter as much
 * as the matching ones: a match changes what a chip does, and the whole reason an
 * inexact comparison is acceptable is that a NON-match leaves the working forward
 * in place.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeAddress,
  sshTargetHostname,
  viewerIsOnHost,
} from "./viewerHost.ts";

describe("normalizeAddress", () => {
  it("unwraps a v4-mapped address, which is how a v4 peer arrives", () => {
    // `socket.remoteAddress` reports a v4 peer on a dual-stack listener in
    // v4-mapped form, while a resolver returns the bare v4 address. Without
    // this the two never compare equal and the feature simply never fires.
    expect(normalizeAddress("::ffff:100.64.0.7")).toBe("100.64.0.7");
    expect(normalizeAddress("100.64.0.7")).toBe("100.64.0.7");
  });

  it("drops a zone id, which belongs to the observer and not the address", () => {
    expect(normalizeAddress("fe80::1%eth0")).toBe("fe80::1");
  });

  it("unwraps URL brackets and folds hex case", () => {
    expect(normalizeAddress("[FD7A:1::2]")).toBe("fd7a:1::2");
  });

  it("leaves a plain address alone", () => {
    expect(normalizeAddress("fd7a:1::2")).toBe("fd7a:1::2");
    expect(normalizeAddress(" 10.0.0.1 ")).toBe("10.0.0.1");
  });

  it("does NOT mistake a v6 address that merely starts ::ffff: for a mapped one", () => {
    // `::ffff:1:2` is a real v6 address with no embedded v4 address in it. The
    // dotted-quad check is what tells the two apart; stripping the prefix here
    // would invent an address that is not the one bound.
    expect(normalizeAddress("::ffff:1:2")).toBe("::ffff:1:2");
  });
});

describe("viewerIsOnHost", () => {
  it("matches a viewer whose address is one of the host's", () => {
    expect(
      viewerIsOnHost({
        viewerAddress: "100.64.0.7",
        hostAddresses: ["100.64.0.7", "fd7a:1::2"],
      }),
    ).toBe(true);
  });

  it("matches ACROSS the spellings the two sides use", () => {
    // The case the whole normalization exists for, end to end: the browser's
    // peer address arrives v4-mapped, the resolver answers bare.
    expect(
      viewerIsOnHost({
        viewerAddress: "::ffff:100.64.0.7",
        hostAddresses: ["100.64.0.7"],
      }),
    ).toBe(true);
    // …and the other way round.
    expect(
      viewerIsOnHost({
        viewerAddress: "fd7a:1::2%wg0",
        hostAddresses: ["[FD7A:1::2]"],
      }),
    ).toBe(true);
  });

  it("does NOT match a different machine — the forward stays", () => {
    expect(
      viewerIsOnHost({
        viewerAddress: "100.64.0.9",
        hostAddresses: ["100.64.0.7", "fd7a:1::2"],
      }),
    ).toBe(false);
  });

  it("declines when the viewer's address is unknown", () => {
    // A proxied or socket-less connection. Declining keeps the forward, which
    // works; guessing would hand the user a link to their own machine that may
    // have nothing behind it.
    expect(
      viewerIsOnHost({ viewerAddress: undefined, hostAddresses: ["10.0.0.1"] }),
    ).toBe(false);
    expect(
      viewerIsOnHost({ viewerAddress: "", hostAddresses: ["10.0.0.1"] }),
    ).toBe(false);
  });

  it("declines when the host resolved to nothing", () => {
    // An `~/.ssh/config` alias DNS cannot resolve — common, and exactly why the
    // no-match side has to be the safe one.
    expect(
      viewerIsOnHost({ viewerAddress: "100.64.0.7", hostAddresses: [] }),
    ).toBe(false);
  });
});

describe("sshTargetHostname", () => {
  it("drops the user, which no resolver takes", () => {
    expect(sshTargetHostname("srid@zest")).toBe("zest");
    expect(sshTargetHostname("zest")).toBe("zest");
  });

  it("splits on the LAST @, so a user containing one cannot eat the host", () => {
    expect(sshTargetHostname("srid@example.com@zest")).toBe("zest");
  });
});
