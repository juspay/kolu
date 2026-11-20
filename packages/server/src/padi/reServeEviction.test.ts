import { describe, expect, it, vi } from "vitest";
import { pruneToMembers } from "./reServeEviction.ts";

describe("pruneToMembers", () => {
  it("drops entries whose host has left the pool, keeps members", () => {
    const cache = new Map<string, string>([
      ["remote:zest", "zest-mirror"],
      ["remote:bogus", "bogus-mirror"],
    ]);

    const members = new Set(["remote:zest"]);
    const onEvict = vi.fn();
    pruneToMembers(cache, (h) => members.has(h), onEvict);

    expect(cache.has("remote:bogus")).toBe(false);
    expect(cache.get("remote:zest")).toBe("zest-mirror");
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith("bogus-mirror");
  });

  it("re-add after eviction is a cache MISS — the corpse can never be re-handed out", () => {
    const cache = new Map<string, string>([
      ["remote:guest", "mirror-over-sessionA"],
    ]);

    const onEvict = vi.fn();
    pruneToMembers(cache, () => false, onEvict);

    expect(cache.get("remote:guest")).toBeUndefined();
    expect(onEvict).toHaveBeenCalledExactlyOnceWith("mirror-over-sessionA");
  });

  it("no-op when every cached host is still a member (steady state)", () => {
    const cache = new Map<string, string>([
      ["local", "local-mirror"],
      ["remote:zest", "zest-mirror"],
    ]);

    const onEvict = vi.fn();
    pruneToMembers(cache, () => true, onEvict);

    expect(cache.size).toBe(2);
    expect(onEvict).not.toHaveBeenCalled();
  });

  it("cleanup is TOTAL — it fires for a removed entry whose value is `undefined`", () => {
    const cache = new Map<string, undefined>([["remote:ghost", undefined]]);
    const onEvict = vi.fn();

    pruneToMembers(cache, () => false, onEvict);

    expect(cache.has("remote:ghost")).toBe(false);
    expect(onEvict).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
