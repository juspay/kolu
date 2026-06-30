/**
 * Host-registry tests — the package-private seam where a `HostLocation` becomes a
 * concrete endpoint, and the four sealed exits around it.
 *
 * The whole point of PR-0 is that a `{ kind: "local" }` location resolves to the
 * one in-process endpoint and a remote location does NOT silently fall back to it —
 * AND that the only ways to reach an endpoint are these registry exits, each scoped
 * so a per-terminal caller can't hard-pin a host. The endpoint INSTANCE is package-
 * private (imported only here in `resolve.ts`), so these tests assert IDENTITY via
 * the resolver's own stability, never by importing the instance.
 */

import { type HostLocation, LOCAL_LOCATION } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  forEachHost,
  hostScopes,
  localFsGitEndpoint,
  resolveTerminalEndpoint,
  serverEndpointFor,
} from "./resolve.ts";

describe("resolveTerminalEndpoint", () => {
  it("resolves the shared LOCAL_LOCATION to a STABLE in-process endpoint", () => {
    // Identity without importing the instance: two resolutions of the local host
    // return the very same object (the singleton behind the seam).
    expect(resolveTerminalEndpoint(LOCAL_LOCATION)).toBe(
      resolveTerminalEndpoint(LOCAL_LOCATION),
    );
  });

  it("keys on kind, not object identity — any { kind: 'local' } resolves local", () => {
    expect(resolveTerminalEndpoint({ kind: "local" })).toBe(
      resolveTerminalEndpoint(LOCAL_LOCATION),
    );
  });

  it("fails loudly on a remote location — never degrades a remote terminal onto the local PTY", () => {
    const remote: HostLocation = { kind: "remote", hostId: "rasam" };
    expect(() => resolveTerminalEndpoint(remote)).toThrow(/remote/i);
  });
});

describe("the host registry — the sealed exits", () => {
  it("registers exactly one local host scope today", () => {
    const scopes = hostScopes();
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.location).toEqual(LOCAL_LOCATION);
  });

  it("serverEndpointFor(localScope) is the SAME endpoint resolveTerminalEndpoint returns", () => {
    const localScope = hostScopes()[0];
    if (!localScope) throw new Error("expected a local scope");
    expect(serverEndpointFor(localScope)).toBe(
      resolveTerminalEndpoint(LOCAL_LOCATION),
    );
  });

  it("forEachHost visits every host's endpoint (one local today)", async () => {
    const visited: unknown[] = [];
    await forEachHost(async (endpoint) => {
      visited.push(endpoint);
    });
    expect(visited).toHaveLength(1);
    expect(visited[0]).toBe(resolveTerminalEndpoint(LOCAL_LOCATION));
  });

  it("localFsGitEndpoint exposes the fs/git surfaces (the sealed Code-tab accessor)", () => {
    // The accessor's RETURN TYPE is the narrowed `TerminalWorkspaceEndpoint`
    // (`{ fs, git }`), so a caller cannot CALL kill/sleep through it — the seal is at
    // the type layer (surface.ts compiles against fs/git only). Here we spot-check
    // that the fs/git surfaces it hands back are live.
    const fsGit = localFsGitEndpoint();
    expect(typeof fsGit.fs.readFile).toBe("function");
    expect(typeof fsGit.git.getStatus).toBe("function");
  });
});
