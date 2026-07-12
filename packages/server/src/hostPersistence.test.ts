import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const NO_SEEDS: ReadonlySet<string> = new Set();

// Each test gets its own ephemeral state dir; the module reads/writes an explicit
// path (no KOLU_STATE_DIR coupling), so there's no env to set up or tear down. The
// dirs are removed in `afterEach` so a long watch run doesn't accrete tmp dirs.
const createdDirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kolu-host-persist-"));
  createdDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadPersistedHosts", () => {
  it("returns [] when the file is absent (a fresh install has no fleet)", () => {
    expect(loadPersistedHosts(hostsFilePath(freshDir()))).toEqual([]);
  });

  it("round-trips the saved encoded host keys", async () => {
    const path = hostsFilePath(freshDir());
    await savePersistedHosts(path, ["remote:srid@zest", "remote:pu-kolu-3"]);
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

  it("a non-ENOENT read error (a directory in the file's place) THROWS, not []", () => {
    // Only a genuinely-absent file (ENOENT) reads as a fresh install. Point the
    // loader at a directory: readFileSync raises EISDIR, which must surface — never
    // collapse to an empty fleet (the `existsSync` trap this guards against).
    const dir = freshDir();
    expect(() => loadPersistedHosts(dir)).toThrow();
  });

  it("CRASHES when the file persists the local default (a second authority)", () => {
    const path = hostsFilePath(freshDir());
    writeFileSync(
      path,
      JSON.stringify({ version: 1, hosts: [LOCAL, "remote:a"] }),
      "utf8",
    );
    // Fail-fast, not silent Set-normalization: `local` is never written, so a file
    // that contains it is corrupt.
    expect(() => loadPersistedHosts(path)).toThrow(/must never be persisted/);
  });

  it("CRASHES when the file contains duplicate hosts", () => {
    const path = hostsFilePath(freshDir());
    writeFileSync(
      path,
      JSON.stringify({ version: 1, hosts: ["remote:a", "remote:a"] }),
      "utf8",
    );
    expect(() => loadPersistedHosts(path)).toThrow(/duplicate host entries/);
  });
});

describe("savePersistedHosts", () => {
  it("writes a { version: 1, hosts } JSON value", async () => {
    const path = hostsFilePath(freshDir());
    await savePersistedHosts(path, ["remote:a"]);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedHosts;
    expect(parsed).toEqual({ version: 1, hosts: ["remote:a"] });
  });

  it("replaces the file whole on each write (last write wins)", async () => {
    const path = hostsFilePath(freshDir());
    await savePersistedHosts(path, ["remote:a", "remote:b"]);
    await savePersistedHosts(path, ["remote:b"]); // a removal
    expect(loadPersistedHosts(path)).toEqual(["remote:b"]);
  });
});

describe("savePoolMembership", () => {
  it("excludes the unremovable local default — it never enters the file", async () => {
    const path = hostsFilePath(freshDir());
    await savePoolMembership(path, [LOCAL, "remote:a", "remote:b"], NO_SEEDS);
    expect(loadPersistedHosts(path)).toEqual(["remote:a", "remote:b"]);
  });

  it("writes an empty list when the pool holds only the local default", async () => {
    const path = hostsFilePath(freshDir());
    await savePoolMembership(path, [LOCAL], NO_SEEDS);
    expect(loadPersistedHosts(path)).toEqual([]);
  });

  it("excludes declarative env seeds — a KOLU_PADI_HOST host is not persisted", async () => {
    const path = hostsFilePath(freshDir());
    // remote:env is a pure env seed; remote:strip was added at runtime.
    await savePoolMembership(
      path,
      [LOCAL, "remote:env", "remote:strip"],
      new Set(["remote:env"]),
    );
    expect(loadPersistedHosts(path)).toEqual(["remote:strip"]);
  });

  it("persists a host that is BOTH an env seed and already persisted (persisted-at-boot wins)", async () => {
    const path = hostsFilePath(freshDir());
    // `declarativeSeedKeys` is env-MINUS-persisted-at-boot, so a host in both is NOT
    // in it — the caller's job — and therefore stays persisted. Model that here.
    await savePoolMembership(
      path,
      [LOCAL, "remote:both", "remote:strip"],
      new Set(), // remote:both was persisted-at-boot, so excluded from the seed set
    );
    expect(loadPersistedHosts(path)).toEqual(["remote:both", "remote:strip"]);
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
    const persist = (hosts: string[]) =>
      savePoolMembership(path, hosts, NO_SEEDS);

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
