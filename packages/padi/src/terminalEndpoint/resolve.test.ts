import { type HostLocation, LOCAL_LOCATION } from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import { localTerminalEndpoint } from "./local.ts";
import { resolveTerminalEndpoint } from "./resolve.ts";

describe("resolveTerminalEndpoint", () => {
  it("resolves the shared LOCAL_LOCATION to the in-process localTerminalEndpoint", () => {
    expect(resolveTerminalEndpoint(LOCAL_LOCATION)).toBe(localTerminalEndpoint);
  });

  it("keys on kind, not object identity — any { kind: 'local' } resolves local", () => {
    expect(resolveTerminalEndpoint({ kind: "local" })).toBe(
      localTerminalEndpoint,
    );
  });

  it("fails loudly on a remote location — never degrades a remote terminal onto the local PTY", () => {
    const remote: HostLocation = { kind: "remote", hostId: "rasam" };
    expect(() => resolveTerminalEndpoint(remote)).toThrow(/remote/i);
  });
});
