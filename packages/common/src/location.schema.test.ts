/**
 * P3 (kaval-sessions) additive host-identity contract — back-compat +
 * round-trip coverage.
 *
 * The whole point of these fields is that they are *additive and optional*:
 * every pre-P3 session blob, create call, and fs/git request must keep
 * parsing unchanged (a terminal with no `location` is local), while a P3
 * client can carry a `hostId` / `location.hostId` end to end. These are
 * pure zod parses — hermetic, no daemon, no socket.
 */
import {
  FsListAllInputSchema,
  FsReadFileInputSchema,
  GitDiffInputSchema,
  GitStatusInputSchema,
} from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import { TerminalCreateInputSchema } from "./contract.ts";
import { SavedTerminalSchema, TerminalMetadataSchema } from "./surface.ts";

const baseSaved = {
  id: crypto.randomUUID(),
  cwd: "/home/u/repo",
  git: null,
};

describe("P3 terminal-record location field", () => {
  it("deserializes a pre-P3 SavedTerminal (no location) as local", () => {
    const parsed = SavedTerminalSchema.parse(baseSaved);
    // Absent ⇒ local: the field is optional, never defaulted, so old blobs
    // round-trip byte-for-byte and code treats `undefined` as the local host.
    expect(parsed.location).toBeUndefined();
  });

  it("round-trips a remote SavedTerminal's location.hostId", () => {
    const parsed = SavedTerminalSchema.parse({
      ...baseSaved,
      location: { hostId: "prod" },
    });
    expect(parsed.location).toEqual({ hostId: "prod" });
  });

  it("carries location through the live TerminalMetadata shape", () => {
    const parsed = TerminalMetadataSchema.parse({
      ...baseSaved,
      location: { hostId: "builder" },
      pr: { kind: "absent" },
      agent: null,
      foreground: null,
    });
    expect(parsed.location?.hostId).toBe("builder");
  });

  it("rejects a malformed location (hostId must be a string)", () => {
    expect(() =>
      SavedTerminalSchema.parse({ ...baseSaved, location: { hostId: 7 } }),
    ).toThrow();
  });
});

describe("P3 terminal.create hostId", () => {
  it("accepts a create input with no hostId (local)", () => {
    const parsed = TerminalCreateInputSchema.parse({ cwd: "/x" });
    expect(parsed.hostId).toBeUndefined();
  });

  it("accepts a create input targeting a remote host", () => {
    const parsed = TerminalCreateInputSchema.parse({
      cwd: "/x",
      hostId: "prod",
    });
    expect(parsed.hostId).toBe("prod");
  });
});

describe("P3 fs/git stream inputs carry an optional hostId", () => {
  it("git status / diff accept hostId, default to local when omitted", () => {
    expect(
      GitStatusInputSchema.parse({ repoPath: "/r", mode: "local" }).hostId,
    ).toBeUndefined();
    expect(
      GitStatusInputSchema.parse({ repoPath: "/r", mode: "local", hostId: "h" })
        .hostId,
    ).toBe("h");
    expect(
      GitDiffInputSchema.parse({
        repoPath: "/r",
        filePath: "a.ts",
        mode: "local",
        hostId: "h",
      }).hostId,
    ).toBe("h");
  });

  it("fs listAll / readFile accept hostId", () => {
    expect(
      FsListAllInputSchema.parse({ repoPath: "/r", hostId: "h" }).hostId,
    ).toBe("h");
    expect(
      FsReadFileInputSchema.parse({
        terminalId: crypto.randomUUID(),
        repoPath: "/r",
        filePath: "a.ts",
        hostId: "h",
      }).hostId,
    ).toBe("h");
  });
});
