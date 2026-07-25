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
import { FORWARD_REASON, portUrl } from "./PortsSection";

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
});
