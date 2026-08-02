/**
 * `composeTerminalMetadata` (in `./vocab.ts`) — the ONE join of a terminal's
 * two halves, the AUTHORED record + its OBSERVATION, into the unified
 * `TerminalMetadata`. Applied at the client read and at disk persist, never
 * served.
 *
 * These pin the load-bearing sleeping-arm invariants AFTER the awareness-derive-
 * store cutover: a sleeping terminal carries only the restore-relevant projection
 * of its snapshot (`cwd · git · pr` — `pr` rides it, restore-relevant now, no
 * frozen-pr special case), the churny `foreground` and lie-when-dead agent detail
 * are dropped, and the resume target rides the authored record's `restoreTarget`
 * (the discriminated resume value), joined with `location` + memory + client fields.
 */

import type { AgentInfo, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  type AuthoredActiveTerminal,
  type AuthoredSleepingTerminal,
  composeTerminalMetadata,
  decodeHostLocation,
  encodeHostLocation,
  HostLocationSchema,
  LOCAL_LOCATION,
} from "./vocab.ts";

/** zod's `.safeParse(x).success`, in Effect terms. */
const accepts = (
  schema: Parameters<typeof Schema.decodeUnknownResult>[0],
  value: unknown,
): boolean => Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

const claude = (sessionId: string): AgentInfo => ({
  kind: "claude-code",
  state: "thinking",
  sessionId,
  model: null,
  summary: null,
  taskProgress: null,
  workflow: null,
  contextTokens: null,
  startedAt: null,
});

/** A full live snapshot with a resolved PR, a live agent, and a foreground
 *  process. `pr` is restore-relevant (survives onto a dormant tile); the agent
 *  DETAIL + `foreground` are lie-when-dead / churny and must not reach the
 *  sleeping wire. */
const snapshot = (over: Partial<TerminalSnapshot> = {}): TerminalSnapshot => ({
  cwd: "/repo",
  git: null,
  pr: { kind: "absent" },
  agent: claude("ses-A"),
  foreground: { name: "vim", title: null },
  ports: { status: "unknown" },
  ...over,
});

describe("composeTerminalMetadata — the sleeping arm is the restore-relevant projection", () => {
  it("the sleeping arm's pr comes from the OBSERVATION (restore-relevant, no frozen-pr special case)", () => {
    const authored: AuthoredSleepingTerminal = {
      location: LOCAL_LOCATION,
      lastActivityAt: 7,
      state: "sleeping",
      sleptAt: 123,
    };
    const wire = composeTerminalMetadata(
      authored,
      snapshot({ pr: { kind: "absent" } }),
    );
    if (wire.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(wire.pr).toEqual({ kind: "absent" });
  });

  it("drops the live half (agent detail + foreground), keeping memory + the restore target", () => {
    const authored: AuthoredSleepingTerminal = {
      location: LOCAL_LOCATION,
      lastActivityAt: 7,
      lastAgentCommand: "claude",
      restoreTarget: {
        kind: "exact",
        command: "claude",
        agent: { kind: "claude-code", sessionId: "ses-A" },
      },
      state: "sleeping",
      sleptAt: 123,
    };
    const wire = composeTerminalMetadata(authored, snapshot());
    if (wire.state !== "sleeping") throw new Error("expected sleeping arm");
    // cwd survives; the live agent detail + foreground are gone.
    expect(wire.cwd).toBe("/repo");
    expect("agent" in wire).toBe(false);
    expect("foreground" in wire).toBe(false);
    // memory + the restore target rode the authored record onto the joined value.
    expect(wire.lastActivityAt).toBe(7);
    expect(wire.restoreTarget).toEqual({
      kind: "exact",
      command: "claude",
      agent: { kind: "claude-code", sessionId: "ses-A" },
    });
  });

  it("a quit-to-shell sleeping record carries a `none` restore target (bare shell)", () => {
    const authored: AuthoredSleepingTerminal = {
      location: LOCAL_LOCATION,
      lastActivityAt: 7,
      lastAgentCommand: "claude",
      restoreTarget: { kind: "none" },
      state: "sleeping",
      sleptAt: 123,
    };
    const wire = composeTerminalMetadata(authored, snapshot({ agent: null }));
    if (wire.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(wire.restoreTarget).toEqual({ kind: "none" });
  });

  it("the active arm carries the FULL snapshot — full agent detail + foreground", () => {
    const authored: AuthoredActiveTerminal = {
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      state: "active",
    };
    const wire = composeTerminalMetadata(authored, snapshot());
    if (wire.state !== "active") throw new Error("expected active arm");
    expect(wire.pr).toEqual({ kind: "absent" });
    expect(wire.agent).toEqual(claude("ses-A"));
    expect(wire.foreground).toEqual({ name: "vim", title: null });
  });
});

describe("encodeHostLocation / decodeHostLocation — the daemon-status key codec", () => {
  it("round-trips the local variant through LOCAL_LOCATION", () => {
    expect(encodeHostLocation(LOCAL_LOCATION)).toBe("local");
    expect(decodeHostLocation(encodeHostLocation(LOCAL_LOCATION))).toEqual(
      LOCAL_LOCATION,
    );
  });

  it("round-trips a remote variant through the `remote:` prefix", () => {
    const remote = { kind: "remote", hostId: "zest" } as const;
    expect(encodeHostLocation(remote)).toBe("remote:zest");
    expect(decodeHostLocation(encodeHostLocation(remote))).toEqual(remote);
  });

  it('a remote hostId literally "local" encodes to "remote:local" — never confused with the local variant', () => {
    const remote = { kind: "remote", hostId: "local" } as const;
    expect(encodeHostLocation(remote)).toBe("remote:local");
    expect(decodeHostLocation("remote:local")).toEqual(remote);
    expect(decodeHostLocation("remote:local")).not.toEqual(LOCAL_LOCATION);
  });

  it("decodeHostLocation throws loudly on a non-canonical string", () => {
    expect(() => decodeHostLocation("")).toThrow();
    expect(() => decodeHostLocation("zest")).toThrow();
    expect(() => decodeHostLocation("remote:")).toThrow();
    expect(() => decodeHostLocation("Local")).toThrow();
  });

  it("HostLocationSchema rejects an empty remote hostId — the shape the codec can't round-trip", () => {
    expect(accepts(HostLocationSchema, { kind: "local" })).toBe(true);
    expect(
      accepts(HostLocationSchema, { kind: "remote", hostId: "zest" }),
    ).toBe(true);
    expect(accepts(HostLocationSchema, { kind: "remote", hostId: "" })).toBe(
      false,
    );
    // PIN: an empty hostId is exactly what `encodeHostLocation` would turn into
    // the bare "remote:" prefix, which `decodeHostLocation` already throws on —
    // the schema now refuses to mint the value in the first place. (`hostId:
    // string` is unrefined at the TYPE level — a min-length CHECK is a runtime
    // gate — so this literal still typechecks as a `HostLocation`; the schema is
    // the one guard that actually rejects it.)
    const emptyRemote = { kind: "remote" as const, hostId: "" };
    expect(encodeHostLocation(emptyRemote)).toBe("remote:");
    expect(() => decodeHostLocation(encodeHostLocation(emptyRemote))).toThrow();
  });
});
