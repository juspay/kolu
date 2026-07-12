import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRemotePool } from "@kolu/surface-remote";
import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { afterEach, describe, expect, it } from "vitest";
import {
  hostsFilePath,
  loadPersistedHosts,
  type PersistedHosts,
  savePersistedHosts,
  savePoolMembership,
} from "./hostPersistence.ts";

const LOCAL = encodeHostKey(LOCAL_HOST); // "local"

// Each test gets its own ephemeral state dir; the module reads/writes an explicit
// path (no KOLU_STATE_DIR coupling), so there's no env to set up or tear down.
const dirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kolu-host-persist-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  // The mkdtemp dirs are ephemeral (OS tmp); leave cleanup to the OS to keep the
  // test free of teardown flake. Reset the tracking list so it can't grow unbounded
  // across a watch run.
  dirs.length = 0;
});

describe("loadPersistedHosts", () => {
  it("returns [] when the file is absent (a fresh install has no fleet)", () => {
    expect(loadPersistedHosts(hostsFilePath(freshDir()))).toEqual([]);
  });

  it("round-trips the saved encoded host keys", () => {
    const path = hostsFilePath(freshDir());
    savePersistedHosts(path, ["remote:srid@zest", "remote:pu-kolu-3"]);
    expect(loadPersistedHosts(path)).toEqual([
      "remote:srid@zest",
      "remote:pu-kolu-3",
    ]);
  });

  it("CRASHES with the path when the file is not valid JSON", () => {
    const path = hostsFilePath(freshDir());
    writeFileSync(path, "{ not json", "utf8");
    expect(() => loadPersistedHosts(path)).toThrow(path);
    expect(() => loadPersistedHosts(path)).toThrow(/not valid JSON/);
  });

  it("CRASHES with the path when the shape fails the schema (wrong version)", () => {
    const path = hostsFilePath(freshDir());
    writeFileSync(path, JSON.stringify({ version: 2, hosts: [] }), "utf8");
    expect(() => loadPersistedHosts(path)).toThrow(path);
    expect(() => loadPersistedHosts(path)).toThrow(/does not match schema/);
  });

  it("CRASHES with the path when a host string is not a canonical encoded key", () => {
    const path = hostsFilePath(freshDir());
    // "garbage" is neither "local" nor "remote:<target>" — decodeHostKey rejects it.
    writeFileSync(
      path,
      JSON.stringify({ version: 1, hosts: ["garbage"] }),
      "utf8",
    );
    expect(() => loadPersistedHosts(path)).toThrow(path);
    expect(() => loadPersistedHosts(path)).toThrow(/does not match schema/);
  });

  it("does NOT start with an empty fleet on a corrupt file — it throws instead", () => {
    const path = hostsFilePath(freshDir());
    writeFileSync(path, "\0\0\0", "utf8");
    // The fail-fast contract: never collapse a caught error to `[]`.
    expect(() => loadPersistedHosts(path)).toThrow();
  });
});

describe("savePersistedHosts", () => {
  it("writes a { version: 1, hosts } JSON value", () => {
    const path = hostsFilePath(freshDir());
    savePersistedHosts(path, ["remote:a"]);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedHosts;
    expect(parsed).toEqual({ version: 1, hosts: ["remote:a"] });
  });

  it("replaces the file whole on each write (last write wins)", () => {
    const path = hostsFilePath(freshDir());
    savePersistedHosts(path, ["remote:a", "remote:b"]);
    savePersistedHosts(path, ["remote:b"]); // a removal
    expect(loadPersistedHosts(path)).toEqual(["remote:b"]);
  });
});

describe("savePoolMembership", () => {
  it("excludes the unremovable local default — it never enters the file", () => {
    const path = hostsFilePath(freshDir());
    savePoolMembership(path, [LOCAL, "remote:a", "remote:b"], LOCAL);
    expect(loadPersistedHosts(path)).toEqual(["remote:a", "remote:b"]);
  });

  it("writes an empty list when the pool holds only the local default", () => {
    const path = hostsFilePath(freshDir());
    savePoolMembership(path, [LOCAL], LOCAL);
    expect(loadPersistedHosts(path)).toEqual([]);
  });
});

// End-to-end: the real `buildRemotePool` with `savePoolMembership` wired as its
// `persist` hook — add/remove/restart, exactly as `index.ts` wires it. Proves the
// plan's four bullets against the actual pool contract, not just the leaf module.
describe("round-trip through buildRemotePool's persist hook", () => {
  // A minimal DestroyableSession — the pool only ever destroy()s it.
  const stubEntry = () => ({ session: { destroy() {} }, handler: undefined });

  it("persists add/remove and restores the fleet on restart", async () => {
    const path = hostsFilePath(freshDir());
    const persist = async (hosts: string[]) =>
      savePoolMembership(path, hosts, LOCAL);

    const pool = buildRemotePool<{ destroy(): void }, undefined>({
      initialHosts: [LOCAL], // the seeded local default
      buildEntry: stubEntry,
      persist,
    });

    // Two strip adds → both remembered, local excluded.
    await pool.add("remote:a");
    await pool.add("remote:b");
    expect(loadPersistedHosts(path)).toEqual(["remote:a", "remote:b"]);

    // A strip remove updates the file.
    await pool.remove("remote:a");
    expect(loadPersistedHosts(path)).toEqual(["remote:b"]);

    // "Restart": a NEW pool seeded from the local default + the persisted fleet —
    // exactly index.ts's boot merge. The remembered host reappears as a member.
    const restored = buildRemotePool<{ destroy(): void }, undefined>({
      initialHosts: [LOCAL, ...loadPersistedHosts(path)],
      buildEntry: stubEntry,
      persist,
    });
    expect(restored.hosts()).toEqual([LOCAL, "remote:b"]);
  });
});
