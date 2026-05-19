import { describe, expect, it } from "vitest";
import { parseSshConfig } from "./ssh-config.ts";

describe("parseSshConfig", () => {
  it("returns an empty list for empty input", () => {
    expect(parseSshConfig("")).toEqual([]);
  });

  it("parses a single Host block with all fields", () => {
    const cfg = `Host build-box
  HostName build.example.com
  User srid
  Port 2222
`;
    expect(parseSshConfig(cfg)).toEqual([
      {
        alias: "build-box",
        hostname: "build.example.com",
        user: "srid",
        port: 2222,
      },
    ]);
  });

  it("defaults hostname to the alias when HostName is absent", () => {
    expect(parseSshConfig("Host laptop\n")).toEqual([
      { alias: "laptop", hostname: "laptop" },
    ]);
  });

  it("skips wildcard Host entries", () => {
    const cfg = `Host *
  ForwardAgent yes

Host *.internal
  User admin

Host build-box
  HostName build.example.com
`;
    expect(parseSshConfig(cfg)).toEqual([
      { alias: "build-box", hostname: "build.example.com" },
    ]);
  });

  it("emits one entry per alias on a multi-alias Host line", () => {
    const cfg = `Host a b c
  HostName shared.example.com
`;
    expect(parseSshConfig(cfg)).toEqual([
      { alias: "a", hostname: "a" },
      { alias: "b", hostname: "b" },
      { alias: "c", hostname: "shared.example.com" },
    ]);
  });

  it("accepts both space- and equals-separated key/value syntax", () => {
    const cfg = `Host eq
  HostName=eq.example.com
  Port=22
`;
    expect(parseSshConfig(cfg)).toEqual([
      { alias: "eq", hostname: "eq.example.com", port: 22 },
    ]);
  });

  it("ignores non-numeric ports", () => {
    const cfg = `Host bad
  HostName bad.example.com
  Port not-a-number
`;
    expect(parseSshConfig(cfg)).toEqual([
      { alias: "bad", hostname: "bad.example.com" },
    ]);
  });
});
