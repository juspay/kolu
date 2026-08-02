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

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  collectionDeltasChannel,
  collectionKeyChannel,
  collectionKeysetChannel,
} from "./channelNames";
import type { CollectionDelta } from "./define";
import { defineSurface } from "./define";
import { flush, subscribeMember } from "./handlerDispatch.testlib";
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

function serveStringKeyedItems() {
  const surface = defineSurface({
    collections: {
      items: {
        keySchema: Schema.String,
        schema: Schema.Struct({ name: Schema.String }),
        verbs: ["keys", "get", "upsert", "delete", "deltas"],
      },
    },
  });
  const items = new Map<string, { name: string }>();
  const { handlers, ctx } = implementSurface(surface, {
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
  return { handlers, ctx };
}

describe('a collection member key literally "keys"/"deltas" does not cross-wire (#1715)', () => {
  it('a key "keys": the per-key value stream and the keyset stream stay independent', async () => {
    const { handlers, ctx } = serveStringKeyedItems();

    const keys = subscribeMember<readonly string[]>(
      handlers,
      "surface/items/keys",
    );
    const values = subscribeMember<{ name: string }>(
      handlers,
      "surface/items/get",
      { key: "keys" },
    );

    await flush();

    ctx.collections.items.upsert("keys", { name: "member named keys" });
    await flush();

    // The per-key value stream for key "keys" delivers ITS value — not a key-set
    // array, which is what the pre-fix aliased channel would have delivered.
    expect(values.seen.at(-1)).toEqual({ name: "member named keys" });
    // The keyset stream reports "keys" as an ordinary MEMBER — not corrupted by
    // the per-key value publish landing on the same channel.
    expect(keys.seen.at(-1)).toEqual(["keys"]);

    await keys.stop();
    await values.stop();
  });

  it('a key "deltas": the per-key value stream and the batched deltas stream stay independent', async () => {
    const { handlers, ctx } = serveStringKeyedItems();

    const deltas = subscribeMember(handlers, "surface/items/deltas");
    const values = subscribeMember<{ name: string }>(
      handlers,
      "surface/items/get",
      { key: "deltas" },
    );

    await flush();

    ctx.collections.items.upsert("deltas", { name: "member named deltas" });
    await flush();

    // The per-key value stream for key "deltas" delivers ITS value — not a
    // `{kind, upserts, removes}` delta frame, which is what the pre-fix aliased
    // channel would have delivered.
    expect(values.seen.at(-1)).toEqual({ name: "member named deltas" });
    // The batched deltas stream reports an ordinary delta for key "deltas" — its
    // own coalesced frame, uncorrupted by the per-key value publish.
    const last = deltas.seen.at(-1) as CollectionDelta<
      string,
      { name: string }
    >;
    expect(last.kind).toBe("delta");
    expect(last.upserts).toEqual([["deltas", { name: "member named deltas" }]]);
    expect(last.removes).toEqual([]);

    await deltas.stop();
    await values.stop();
  });
});
