import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConvergenceProbe } from "@kolu/surface-daemon-supervisor";
import { unknownProtocolFilesOnDisk } from "@kolu/surface-daemon/upgrade-window.testlib";
import { Effect } from "effect";
import { AGENT_TOOLS_BAKE_ENV } from "kolu-pty";
import { afterEach, describe, expect, it } from "vitest";
import {
  drainResidentOnAgentToolsBakeDrift,
  readAgentToolsBakeRecord,
  readAgentToolsLinkDirs,
  setAgentToolsLinkDirs,
  writeAgentToolsBakeRecord,
  writeAgentToolsLinks,
} from "../agentToolsBake.ts";
import { SHARED_ARTIFACTS } from "./sharedArtifacts.testlib.ts";

const NEW_BAKE = "/nix/store/new-kolu/bin:/nix/store/new-tools/bin";
const OLD_BAKE = "/nix/store/old-padi-agent/bin";
const SAME_BUILD = "t";

const dirs: string[] = [];
function runtimeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-tools-bake-"));
  dirs.push(dir);
  return dir;
}
function storeDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agent-tools-store-${name}-`));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

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

    writeAgentToolsBakeRecord(dir, {});
    expect(readAgentToolsBakeRecord(dir)).toBe("");
  });
});

describe("agent-tools link dirs (#2305)", () => {
  it("materializes one link per bake entry, in bake order, resolving to its store dir", () => {
    const runtime = runtimeDir();
    const a = storeDir("a");
    const b = storeDir("b");
    const links = writeAgentToolsLinks(runtime, [a, b]);
    expect(links).toEqual([
      join(runtime, "tools", "0"),
      join(runtime, "tools", "1"),
    ]);
    expect(lstatSync(links[0]!).isSymbolicLink()).toBe(true);
    expect(realpathSync(links[0]!)).toBe(realpathSync(a));
    expect(realpathSync(links[1]!)).toBe(realpathSync(b));

    setAgentToolsLinkDirs(links);
    expect(readAgentToolsLinkDirs()).toEqual(links);
  });

  it("flips tools/<i> to a newer bake, prunes the extras, leaves no temp", () => {
    const runtime = runtimeDir();
    const a0 = storeDir("a0");
    const a1 = storeDir("a1");
    const b0 = storeDir("b0");
    writeAgentToolsLinks(runtime, [a0, a1]);
    expect(realpathSync(join(runtime, "tools", "0"))).toBe(realpathSync(a0));

    const links = writeAgentToolsLinks(runtime, [b0]);
    expect(links).toEqual([join(runtime, "tools", "0")]);
    expect(realpathSync(join(runtime, "tools", "0"))).toBe(realpathSync(b0));
    expect(readdirSync(join(runtime, "tools"))).toEqual(["0"]);
  });

  it("stamps nothing for an empty bake (from-source), pruning stale links", () => {
    const runtime = runtimeDir();
    writeAgentToolsLinks(runtime, [storeDir("stale")]);
    expect(writeAgentToolsLinks(runtime, [])).toEqual([]);
    expect(readdirSync(join(runtime, "tools"))).toEqual([]);
  });

  it("throws when the bake names a directory that does not exist (fail fast)", () => {
    const runtime = runtimeDir();
    const missing = join(runtime, "not-a-store-dir");
    expect(() => writeAgentToolsLinks(runtime, [missing])).toThrow(
      `agent-tools bake names a directory that does not exist: ${missing}`,
    );
  });

  it("the planted link tree is accounted for by the shared-artifact inventory", () => {
    // Node's recursive `readdirSync` FOLLOWS a symlinked dir, so the sweep sees
    // `…/tools/0/<tool>` and the link row's patterns must classify it.
    const runtime = runtimeDir();
    const padiDir = join(runtime, "padi-deadbeef");
    mkdirSync(padiDir, { recursive: true, mode: 0o700 });
    const store = storeDir("sweep");
    writeFileSync(join(store, "kolu"), "# stub\n");
    writeAgentToolsLinks(padiDir, [store]);
    expect(unknownProtocolFilesOnDisk(SHARED_ARTIFACTS, runtime)).toEqual([]);
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
        ownBuildId: SAME_BUILD,
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
        ownBuildId: SAME_BUILD,
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
        ownBuildId: SAME_BUILD,
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
        ownBuildId: SAME_BUILD,
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
        ownBuildId: SAME_BUILD,
        probe: () => Effect.fail(new Error("unspeakable peer")),
      }),
    );
    expect(outcome.kind).toBe("probe-failed");
    if (outcome.kind !== "probe-failed") throw new Error("unreachable");
    expect(outcome.recorded).toBe(OLD_BAKE);
    expect(outcome.error).toContain("unspeakable peer");
  });

  it("drift + a DIFFERENT build → foreign-build, untouched for the kit's own axis", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, { [AGENT_TOOLS_BAKE_ENV]: OLD_BAKE });
    const { probe, calls } = fakeProbe({ exits: true });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/resident.sock",
        ownBake: NEW_BAKE,
        ownBuildId: "a-different-build",
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome).toEqual({ kind: "foreign-build", recorded: OLD_BAKE });
    expect(calls.fired).toBe(0);
    expect(calls.disposed).toBe(1);
  });

  it("drift + an off-nix supervisor build → foreign-build (never proven the same)", async () => {
    const dir = runtimeDir();
    writeAgentToolsBakeRecord(dir, { [AGENT_TOOLS_BAKE_ENV]: OLD_BAKE });
    const { probe, calls } = fakeProbe({ exits: true });
    const outcome = await Effect.runPromise(
      drainResidentOnAgentToolsBakeDrift({
        runtimeDir: dir,
        socketPath: "/resident.sock",
        ownBake: NEW_BAKE,
        ownBuildId: "",
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome).toEqual({ kind: "foreign-build", recorded: OLD_BAKE });
    expect(calls.fired).toBe(0);
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
        ownBuildId: SAME_BUILD,
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
        ownBuildId: SAME_BUILD,
        probe: () => Effect.succeed(probe),
      }),
    );
    expect(outcome.kind).toBe("drain-failed");
    if (outcome.kind !== "drain-failed") throw new Error("unreachable");
    expect(outcome.error).toContain("did not close within");
    expect(calls.disposed).toBe(1);
  });
});
