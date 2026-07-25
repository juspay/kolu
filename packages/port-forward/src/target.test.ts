import { describe, expect, it } from "vitest";
import {
  assertHost,
  assertPort,
  formatTarget,
  parseTarget,
  targetKey,
} from "./target.ts";

describe("parseTarget", () => {
  it("reads host:port as a remote target", () => {
    expect(parseTarget("pu-dev:5173")).toEqual({
      kind: "remote",
      host: "pu-dev",
      port: 5173,
    });
  });

  it("keeps an ssh user@host destination intact", () => {
    expect(parseTarget("nix@prod.example.com:8080")).toEqual({
      kind: "remote",
      host: "nix@prod.example.com",
      port: 8080,
    });
  });

  it.each([
    ":5173",
    "localhost:5173",
    "127.0.0.1:5173",
  ])("reads %s as a local target", (text) => {
    expect(parseTarget(text)).toEqual({ kind: "local", port: 5173 });
  });

  it("ignores surrounding whitespace from a prompt", () => {
    expect(parseTarget("  pu-dev:3000\t")).toEqual({
      kind: "remote",
      host: "pu-dev",
      port: 3000,
    });
  });

  it.each([
    ["5173", "no colon at all"],
    ["pu-dev:", "no port"],
    ["pu-dev:http", "a non-numeric port"],
    ["pu-dev:0", "port zero"],
    ["pu-dev:70000", "a port past the ceiling"],
    ["-oProxyCommand=x:22", "a host ssh would read as an option"],
    ["[::1]:5173", "an IPv6 literal"],
  ])("rejects %s (%s)", (text) => {
    expect(() => parseTarget(text)).toThrow();
  });

  it("names the offending text in the error, so a TUI can just show it", () => {
    expect(() => parseTarget("nonsense")).toThrow(/"nonsense"/);
  });
});

describe("targetKey", () => {
  it("keys a remote target by host and port", () => {
    expect(targetKey({ kind: "remote", host: "zest", port: 8080 })).toBe(
      "remote:zest:8080",
    );
  });

  it('does not collide with an ssh host literally called "local"', () => {
    // `local` is a legal ssh alias. Without the kind in the key both of these
    // would be "local:5173" and the map would hand out whichever came first.
    expect(targetKey({ kind: "local", port: 5173 })).not.toBe(
      targetKey({ kind: "remote", host: "local", port: 5173 }),
    );
  });

  it("keeps local targets in their own namespace", () => {
    expect(targetKey({ kind: "local", port: 8080 })).toBe("local:8080");
    expect(targetKey({ kind: "local", port: 8080 })).not.toBe(
      targetKey({ kind: "remote", host: "localhost", port: 8080 }),
    );
  });
});

describe("formatTarget", () => {
  it("round-trips through parseTarget", () => {
    for (const text of ["pu-dev:5173", "localhost:9229"]) {
      expect(formatTarget(parseTarget(text))).toBe(text);
    }
  });
});

describe("assertPort", () => {
  it.each([0, -1, 65536, 1.5, Number.NaN])("rejects %s", (port) => {
    expect(() => assertPort(port, "the port")).toThrow(/the port/);
  });

  it("accepts the edges", () => {
    expect(() => assertPort(1, "the port")).not.toThrow();
    expect(() => assertPort(65535, "the port")).not.toThrow();
  });
});

describe("assertHost", () => {
  it("accepts ordinary ssh destinations", () => {
    for (const host of ["pu-dev", "nix@10.0.0.4", "box.tail1234.ts.net"]) {
      expect(() => assertHost(host)).not.toThrow();
    }
  });

  it.each([
    "",
    "-oProxyCommand=touch /tmp/pwn",
    "two words",
    "a\nb",
  ])("rejects %j", (host) => {
    expect(() => assertHost(host)).toThrow();
  });
});
