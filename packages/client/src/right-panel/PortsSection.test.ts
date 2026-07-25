/**
 * The two pure decisions behind a port chip. Both exports carried a "for the unit
 * test" justification with no test behind it — the gauntlet caught that; this is
 * the test.
 *
 * It earns its place beyond honesty: the **remote-host** arm of
 * `needsForwardReason` is unreachable from the e2e suite, whose terminals are all
 * on the kolu host, and it is the arm that decides whether kolu offers to open a
 * URL pointing at the wrong machine.
 */

import { describe, expect, it } from "vitest";
import { needsForwardReason, portUrl } from "./PortsSection";

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
});

describe("needsForwardReason", () => {
  it("openable only when the port is wildcard-bound AND on the kolu host", () => {
    expect(needsForwardReason({ wildcard: true, onKoluHost: true })).toBeNull();
  });

  it("says loopback for a loopback-bound port on the kolu host", () => {
    expect(needsForwardReason({ wildcard: false, onKoluHost: true })).toMatch(
      /loopback/,
    );
  });

  it("says REMOTE HOST even for a wildcard port — the arm e2e cannot reach", () => {
    // The load-bearing case: a port bound to 0.0.0.0 on a remote ssh host is
    // reachable on THAT machine, and `location.hostname` is not that machine. If
    // the wildcard arm won here, kolu would offer an open that lands on the kolu
    // server's own (probably empty) port instead.
    const reason = needsForwardReason({ wildcard: true, onKoluHost: false });
    expect(reason).toMatch(/remote host/);
  });

  it("prefers the remote-host reason over the loopback one", () => {
    // Both are true for a loopback port on a remote host; the host is the more
    // informative fact, and PRT2 needs a different forward for each case.
    expect(needsForwardReason({ wildcard: false, onKoluHost: false })).toMatch(
      /remote host/,
    );
  });
});
