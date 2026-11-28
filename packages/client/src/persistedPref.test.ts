import type { HostKey } from "kolu-common/hostKey";
import { createRoot, flush } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { perHostPref, persistedPref, readWithFallback } from "./persistedPref";

/** `readWithFallback` is the validation/fallback core every `persistedPref`
 *  call site runs on read. These tests pin the two latent bugs the migration
 *  closes — a `NaN` font size and a `"false"`-reads-truthy maximized flag —
 *  plus the generic corrupt-entry-degrades-to-default contract. */
describe("readWithFallback", () => {
  it("returns the parsed value when parse succeeds", () => {
    expect(readWithFallback("rail", (r) => r, "cards")).toBe("rail");
  });

  it("substitutes the fallback and reports when parse throws", () => {
    const onInvalid = vi.fn();
    const result = readWithFallback(
      "{bad json",
      (raw) => JSON.parse(raw) as unknown,
      { v: 1 },
      onInvalid,
    );
    expect(result).toEqual({ v: 1 });
    expect(onInvalid).toHaveBeenCalledOnce();
    expect(onInvalid.mock.calls[0]?.[1]).toBe("{bad json");
  });

  it("rejects a non-finite number — the font-size NaN guard", () => {
    const parseFontSize = (raw: string): number => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0)
        throw new Error(`invalid font size: ${raw}`);
      return n;
    };
    expect(readWithFallback("NaN", parseFontSize, 14)).toBe(14);
    expect(readWithFallback("garbage", parseFontSize, 14)).toBe(14);
    expect(readWithFallback("0", parseFontSize, 14)).toBe(14);
    expect(readWithFallback("18", parseFontSize, 14)).toBe(18);
  });

  it("reads a stored boolean strictly — the maximized 'false'-is-true guard", () => {
    const parseBool = (raw: string): boolean => raw === "true";
    expect(readWithFallback("false", parseBool, false)).toBe(false);
    expect(readWithFallback("true", parseBool, false)).toBe(true);
    // Anything that isn't exactly "true" is false — no truthy-string leak.
    expect(readWithFallback("1", parseBool, false)).toBe(false);
  });

  it("does not call onInvalid on the happy path", () => {
    const onInvalid = vi.fn();
    readWithFallback("24h", (r) => r, "24h", onInvalid);
    expect(onInvalid).not.toHaveBeenCalled();
  });
});

/** A minimal synchronous in-memory `Storage` — enough for `makePersisted` to read
 *  and write, and for the eviction assertion to observe a removal. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      m.delete(k);
    },
    setItem: (k, v) => {
      m.set(k, v);
    },
  };
}

const LOCAL: HostKey = { kind: "local" };

/** The two guarantees `perHostPref` centralizes beyond `persistedPref`: it evicts its
 *  per-host key on owner disposal (host-pool exit), and it fails fast when called with
 *  no owner to register that eviction against. */
describe("perHostPref", () => {
  beforeEach(() => localStorage.clear());

  it("evicts from the SAME injected storage on dispose — never the global localStorage", () => {
    const fake = fakeStorage();
    // A decoy real-localStorage key of the SAME composed name: the old cleanup deleted
    // THIS instead of the fake's key, so the assertion below is falsifiable.
    localStorage.setItem("kolu-x:local", "GLOBAL-DECOY");
    // The write happens OUTSIDE the creating scope: a setter call in a
    // `createRoot` body is a write in an owned scope, which Solid 2 rejects.
    const [dispose, setV] = createRoot((d) => {
      const [, set] = perHostPref<boolean>({
        host: LOCAL,
        base: "kolu-x",
        fallback: false,
        parse: (r) => r === "true",
        storage: fake,
      });
      return [d, set] as const;
    });
    setV(true);
    expect(fake.getItem("kolu-x:local")).toBe("true");
    dispose();
    // Evicted from the fake it wrote to…
    expect(fake.getItem("kolu-x:local")).toBeNull();
    // …and the unrelated global key of the same name is left untouched.
    expect(localStorage.getItem("kolu-x:local")).toBe("GLOBAL-DECOY");
  });

  it("throws when called outside a reactive owner (the eviction guarantee is enforced, not just documented)", () => {
    expect(() =>
      perHostPref<boolean>({
        host: LOCAL,
        base: "kolu-x",
        fallback: false,
        parse: (r) => r === "true",
      }),
    ).toThrow(/reactive owner/);
  });
});

/** The #1137 case: a pref CONSTRUCTED under a reactive owner, over storage that
 *  already holds a value. `makePersisted` hydrates by writing the stored value
 *  back into the signal, and that write runs while the constructing owner is
 *  still current — which Solid 2 rejects as `REACTIVE_WRITE_IN_OWNED_SCOPE`
 *  unless the library detaches it. `@solid-primitives/storage` 5.0.1 wraps the
 *  hydration write in `runWithOwner(null, …)`; 5.0.0 did not, and this throws
 *  there. Every per-host pref is built under an owner, so this is the shape the
 *  app runs, and the reason the version floor exists. */
describe("persistedPref under an owner", () => {
  it("hydrates from stored data when constructed inside createRoot", () => {
    const fake = fakeStorage();
    fake.setItem("kolu-hydrate", "true");
    const [dispose, value, loaded] = createRoot((d) => {
      const [read, , loadedValue] = persistedPref<boolean>({
        name: "kolu-hydrate",
        fallback: false,
        parse: (raw) => raw === "true",
        storage: fake,
      });
      return [d, read, loadedValue] as const;
    });
    // The hydration write lands on the flush after construction.
    flush();
    expect(value()).toBe(true);
    expect(loaded).toBe(true);
    dispose();
  });
});
