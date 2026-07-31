/**
 * How a port becomes an address — the ONE builder both the ports section and the
 * forward rows read, and the bracketing rule that makes an IPv6-served kolu work
 * at all.
 */

import { describe, expect, it } from "vitest";
import { portAuthority, portUrl } from "./portUrl";

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

describe("portAuthority", () => {
  it("is the half of the URL a row can SHOW as well as link", () => {
    // The pill renders it and the copy button copies the URL built from it, so
    // there is one derivation behind both: a row that displays one spelling and
    // copies another is a row where only one of them works.
    expect(portAuthority("fd7a:1:2::2", 8123)).toBe("[fd7a:1:2::2]:8123");
    expect(portAuthority("pureintent", 5173)).toBe("pureintent:5173");
    expect(portUrl("fd7a:1:2::2", 8123)).toContain(
      portAuthority("fd7a:1:2::2", 8123),
    );
  });
});
