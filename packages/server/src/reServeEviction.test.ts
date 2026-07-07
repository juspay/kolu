/**
 * D2 pin — the stale-reserve-on-flap eviction (relocated out of the map layer into
 * kolu-server's own mirror cache). A guest host that leaves the pool must have its cached
 * re-serve mirror dropped, so a remove→re-add of the SAME key builds a FRESH mirror over the
 * new session rather than reusing the dead one pinned to the destroyed session (#1708).
 *
 * `pruneToMembers` is the body wired to `pool.subscribe` in `index.ts`; testing it directly
 * pins the eviction wiring (drop non-members, keep members) without booting the whole server.
 * The remove→re-add → fresh-mirror behaviour then follows from this eviction (the slot is
 * gone) composed with `reServeFor`'s build-on-cache-miss (`if (r === undefined) build`).
 */

import { HostKeySchema } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import { pruneToMembers } from "./reServeEviction.ts";

const key = (s: string) => HostKeySchema.parse(s);

describe("pruneToMembers", () => {
  it("drops entries whose host has left the pool, keeps members", () => {
    // Sentinel values stand in for the real `ReServedSurface` mirrors — the prune only cares
    // about key membership, never the value.
    const zest = key("zest");
    const bogus = key("bogus");
    const cache = new Map<ReturnType<typeof key>, string>([
      [zest, "zest-mirror"],
      [bogus, "bogus-mirror"],
    ]);

    // `zest` is still a pool member; `bogus` has been removed.
    const members = new Set([zest]);
    pruneToMembers(cache, (h) => members.has(h));

    expect(cache.has(bogus)).toBe(false); // the departed host's mirror is evicted…
    expect(cache.get(zest)).toBe("zest-mirror"); // …the surviving member's mirror is untouched.
  });

  it("re-add after eviction is a cache MISS — the corpse can never be re-handed out", () => {
    // The flap: build a mirror for `guest` over session A, remove the host (evict), then
    // re-add the SAME key over session B. Because eviction deleted the slot, the re-add path
    // (`reServeFor`'s `reServes.get(h) === undefined`) sees a MISS and builds fresh — it can
    // never resolve to the mirror pinned to the destroyed session A.
    const guest = key("guest");
    const cache = new Map<ReturnType<typeof key>, string>([
      [guest, "mirror-over-sessionA"],
    ]);

    // Host leaves the pool → eviction runs with `guest` no longer a member.
    pruneToMembers(cache, () => false);

    expect(cache.get(guest)).toBeUndefined(); // MISS ⇒ the re-add would build a fresh mirror.
  });

  it("no-op when every cached host is still a member (steady state)", () => {
    const local = key("local");
    const zest = key("zest");
    const cache = new Map<ReturnType<typeof key>, string>([
      [local, "local-mirror"],
      [zest, "zest-mirror"],
    ]);

    pruneToMembers(cache, () => true);

    expect(cache.size).toBe(2); // nobody left the pool, nothing evicted.
  });
});
