import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRemotePool } from "@kolu/surface-remote";
import Conf from "conf";
import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPersistedHosts, savePoolMembership } from "./hostPersistence.ts";
import { store } from "./state.ts";

const LOCAL = encodeHostKey(LOCAL_HOST);
const NO_SEEDS: ReadonlySet<string> = new Set();

beforeEach(() => store.set("hosts", []));
afterEach(() => store.set("hosts", []));

describe("getPersistedHosts", () => {
  it("returns [] on a fresh store (conf's empty default merges in)", () => {
    expect(getPersistedHosts()).toEqual([]);
  });

  it("round-trips the saved encoded host keys", async () => {
    await savePoolMembership(
      ["remote:srid@zest", "remote:pu-kolu-3"],
      NO_SEEDS,
    );
    expect(getPersistedHosts()).toEqual([
      "remote:srid@zest",
      "remote:pu-kolu-3",
    ]);
  });

  it("THROWS naming the store when a persisted host is not a canonical encoded key", () => {
    store.set("hosts", ["garbage"]);
    expect(() => getPersistedHosts()).toThrow(store.path);
    expect(() => getPersistedHosts()).toThrow(/do not match schema/);
  });

  it("THROWS when the store persists the local default (a second authority)", () => {
    store.set("hosts", [LOCAL, "remote:a"]);
    expect(() => getPersistedHosts()).toThrow(/must never be persisted/);
  });

  it("THROWS on duplicate persisted hosts (never silently normalized)", () => {
    store.set("hosts", ["remote:a", "remote:a"]);
    expect(() => getPersistedHosts()).toThrow(/duplicate host entries/);
  });

  it("does NOT collapse an invalid list to an empty fleet — it throws", () => {
    store.set("hosts", [LOCAL]);
    expect(() => getPersistedHosts()).toThrow();
  });
});

describe("savePoolMembership (the persist-hook shaper)", () => {
  it("excludes the unremovable local default — it never enters the store", async () => {
    await savePoolMembership([LOCAL, "remote:a", "remote:b"], NO_SEEDS);
    expect(getPersistedHosts()).toEqual(["remote:a", "remote:b"]);
  });

  it("writes an empty list when the pool holds only the local default", async () => {
    await savePoolMembership([LOCAL], NO_SEEDS);
    expect(getPersistedHosts()).toEqual([]);
  });

  it("excludes declarative env seeds — a KOLU_PADI_HOST host is not persisted", async () => {
    await savePoolMembership(
      [LOCAL, "remote:env", "remote:strip"],
      new Set(["remote:env"]),
    );
    expect(getPersistedHosts()).toEqual(["remote:strip"]);
  });

  it("persists a host that is BOTH an env seed and already persisted (persisted-at-boot wins)", async () => {
    await savePoolMembership([LOCAL, "remote:both", "remote:strip"], new Set());
    expect(getPersistedHosts()).toEqual(["remote:both", "remote:strip"]);
  });

  it("replaces the stored list whole on each write (a removal shrinks it)", async () => {
    await savePoolMembership([LOCAL, "remote:a", "remote:b"], NO_SEEDS);
    await savePoolMembership([LOCAL, "remote:b"], NO_SEEDS);
    expect(getPersistedHosts()).toEqual(["remote:b"]);
  });
});

describe("conf is fail-fast on a corrupt store (as conf actually behaves)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function freshDir(): string {
    const d = mkdtempSync(join(tmpdir(), "kolu-hosts-conf-"));
    dirs.push(d);
    return d;
  }

  it("THROWS (never resets to defaults) when config.json is unparseable JSON", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "config.json"), "{ not json", "utf8");
    expect(() => {
      new Conf<{ hosts: string[] }>({
        cwd: dir,
        projectVersion: "1.33.0",
        defaults: { hosts: [] },
      }).get("hosts");
    }).toThrow();
  });
});

describe("round-trip through buildRemotePool's persist hook (conf-backed)", () => {
  const stubEntry = () => ({ session: { destroy() {} }, handler: undefined });

  it("persists add/remove and restores the fleet on restart", async () => {
    const persist = (hosts: string[]) => savePoolMembership(hosts, NO_SEEDS);

    const pool = buildRemotePool<{ destroy(): void }, undefined>({
      initialHosts: [LOCAL],
      buildEntry: stubEntry,
      persist,
    });

    await pool.add("remote:a");
    await pool.add("remote:b");
    expect(getPersistedHosts()).toEqual(["remote:a", "remote:b"]);

    await pool.remove("remote:a");
    expect(getPersistedHosts()).toEqual(["remote:b"]);

    const restored = buildRemotePool<{ destroy(): void }, undefined>({
      initialHosts: [LOCAL, ...getPersistedHosts()],
      buildEntry: stubEntry,
      persist,
    });
    expect(restored.hosts()).toEqual([LOCAL, "remote:b"]);
  });
});
