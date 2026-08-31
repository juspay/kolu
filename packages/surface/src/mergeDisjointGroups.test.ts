/**
 * `mergeDisjointGroups` — the counted merge, and the failure it exists to make
 * loud.
 *
 * `RpcGroup.merge` is a last-writer-wins `Map.set` with no collision detection,
 * so the only thing separating "two halves multiplexed on one wire" from "one
 * member silently answering under another's schema" is a proof somebody has to
 * run. The private spellings it replaced are enumerated on `mergeDisjointGroups`
 * itself — ONE place to update when the next one is found, rather than a second
 * inventory here that had already drifted from that one before this file was a day
 * old. What is pinned HERE is the proof they all needed: the count, and the report
 * that names WHICH two of the caller's halves claimed the tag.
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

  it("merges NOTHING into the empty group — the identity, not a refusal", () => {
    // A composer whose input map is empty this run legitimately produces one:
    // `composeSurfaceContracts({})` is how a rooted wire with no siblings spells
    // its sibling half, and this function is what assembles it. Refusing zero
    // halves here would make that ordinary wire unspellable — the empty group is
    // the honest answer, and the halves that carry tags are still counted.
    expect(mergeDisjointGroups({}).requests.size).toBe(0);
    expect(composeSurfaceContracts({}).group.requests.size).toBe(0);
    // …and an empty HALF beside a real one is the same fact one level up — the
    // root-only wire's exact shape, whether the empty sibling map is spelled as a
    // composed group or left out entirely. Both give back the root's tags and
    // nothing else.
    const root = stateSurface();
    const shapes: Array<Record<string, typeof root.group>> = [
      { core: root.group, siblings: composeSurfaceContracts({}).group },
      { core: root.group },
    ];
    for (const halves of shapes) {
      expect([...mergeDisjointGroups(halves).requests.keys()].sort()).toEqual(
        [...root.group.requests.keys()].sort(),
      );
    }
  });
});
