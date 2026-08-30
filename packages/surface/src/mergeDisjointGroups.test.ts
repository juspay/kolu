/**
 * `mergeDisjointGroups` — the counted merge, and the failure it exists to make
 * loud.
 *
 * `RpcGroup.merge` is a last-writer-wins `Map.set` with no collision detection,
 * so the only thing separating "two halves multiplexed on one wire" from "one
 * member silently answering under another's schema" is a proof somebody has to
 * run. It was run in five private spellings before this export existed
 * (`connectSurfaces`' `extraGroups` fold, kolu-server's `servedGroup`,
 * kolu-common's `contract`, kaval's daemon group, and — one repo over — olai's
 * `fuseGroups`); what is pinned here is the one that replaced them: the count,
 * and the report that names WHICH two of the caller's halves claimed the tag.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  composeSurfaceContracts,
  defineSurface,
  mergeDisjointGroups,
} from "./define";

const stateSurface = () =>
  defineSurface({
    cells: { state: { schema: Schema.String, default: "s" } },
  });

describe("mergeDisjointGroups", () => {
  it("merges disjoint halves and carries every tag", () => {
    const root = stateSurface();
    const siblings = composeSurfaceContracts({ left: stateSurface() });
    const merged = mergeDisjointGroups({
      core: root.group,
      siblings: siblings.group,
    });
    expect(merged.requests.size).toBe(
      root.group.requests.size + siblings.group.requests.size,
    );
    // The root keeps the BARE tags and the sibling the prefixed ones — the
    // rooted bundle's whole shape, in one group.
    expect([...merged.requests.keys()]).toEqual(
      expect.arrayContaining([
        "surface/state/get",
        "surface/system/live",
        "surface/left/state/get",
        "surface/left/system/live",
      ]),
    );
  });

  it("throws on a collision, naming the tag AND both halves that claimed it", () => {
    // Two STANDALONE surfaces on one wire is the collision the framework's tag
    // algebra exists to prevent: every surface carries the same three reserved
    // `system/*` members, so a bare merge keeps one copy and drops the other's —
    // and every `state/get` call would then reach whichever half merged last.
    const call = () =>
      mergeDisjointGroups({
        left: stateSurface().group,
        right: stateSurface().group,
      });
    expect(call).toThrow(/surface\/system\/live/);
    expect(call).toThrow(/claimed by "left" and "right"/);
    // The report is per TAG, not a total that came up short: five members
    // collide (the cell's `get`/`set` and the three reserved `system/*`), and it
    // names each one.
    expect(call).toThrow(/5 wire tag\(s\) are carried by more than one group/);
    expect(call).toThrow(/surface\/state\/get/);
  });

  it("refuses a merge of nothing", () => {
    // An empty merge would hand back a group that advertises no tag at all — a
    // wire that connects and can dial nothing. Never what a caller means, so it
    // is a crash rather than an empty default.
    expect(() => mergeDisjointGroups({})).toThrow(/no groups were passed/);
  });

  it("is a no-op over ONE half", () => {
    // The degenerate case a rooted bundle actually reaches: a wire whose sibling
    // map is empty this run carries only the root.
    const root = stateSurface();
    const merged = mergeDisjointGroups({ core: root.group });
    expect([...merged.requests.keys()].sort()).toEqual(
      [...root.group.requests.keys()].sort(),
    );
  });
});
