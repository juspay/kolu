/**
 * The agent-tools bake record + drift drain (juspay/kolu#2146) — the covering
 * test the shared-artifact inventory names for `padi-agent-tools-bake`.
 *
 * The mixed-version disposition proven here is the ABSENT-record row: a daemon
 * predating the record yields NO drift verdict from a newer supervisor (the
 * build-mismatch drain owns that window), and an unbaked supervisor never
 * judges a baked daemon. The drain rows prove the drift path end-to-end against
 * a fake probe, including that failure arms surface their error text instead of
 * collapsing to a silent adopt.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConvergenceProbe } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { AGENT_TOOLS_BAKE_ENV } from "kolu-pty";
import { afterEach, describe, expect, it } from "vitest";
import {
  drainResidentOnAgentToolsBakeDrift,
  readAgentToolsBakeRecord,
  writeAgentToolsBakeRecord,
} from "../agentToolsBake.ts";

const NEW_BAKE = "/nix/store/new-kolu/bin:/nix/store/new-tools/bin";
const OLD_BAKE = "/nix/store/old-padi-agent/bin";

const dirs: string[] = [];
function runtimeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-tools-bake-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A drainable probe over spies. `exits` decides whether the exit oracle fires
 *  (a drain that takes) or never resolves (a wedged daemon → ceiling). */
function fakeProbe(opts: { exits: boolean }) {
  const calls = { fired: 0, disposed: 0 };
  const probe: ConvergenceProbe<"drainable"> = {
    capability: "drainable",
    identity: { contractVersion: "1.0", build: { kind: "known", id: "t" } },
    instanceKey: { kind: "pre-instance" },
    dispose: () => {
      calls.disposed += 1;
    },
    fireDrain: Effect.sync(() => {
      calls.fired += 1;
    }),
    awaitExit: opts.exits ? Effect.void : Effect.never,
    drainCeilingMs: 25,
  };
  return { probe, calls };
}

describe("agent-tools bake record", () => {
  it("round-trips the baked value, keeps '' distinct from absence", () => {
    const dir = runtimeDir();
    expect(readAgentToolsBakeRecord(dir)).toBeUndefined();

    writeAgentToolsBakeRecord(dir, { [AGENT_TOOLS_BAKE_ENV]: NEW_BAKE });
    expect(readAgentToolsBakeRecord(dir)).toBe(NEW_BAKE);

    // An unbaked daemon records the honest empty — a stated fact, not absence.
    writeAgentToolsBakeRecord(dir, {});
    expect(readAgentToolsBakeRecord(dir)).toBe("");
  });
});

describe("drainResidentOnAgentToolsBakeDrift", () => {
  const probeNever = () => {
    throw new Error("probe must not be dialed on the no-verdict paths");
  };

  it("absent record → in-sync (pre-record daemon; build axis owns that window)", async () => {
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: runtimeDir(),
        socketPath: "/nowhere.sock",
        ownBake: NEW_BAKE,
        probe: probeNever,
      }),
    );
    expect(outcome).toEqual({ kind: "in-sync" });
  });

  it("unbaked supervisor → in-sync even against a baked record", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, { [AGENT_TOOLS_BAKE_ENV]: OLD_BAKE });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/nowhere.sock",
        ownBake: "",
        probe: probeNever,
      }),
    );
    expect(outcome).toEqual({ kind: "in-sync" });
  });

  it("matching record → in-sync, probe untouched", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, { [AGENT_TOOLS_BAKE_ENV]: NEW_BAKE });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/nowhere.sock",
        ownBake: NEW_BAKE,
        probe: probeNever,
      }),
    );
    expect(outcome).toEqual({ kind: "in-sync" });
  });

  it("drift + nothing listening → no-resident (a dead daemon's leftover record)", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, { [AGENT_TOOLS_BAKE_ENV]: OLD_BAKE });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/nowhere.sock",
        ownBake: NEW_BAKE,
        probe: () => Effect.succeed(null),
      }),
    );
    expect(outcome).toEqual({ kind: "no-resident", recorded: OLD_BAKE });
  });

  it("drift + probe error → probe-failed with the error surfaced", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, { [AGENT_TOOLS_BAKE_ENV]: OLD_BAKE });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/nowhere.sock",
        ownBake: NEW_BAKE,
        probe: () => Effect.fail(new Error("unspeakable peer")),
      }),
    );
    expect(outcome.kind).toBe("probe-failed");
    if (outcome.kind !== "probe-failed") throw new Error("unreachable");
    expect(outcome.recorded).toBe(OLD_BAKE);
    expect(outcome.error).toContain("unspeakable peer");
  });

  it("drift + live resident → fires the drain, confirms exit, disposes the probe", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, { [AGENT_TOOLS_BAKE_ENV]: OLD_BAKE });
    const { probe, calls } = fakeProbe({ exits: true });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/resident.sock",
        ownBake: NEW_BAKE,
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome).toEqual({ kind: "drained", recorded: OLD_BAKE });
    expect(calls.fired).toBe(1);
    expect(calls.disposed).toBe(1);
  });

  it("drift + wedged resident → drain-failed at the probe's ceiling, still disposed", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, { [AGENT_TOOLS_BAKE_ENV]: OLD_BAKE });
    const { probe, calls } = fakeProbe({ exits: false });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/resident.sock",
        ownBake: NEW_BAKE,
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome.kind).toBe("drain-failed");
    if (outcome.kind !== "drain-failed") throw new Error("unreachable");
    expect(outcome.error).toContain("did not close within");
    expect(calls.disposed).toBe(1);
  });
});
