import { describe, expect, it } from "vitest";
import { hasOwnScheme, isLoopbackHostname, parseLoopbackUrl } from "./index";

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
      pathname: "/",
      search: "",
      hash: "",
    });
    expect(
      parseLoopbackUrl("http://127.0.0.1:8080/notes/today?q=1#here"),
    ).toEqual({
      host: "127.0.0.1",
      port: 8080,
      pathname: "/notes/today",
      search: "?q=1",
      hash: "#here",
    });
  });

  it("accepts bracketed IPv6 loopback and 0.0.0.0", () => {
    expect(parseLoopbackUrl("http://[::1]:3000/app")).toEqual({
      host: "::1",
      port: 3000,
      pathname: "/app",
      search: "",
      hash: "",
    });
    expect(parseLoopbackUrl("http://0.0.0.0:9000")).toEqual({
      host: "0.0.0.0",
      port: 9000,
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
