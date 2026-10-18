/**
 * The agent-tools bake record + drift drain (juspay/kolu#2146), and the
 * late-binding tool links (juspay/kolu#2305) — the covering test the
 * shared-artifact inventory names for `padi-agent-tools-bake` AND
 * `padi-agent-tools-links`.
 *
 * The mixed-version disposition proven here is the ABSENT-record row: a daemon
 * predating the record yields NO drift verdict from a newer supervisor (the
 * build-mismatch drain owns that window), and an unbaked supervisor never
 * judges a baked daemon. The drain rows prove the drift path end-to-end against
 * a fake probe, including that failure arms surface their error text instead of
 * collapsing to a silent adopt.
 *
 * The link block proves the terminal-facing half: one link per bake entry in
 * bake order, flipped atomically to a newer bake with the extras pruned, and the
 * planted link tree classified by the shared-artifact inventory.
 */

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
/** The build id the fake probe reports — supervisors pass the same value to
 *  land in the same-build arm this check exists for. */
const SAME_BUILD = "t";

const dirs: string[] = [];
function runtimeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-tools-bake-"));
  dirs.push(dir);
  return dir;
}
/** A directory standing in for one bake entry's store dir. */
function storeDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agent-tools-store-${name}-`));
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

    // What daemonMain records for the spawn path is exactly these dirs.
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

    // A newer, SHORTER bake (a wrapper that stopped forwarding one dir).
    const links = writeAgentToolsLinks(runtime, [b0]);
    expect(links).toEqual([join(runtime, "tools", "0")]);
    // The link flipped to the newer build — a terminal spawned under either bake
    // execs B through it.
    expect(realpathSync(join(runtime, "tools", "0"))).toBe(realpathSync(b0));
    // tools/1 is pruned, and the atomic rename left no `<link>.kolu-tmp` behind.
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
    // The real on-disk shape under a `padi-<digest>` runtime dir: tools/0 is a
    // symlink to a store dir, and a tool inside that dir is a file. Node's
    // recursive readdir FOLLOWS the symlink, so the grounded sweep sees
    // `…/tools/0/kolu` — the `padi-agent-tools-links` row's `diskBasenamePatterns`
    // must classify it, or the watchdog reports the store's bin names as unknown
    // shared artifacts on a real host. (Mutate the regex and this goes red.)
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
    // The kit's build-mismatch drain owns this transition (and its VM-proof
    // breadcrumb) — this check must not fire the drain, only step aside.
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
