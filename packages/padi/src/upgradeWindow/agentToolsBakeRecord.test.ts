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

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConvergenceProbe } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { AGENT_TOOLS_BAKE_ENV } from "kolu-pty";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_TOOLS_BAKE_RECORD_FILE,
  agentBakeOf,
  drainResidentOnAgentToolsBakeDrift,
  readAgentToolsBakeRecord,
  writeAgentToolsBakeRecord,
} from "../agentToolsBake.ts";
import {
  AGENT_DISTRO_BUNDLE_ENV,
  AGENT_DISTRO_UPDATER_ENV,
  AGENT_PLUGIN_DIR_ENV,
} from "../agentDistro/bake.ts";

const NEW_BAKE = "/nix/store/new-kolu/bin:/nix/store/new-tools/bin";
const OLD_BAKE = "/nix/store/old-padi-agent/bin";
/** agent-distro's bake as a kolu build hands it to padi. */
const DISTRO = {
  [AGENT_DISTRO_UPDATER_ENV]: "/nix/store/new-updater/updater.json",
  [AGENT_DISTRO_BUNDLE_ENV]: "/nix/store/new-floor",
  [AGENT_PLUGIN_DIR_ENV]: "/nix/store/agent-plugin",
};
const NEW_ENV = { [AGENT_TOOLS_BAKE_ENV]: NEW_BAKE, ...DISTRO };
const OLD_ENV = { [AGENT_TOOLS_BAKE_ENV]: OLD_BAKE, ...DISTRO };
/** The supervisor's own bake in the common case. */
const NEW = agentBakeOf(NEW_ENV);
/** The drift fact a toolchain-only drift reports. */
const OLD_DRIFT = {
  recorded: agentBakeOf(OLD_ENV),
  drifted: [AGENT_TOOLS_BAKE_ENV],
};
/** The build id the fake probe reports — supervisors pass the same value to
 *  land in the same-build arm this check exists for. */
const SAME_BUILD = "t";

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

    writeAgentToolsBakeRecord(dir, NEW_ENV);
    expect(readAgentToolsBakeRecord(dir)).toEqual(NEW);

    // An unbaked daemon records the honest empty — a stated fact, not absence.
    writeAgentToolsBakeRecord(dir, {});
    expect(readAgentToolsBakeRecord(dir)).toEqual({
      [AGENT_TOOLS_BAKE_ENV]: "",
      [AGENT_DISTRO_UPDATER_ENV]: "",
      [AGENT_DISTRO_BUNDLE_ENV]: "",
      [AGENT_PLUGIN_DIR_ENV]: "",
    });
  });

  it("a record predating the agent-distro fields reads as the toolchain alone — those fields absent, never ''", () => {
    const dir = runtimeDir();
    writeFileSync(join(dir, AGENT_TOOLS_BAKE_RECORD_FILE), `${NEW_BAKE}\n`);
    expect(readAgentToolsBakeRecord(dir)).toEqual({
      [AGENT_TOOLS_BAKE_ENV]: NEW_BAKE,
    });
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
        ownBake: NEW,
        ownBuildId: SAME_BUILD,
        probe: probeNever,
      }),
    );
    expect(outcome).toEqual({ kind: "in-sync" });
  });

  it("unbaked supervisor → in-sync even against a baked record", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, OLD_ENV);
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/nowhere.sock",
        ownBake: agentBakeOf({}),
        ownBuildId: SAME_BUILD,
        probe: probeNever,
      }),
    );
    expect(outcome).toEqual({ kind: "in-sync" });
  });

  it("matching record → in-sync, probe untouched", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, NEW_ENV);
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/nowhere.sock",
        ownBake: NEW,
        ownBuildId: SAME_BUILD,
        probe: probeNever,
      }),
    );
    expect(outcome).toEqual({ kind: "in-sync" });
  });

  it("drift + nothing listening → no-resident (a dead daemon's leftover record)", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, OLD_ENV);
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/nowhere.sock",
        ownBake: NEW,
        ownBuildId: SAME_BUILD,
        probe: () => Effect.succeed(null),
      }),
    );
    expect(outcome).toEqual({ kind: "no-resident", ...OLD_DRIFT });
  });

  it("drift + probe error → probe-failed with the error surfaced", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, OLD_ENV);
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/nowhere.sock",
        ownBake: NEW,
        ownBuildId: SAME_BUILD,
        probe: () => Effect.fail(new Error("unspeakable peer")),
      }),
    );
    expect(outcome.kind).toBe("probe-failed");
    if (outcome.kind !== "probe-failed") throw new Error("unreachable");
    expect(outcome.recorded).toEqual(OLD_DRIFT.recorded);
    expect(outcome.error).toContain("unspeakable peer");
  });

  it("drift + a DIFFERENT build → foreign-build, untouched for the kit's own axis", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, OLD_ENV);
    const { probe, calls } = fakeProbe({ exits: true });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/resident.sock",
        ownBake: NEW,
        ownBuildId: "a-different-build",
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome).toEqual({ kind: "foreign-build", ...OLD_DRIFT });
    // The kit's build-mismatch drain owns this transition (and its VM-proof
    // breadcrumb) — this check must not fire the drain, only step aside.
    expect(calls.fired).toBe(0);
    expect(calls.disposed).toBe(1);
  });

  it("drift + an off-nix supervisor build → foreign-build (never proven the same)", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, OLD_ENV);
    const { probe, calls } = fakeProbe({ exits: true });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/resident.sock",
        ownBake: NEW,
        ownBuildId: "",
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome).toEqual({ kind: "foreign-build", ...OLD_DRIFT });
    expect(calls.fired).toBe(0);
  });

  it("drift + live resident → fires the drain, confirms exit, disposes the probe", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, OLD_ENV);
    const { probe, calls } = fakeProbe({ exits: true });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/resident.sock",
        ownBake: NEW,
        ownBuildId: SAME_BUILD,
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome).toEqual({ kind: "drained", ...OLD_DRIFT });
    expect(calls.fired).toBe(1);
    expect(calls.disposed).toBe(1);
  });

  it("drift + wedged resident → drain-failed at the probe's ceiling, still disposed", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, OLD_ENV);
    const { probe, calls } = fakeProbe({ exits: false });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/resident.sock",
        ownBake: NEW,
        ownBuildId: SAME_BUILD,
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome.kind).toBe("drain-failed");
    if (outcome.kind !== "drain-failed") throw new Error("unreachable");
    expect(outcome.error).toContain("did not close within");
    expect(calls.disposed).toBe(1);
  });

  it("the toolchain matches but agent-distro's bake drifted (a pin bump) → drained", async () => {
    const dir = runtimeDir();
    const oldPin = {
      ...NEW_ENV,
      [AGENT_DISTRO_UPDATER_ENV]: "/nix/store/old-updater/updater.json",
      [AGENT_DISTRO_BUNDLE_ENV]: "/nix/store/old-floor",
    };
    writeAgentToolsBakeRecord(dir, oldPin);
    const { probe, calls } = fakeProbe({ exits: true });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/resident.sock",
        ownBake: NEW,
        ownBuildId: SAME_BUILD,
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome).toEqual({
      kind: "drained",
      recorded: agentBakeOf(oldPin),
      drifted: [AGENT_DISTRO_UPDATER_ENV, AGENT_DISTRO_BUNDLE_ENV],
    });
    expect(calls.fired).toBe(1);
  });

  it("a record predating the agent-distro fields, toolchain matching → in-sync (absent is not '')", async () => {
    const dir = runtimeDir();
    writeFileSync(join(dir, AGENT_TOOLS_BAKE_RECORD_FILE), `${NEW_BAKE}\n`);
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/nowhere.sock",
        ownBake: NEW,
        ownBuildId: SAME_BUILD,
        probe: probeNever,
      }),
    );
    expect(outcome).toEqual({ kind: "in-sync" });
  });
});
