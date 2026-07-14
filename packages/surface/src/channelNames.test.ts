/**
 * juspay/kolu#1715 — the collision this module's helpers exist to make
 * STRUCTURALLY IMPOSSIBLE: a collection's per-key value channel used to mint
 * as `${name}:${String(k)}` (see git history), so a member key literally
 * equal to `"keys"` or `"deltas"` aliased the collection's own reserved
 * `${name}:keys` / `${name}:deltas` channel — the in-memory channel registry
 * dedups topics BY NAME, so that key's per-key value stream and the
 * membership/deltas stream were the SAME channel, cross-wired.
 *
 * The fix namespaces every per-key channel with a `key:` segment
 * (`${name}:key:${k}`) that neither fixed channel carries, so no key string
 * can ever produce a per-key channel equal to a fixed one. This file pins
 * both halves: the pure string-building invariant, and the end-to-end
 * behavior (mint + subscribe over a REAL served collection) for a key
 * literally named "keys" and one literally named "deltas".
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  collectionDeltasChannel,
  collectionKeyChannel,
  collectionKeysetChannel,
} from "./channelNames";
import type { CollectionDelta } from "./define";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import { implementSurface } from "./server";

describe("channel-name helpers — pure string output", () => {
  it("mints the two fixed channels and a key:-namespaced per-key channel", () => {
    expect(collectionKeysetChannel("items")).toBe("items:keys");
    expect(collectionDeltasChannel("items")).toBe("items:deltas");
    expect(collectionKeyChannel("items", "n1")).toBe("items:key:n1");
  });

  it("a per-key channel for ANY key string can never equal a fixed channel", () => {
    for (const k of ["keys", "deltas", "key", "", "keys:deltas", "changed"]) {
      const perKey = collectionKeyChannel("items", k);
      expect(perKey).not.toBe(collectionKeysetChannel("items"));
      expect(perKey).not.toBe(collectionDeltasChannel("items"));
    }
  });
});

// ── End-to-end: a served collection with a member key "keys" / "deltas" ────

const flush = () => new Promise((r) => setTimeout(r, 0));

function serveStringKeyedItems() {
  const surface = defineSurface({
    collections: {
      items: {
        keySchema: z.string(),
        schema: z.object({ name: z.string() }),
        verbs: ["keys", "get", "upsert", "delete", "deltas"],
      },
    },
  });
  const items = new Map<string, { name: string }>();
  const { router, ctx } = implementSurface(surface, {
    collections: {
      items: {
        readAll: () => items,
        upsert: (k, v) => {
          items.set(k, v);
        },
        remove: (k) => {
          items.delete(k);
        },
      },
    },
  });
  const wrapped = router;
  const client = directLink<typeof surface.contract>(wrapped as never);
  return { client, ctx };
}

describe('a collection member key literally "keys"/"deltas" does not cross-wire (#1715)', () => {
  it('a key "keys": the per-key value stream and the keyset stream stay independent', async () => {
    const { client, ctx } = serveStringKeyedItems();

    const keysSeen: string[][] = [];
    const keysAc = new AbortController();
    const keysDone = (async () => {
      const stream = await client.surface.items.keys(
        {},
        { signal: keysAc.signal },
      );
      for await (const ks of stream) keysSeen.push([...ks]);
    })().catch((e) => {
      if (!keysAc.signal.aborted) throw e;
    });

    const valuesSeen: Array<{ name: string }> = [];
    const valueAc = new AbortController();
    const valueDone = (async () => {
      const stream = await client.surface.items.get(
        { key: "keys" },
        { signal: valueAc.signal },
      );
      for await (const v of stream) valuesSeen.push(v);
    })().catch((e) => {
      if (!valueAc.signal.aborted) throw e;
    });

    await flush();

    ctx.collections.items.upsert("keys", { name: "member named keys" });
    await flush();

    // The per-key value stream for key "keys" delivers ITS value — not a key-set
    // array, which is what the pre-fix aliased channel would have delivered.
    expect(valuesSeen.at(-1)).toEqual({ name: "member named keys" });
    // The keyset stream reports "keys" as an ordinary MEMBER — not corrupted by
    // the per-key value publish landing on the same channel.
    expect(keysSeen.at(-1)).toEqual(["keys"]);

    keysAc.abort();
    valueAc.abort();
    await keysDone;
    await valueDone;
  });

  it('a key "deltas": the per-key value stream and the batched deltas stream stay independent', async () => {
    const { client, ctx } = serveStringKeyedItems();

    const deltaFrames: unknown[] = [];
    const deltasAc = new AbortController();
    const deltasDone = (async () => {
      const stream = await client.surface.items.deltas(
        {},
        { signal: deltasAc.signal },
      );
      for await (const f of stream) deltaFrames.push(f);
    })().catch((e) => {
      if (!deltasAc.signal.aborted) throw e;
    });

    const valuesSeen: Array<{ name: string }> = [];
    const valueAc = new AbortController();
    const valueDone = (async () => {
      const stream = await client.surface.items.get(
        { key: "deltas" },
        { signal: valueAc.signal },
      );
      for await (const v of stream) valuesSeen.push(v);
    })().catch((e) => {
      if (!valueAc.signal.aborted) throw e;
    });

    await flush();

    ctx.collections.items.upsert("deltas", { name: "member named deltas" });
    await flush();

    // The per-key value stream for key "deltas" delivers ITS value — not a
    // `{kind, upserts, removes}` delta frame, which is what the pre-fix aliased
    // channel would have delivered.
    expect(valuesSeen.at(-1)).toEqual({ name: "member named deltas" });
    // The batched deltas stream reports an ordinary delta for key "deltas" — its
    // own coalesced frame, uncorrupted by the per-key value publish.
    const last = deltaFrames.at(-1) as CollectionDelta<
      string,
      { name: string }
    >;
    expect(last.kind).toBe("delta");
    expect(last.upserts).toEqual([["deltas", { name: "member named deltas" }]]);
    expect(last.removes).toEqual([]);

    deltasAc.abort();
    valueAc.abort();
    await deltasDone;
    await valueDone;
  });
});
