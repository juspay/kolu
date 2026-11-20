import { hostAuthority } from "@kolu/url-shape";
import { describe, expect, it } from "vitest";
import { portUrl } from "./portUrl";
describe("portUrl", () => {
  it("builds the URL from the host it was given, never a literal localhost", () => {
    expect(portUrl("pureintent", 5173)).toBe("http://pureintent:5173");
    expect(portUrl("pureintent", 5173)).not.toContain("localhost");
  });

  it("keeps the scheme http rather than guessing https from the port", () => {
    expect(portUrl("box", 443)).toBe("http://box:443");
  });

  it("re-brackets an IPv6 literal, which location.hostname hands over bare", () => {
    expect(portUrl("fd7a:1:2::2", 8123)).toBe("http://[fd7a:1:2::2]:8123");
    expect(portUrl("::1", 5173)).toBe("http://[::1]:5173");
    expect(portUrl("192.168.1.10", 5173)).toBe("http://192.168.1.10:5173");
  });

  it("is the SAME derivation a row shows, so the pill and the link agree", () => {
    expect(portUrl("fd7a:1:2::2", 8123)).toContain(
      hostAuthority("fd7a:1:2::2", 8123),
    );
  });
});
