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

import { describe, expect, it } from "vitest";
import { pruneToMembers } from "./reServeEviction.ts";

// `index.ts` keys its real `reServes` cache by the pool's canonical STRING
// (`encodeHostKey`) — plain strings exercise the same key-membership logic without
// dragging in the HostKey codec.
describe("pruneToMembers", () => {
  it("drops entries whose host has left the pool, keeps members", () => {
    // Sentinel values stand in for the real `ReServedSurface` mirrors — the prune only cares
    // about key membership, never the value.
    const cache = new Map<string, string>([
      ["remote:zest", "zest-mirror"],
      ["remote:bogus", "bogus-mirror"],
    ]);

    // `remote:zest` is still a pool member; `remote:bogus` has been removed.
    const members = new Set(["remote:zest"]);
    pruneToMembers(cache, (h) => members.has(h));

    expect(cache.has("remote:bogus")).toBe(false); // the departed host's mirror is evicted…
    expect(cache.get("remote:zest")).toBe("zest-mirror"); // …the surviving member's mirror is untouched.
  });

  it("re-add after eviction is a cache MISS — the corpse can never be re-handed out", () => {
    // The flap: build a mirror for `guest` over session A, remove the host (evict), then
    // re-add the SAME key over session B. Because eviction deleted the slot, the re-add path
    // (`reServeFor`'s `reServes.get(h) === undefined`) sees a MISS and builds fresh — it can
    // never resolve to the mirror pinned to the destroyed session A.
    const cache = new Map<string, string>([
      ["remote:guest", "mirror-over-sessionA"],
    ]);

    // Host leaves the pool → eviction runs with `guest` no longer a member.
    pruneToMembers(cache, () => false);

    expect(cache.get("remote:guest")).toBeUndefined(); // MISS ⇒ the re-add would build a fresh mirror.
  });

  it("no-op when every cached host is still a member (steady state)", () => {
    const cache = new Map<string, string>([
      ["local", "local-mirror"],
      ["remote:zest", "zest-mirror"],
    ]);

    pruneToMembers(cache, () => true);

    expect(cache.size).toBe(2); // nobody left the pool, nothing evicted.
  });
});
