import { describe, expect, it } from "vitest";
import {
  hasOwnScheme,
  hostAuthority,
  isLoopbackHostname,
  parseLoopbackUrl,
} from "./index";

describe("hasOwnScheme", () => {
  it("recognises schemes, protocol-relative, and anchors", () => {
    expect(hasOwnScheme("https://x.test/a")).toBe(true);
    expect(hasOwnScheme("//cdn.example.com/x.png")).toBe(true);
    expect(hasOwnScheme("#section")).toBe(true);
  });

  it("rejects bare and relative paths", () => {
    expect(hasOwnScheme("logo.png")).toBe(false);
    expect(hasOwnScheme("./docs/logo.png")).toBe(false);
    expect(hasOwnScheme("/img/x.png")).toBe(false);
  });
});

describe("hostAuthority", () => {
  it("re-brackets an IPv6 literal, which every source hands over bare", () => {
    // `location.hostname` and Node's `AddressInfo.address` both strip the
    // brackets the URL form requires, so without this a kolu reached over IPv6
    // builds `http://fd7a::2:8123` — the parser reads the trailing `:8123` as
    // part of the address and the URL is simply malformed. A tailnet address is
    // the ordinary way kolu is reached, not an exotic case.
    expect(hostAuthority("fd7a:1:2::2", 8123)).toBe("[fd7a:1:2::2]:8123");
    expect(hostAuthority("::", 7314)).toBe("[::]:7314");
    expect(`http://${hostAuthority("::1", 7714)}`).toBe("http://[::1]:7714");
  });

  it("leaves a registered name or an IPv4 literal exactly as it was", () => {
    // Neither can ever contain a colon, so the colon IS the test — no address
    // parsing needed.
    expect(hostAuthority("pureintent", 5173)).toBe("pureintent:5173");
    expect(hostAuthority("192.168.1.10", 5173)).toBe("192.168.1.10:5173");
  });

  it("is the inverse of the unbracketing this module already did", () => {
    // Bracketing and unbracketing are one fact, which is why they live together:
    // what `hostAuthority` writes, `parseLoopbackUrl` reads back bare.
    expect(
      parseLoopbackUrl(`http://${hostAuthority("::1", 3000)}/app`)?.host,
    ).toBe("::1");
  });
});

describe("isLoopbackHostname", () => {
  it("accepts localhost, 127.*, [::1], 0.0.0.0", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.1.2.3")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("0.0.0.0")).toBe(true);
  });

  it("rejects ordinary hosts", () => {
    expect(isLoopbackHostname("pureintent")).toBe(false);
    expect(isLoopbackHostname("192.168.1.10")).toBe(false);
    expect(isLoopbackHostname("example.com")).toBe(false);
    expect(isLoopbackHostname("10.0.0.1")).toBe(false);
  });
});

describe("parseLoopbackUrl", () => {
  it("extracts port, path, and query from a classic Vite printout", () => {
    expect(parseLoopbackUrl("http://localhost:5173/")).toEqual({
      host: "localhost",
      port: 5173,
      protocol: "http:",
      pathname: "/",
      search: "",
      hash: "",
    });
    expect(
      parseLoopbackUrl("http://127.0.0.1:8080/notes/today?q=1#here"),
    ).toEqual({
      host: "127.0.0.1",
      port: 8080,
      protocol: "http:",
      pathname: "/notes/today",
      search: "?q=1",
      hash: "#here",
    });
  });

  it("preserves https so a TLS listener is not reopened as http", () => {
    expect(parseLoopbackUrl("https://localhost:5173/app")).toEqual({
      host: "localhost",
      port: 5173,
      protocol: "https:",
      pathname: "/app",
      search: "",
      hash: "",
    });
  });

  it("accepts bracketed IPv6 loopback and 0.0.0.0", () => {
    expect(parseLoopbackUrl("http://[::1]:3000/app")).toEqual({
      host: "::1",
      port: 3000,
      protocol: "http:",
      pathname: "/app",
      search: "",
      hash: "",
    });
    expect(parseLoopbackUrl("http://0.0.0.0:9000")).toEqual({
      host: "0.0.0.0",
      port: 9000,
      protocol: "http:",
      pathname: "/",
      search: "",
      hash: "",
    });
  });

  it("defaults the port from the scheme when none is written", () => {
    expect(parseLoopbackUrl("http://localhost/x")?.port).toBe(80);
    expect(parseLoopbackUrl("https://localhost/x")?.port).toBe(443);
  });

  it("returns null for non-loopback and non-http URLs", () => {
    expect(parseLoopbackUrl("http://github.com/foo")).toBeNull();
    expect(parseLoopbackUrl("http://pureintent:5173/")).toBeNull();
    expect(parseLoopbackUrl("ws://localhost:5173/")).toBeNull();
    expect(parseLoopbackUrl("not a url")).toBeNull();
    expect(parseLoopbackUrl("")).toBeNull();
  });
});
