import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRemotePool } from "@kolu/surface-remote";
import Conf from "conf";
import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPersistedHosts, savePoolMembership } from "./hostPersistence.ts";
import { store } from "./state.ts";

const LOCAL = encodeHostKey(LOCAL_HOST); // "local"
const NO_SEEDS: ReadonlySet<string> = new Set();

// hostPersistence reads/writes the `hosts` field of the module conf `store` (state.ts),
// opened at the harness's ephemeral KOLU_STATE_DIR. Reset a MUTATED field after each test
// so cases don't bleed into one another (and so an invalid value a throw-case wrote doesn't
// linger on disk for the next case). Avoid writing an already-empty value: Conf's
// synchronous atomic write includes fsync, which is both real work and load-sensitive.
function resetHostsIfNeeded(): void {
  const hosts: unknown = store.get("hosts");
  if (!Array.isArray(hosts) || hosts.length > 0) store.set("hosts", []);
}
afterEach(resetHostsIfNeeded);

describe("fixture cleanup", () => {
  it("does not rewrite an already-empty store", () => {
    const set = vi.spyOn(store, "set");
    resetHostsIfNeeded();
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
});

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
    store.set("hosts", ["garbage"]); // neither "local" nor "remote:<target>"
    expect(() => getPersistedHosts()).toThrow(store.path);
    expect(() => getPersistedHosts()).toThrow(/do not match schema/);
  });

  it("THROWS when the store persists the local default (a second authority)", () => {
    store.set("hosts", [LOCAL, "remote:a"]);
    // Fail-fast, not silent Set-normalization: `local` is never written, so a store that
    // contains it is corrupt.
    expect(() => getPersistedHosts()).toThrow(/must never be persisted/);
  });

  it("THROWS on duplicate persisted hosts (never silently normalized)", () => {
    store.set("hosts", ["remote:a", "remote:a"]);
    expect(() => getPersistedHosts()).toThrow(/duplicate host entries/);
  });

  it("does NOT collapse an invalid list to an empty fleet — it throws", () => {
    store.set("hosts", [LOCAL]);
    // The fail-loud contract: never collapse a caught validation error to `[]`.
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
    // remote:env is a pure env seed; remote:strip was added at runtime.
    await savePoolMembership(
      [LOCAL, "remote:env", "remote:strip"],
      new Set(["remote:env"]),
    );
    expect(getPersistedHosts()).toEqual(["remote:strip"]);
  });

  it("persists a host that is BOTH an env seed and already persisted (persisted-at-boot wins)", async () => {
    // `declarativeSeedKeys` is env-MINUS-persisted-at-boot, so a host in both is NOT in it —
    // the caller's job — and therefore stays persisted. Model that here.
    await savePoolMembership(
      [LOCAL, "remote:both", "remote:strip"],
      new Set(), // remote:both was persisted-at-boot, so excluded from the seed set
    );
    expect(getPersistedHosts()).toEqual(["remote:both", "remote:strip"]);
  });

  it("replaces the stored list whole on each write (a removal shrinks it)", async () => {
    await savePoolMembership([LOCAL, "remote:a", "remote:b"], NO_SEEDS);
    await savePoolMembership([LOCAL, "remote:b"], NO_SEEDS); // a removal
    expect(getPersistedHosts()).toEqual(["remote:b"]);
  });
});

// conf's OWN fail-fast behavior on a corrupt store — the grounding for folding `hosts`
// INTO conf (rather than a separate fail-fast file): a corrupt store THROWS on read, it does
// NOT reset to defaults (`clearInvalidConfig` is false; conf 15's default). Driven against an
// ephemeral `Conf` so we exercise construction/read, not the already-loaded module store.
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
    // Reading the store surfaces conf's SyntaxError instead of a silently-emptied fleet —
    // the data loss W10 exists to prevent, which conf itself refuses to do.
    expect(() => {
      new Conf<{ hosts: string[] }>({
        cwd: dir,
        projectVersion: "1.33.0",
        defaults: { hosts: [] },
      }).get("hosts");
    }).toThrow();
  });
});

// End-to-end: the real `buildRemotePool` with `savePoolMembership` wired as its `persist`
// hook and `getPersistedHosts` as the boot seed — add/remove/restart, exactly as `index.ts`
// wires it, now through the conf store instead of a file. Proves the plan's bullets against
// the actual pool contract, not just the leaf accessors.
describe("round-trip through buildRemotePool's persist hook (conf-backed)", () => {
  // A minimal DestroyableSession — the pool only ever destroy()s it.
  const stubEntry = () => ({ session: { destroy() {} }, handler: undefined });

  it("persists add/remove and restores the fleet on restart", async () => {
    const persist = (hosts: string[]) => savePoolMembership(hosts, NO_SEEDS);

    const pool = buildRemotePool<{ destroy(): void }, undefined>({
      initialHosts: [LOCAL], // the seeded local default
      buildEntry: stubEntry,
      persist,
    });

    // Two strip adds → both remembered, local excluded.
    await pool.add("remote:a");
    await pool.add("remote:b");
    expect(getPersistedHosts()).toEqual(["remote:a", "remote:b"]);

    // A strip remove updates the store.
    await pool.remove("remote:a");
    expect(getPersistedHosts()).toEqual(["remote:b"]);

    // "Restart": a NEW pool seeded from the local default + the persisted fleet
    // (`getPersistedHosts` re-reads the SAME conf store) — exactly index.ts's boot merge.
    // The remembered host reappears as a member.
    const restored = buildRemotePool<{ destroy(): void }, undefined>({
      initialHosts: [LOCAL, ...getPersistedHosts()],
      buildEntry: stubEntry,
      persist,
    });
    expect(restored.hosts()).toEqual([LOCAL, "remote:b"]);
  });
});
