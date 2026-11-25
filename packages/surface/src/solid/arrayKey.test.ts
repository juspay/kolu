/**
 * The DECLARATION's journey: `spec → descriptor → bound hook → store merge`.
 *
 * `writeValue.test.ts` pins what a declared key does at the merge, and
 * `writeValue.identity.test.tsx` pins what that does to the DOM. Neither would
 * notice if the declaration never arrived — if `defineSurface` dropped it off the
 * descriptor, or `useStream` / `useCell` read it from the wrong place, both suites
 * would stay green over a framework that always merges unkeyed. This file drives
 * the whole path, from a spec literal to the objects standing in a bound store.
 *
 * It also pins the negative half, which is the part a refactor breaks silently: a
 * member that declares NOTHING must still be merged unkeyed, elements replaced.
 */

import { Effect, Schema, Stream } from "effect";
import { createEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { defineSurface } from "../define";
import type { SurfaceDispatch } from "../link";
import { controllableStream } from "./controllableStream.testlib";
import { surfaceClient } from "./surfaceClient";

const Row = Schema.Struct({
  key: Schema.String,
  node: Schema.Struct({ id: Schema.String, title: Schema.String }),
});
const Reading = Schema.Struct({ rows: Schema.Array(Row) });
type Reading = typeof Reading.Type;

const surface = defineSurface({
  cells: {
    /** A cell that DECLARES what identifies a row. */
    shelf: {
      schema: Reading,
      default: { rows: [] },
      verbs: ["get"],
      arrayKey: "key",
    },
    /** The contrast: same shape, no declaration. */
    plain: {
      schema: Reading,
      default: { rows: [] },
      verbs: ["get"],
    },
  },
  collections: {
    /** A collection whose ENTRY VALUE carries rows. Its per-key delivery merges
     *  that value through the same seam a cell's goes through, so it declares the
     *  same thing. No `deltas` verb, so `.use()` is the per-key path. */
    boards: {
      keySchema: Schema.String,
      schema: Reading,
      verbs: ["keys", "get"],
      arrayKey: "key",
    },
  },
  streams: {
    /** The member the downstream report is about: one page, re-answered per
     *  revision, rows identified by `key`. */
    page: {
      inputSchema: Schema.Struct({ file: Schema.String }),
      outputSchema: Reading,
      arrayKey: "key",
    },
    plainPage: {
      inputSchema: Schema.Struct({ file: Schema.String }),
      outputSchema: Reading,
    },
  },
});

const readingOf = (keys: readonly string[]): Reading => ({
  rows: keys.map((k) => ({ key: k, node: { id: k, title: `title of ${k}` } })),
});

/** Frames wait on a real fiber, so a micro-flush is not enough — two macrotask
 *  turns, the same margin `createSubscription.test.ts` uses. */
async function settle(ticks = 2): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** Observe every row of a member's value, the way a rendered list does. A merge
 *  preserves a row's STORE IDENTITY (its proxy — the raw is always the newest
 *  frame, since a merge adopts rather than mutates) only where a node lives
 *  below that row: `@solidjs/signals` 2.0.4 `dist/dev.js` `descend` :6809 skips a
 *  child nothing is watching, so an unobserved row is replaced whatever the key
 *  says. Returns the disposer for the observing root. */
function watchRows(read: () => Reading | undefined): () => void {
  return createRoot((dispose) => {
    createEffect(
      () => (read()?.rows ?? []).map((r) => r.node.title).join("\u0000"),
      () => {},
    );
    return dispose;
  });
}

/** The rows as the store serves them — proxies, which is what a consumer holds
 *  and therefore what "the same row" means across frames. */
const rowsOf = (value: unknown): Reading["rows"] => [
  ...(value as Reading).rows,
];

/** A dispatch serving each member from its own controllable stream, so a test
 *  pushes the frames itself. */
function stubDispatch() {
  const feeds = new Map<
    string,
    ReturnType<typeof controllableStream<Reading>>
  >();
  const feed = (tag: string) => {
    const held = feeds.get(tag);
    if (held) return held;
    const fresh = controllableStream<Reading>();
    feeds.set(tag, fresh);
    return fresh;
  };
  const dispatch: SurfaceDispatch = {
    unary: (tag) => Effect.fail(new Error(`no member served at "${tag}"`)),
    stream: (tag) =>
      // The collection's `keys` stream answers a fixed one-key set; every other
      // tag is a per-member value feed the test pushes into.
      tag === "surface/boards/keys"
        ? (Stream.make(["b1"]) as unknown as Stream.Stream<Reading, unknown>)
        : Stream.suspend(() => feed(tag).source),
  };
  return { dispatch, feed };
}

describe("a declared arrayKey reaches the store it is declared for", () => {
  it("rides the descriptor `defineSurface` mints", () => {
    // The one hop nothing else observes: a spec field that never reaches the
    // descriptor is a declaration the hooks can't read.
    expect(surface.descriptors.cells.shelf.arrayKey).toBe("key");
    expect(surface.descriptors.cells.plain.arrayKey).toBeUndefined();
    expect(surface.descriptors.streams.page.arrayKey).toBe("key");
    expect(surface.descriptors.streams.plainPage.arrayKey).toBeUndefined();
    expect(surface.descriptors.collections.boards.arrayKey).toBe("key");
  });

  it("governs a COLLECTION's PER-KEY merge — the seam a cell's value goes through", async () => {
    // The path lowy's review found the first cut had foreclosed: an entry's value
    // is merged by `createSubscription`/`writeWrappedValue`, exactly as a cell's
    // is, so the same declaration governs it. (The batched `deltas` path merges
    // each named entry through `writeEntryValue` under the same declaration —
    // see `CollectionSpec.arrayKey`.)
    const { dispatch, feed } = stubDispatch();
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      const boards = app.collections.boards.use();
      await settle();
      const value = boards.byKey("b1");
      if (value === undefined) throw new Error("no per-key subscription");
      feed("surface/boards/get").push(readingOf(["a", "b"]));
      await settle();
      const stop = watchRows(() => value() as Reading | undefined);
      await settle();
      const first = rowsOf(value());
      feed("surface/boards/get").push(readingOf(["a", "b"]));
      await settle();
      const second = rowsOf(value());
      expect(second[0]).toBe(first[0]);
      expect(second[1]).toBe(first[1]);
      stop();
      dispose();
    });
  });

  it("governs a STREAM's merge — a repeated frame keeps every row object", async () => {
    const { dispatch, feed } = stubDispatch();
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      const sub = app.streams.page.use(() => ({ file: "a.md" }));
      await settle();
      feed("surface/page/get").push(readingOf(["a", "b", "c"]));
      await settle();
      const stop = watchRows(() => sub() as Reading | undefined);
      await settle();
      const first = rowsOf(sub());
      feed("surface/page/get").push(readingOf(["a", "b", "c"]));
      await settle();
      const second = rowsOf(sub());
      expect(second[0]).toBe(first[0]);
      expect(second[1]).toBe(first[1]);
      expect(second[2]).toBe(first[2]);
      stop();
      dispose();
    });
  });

  it("a stream that declares NOTHING still replaces every row", async () => {
    const { dispatch, feed } = stubDispatch();
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      const sub = app.streams.plainPage.use(() => ({ file: "a.md" }));
      await settle();
      feed("surface/plainPage/get").push(readingOf(["a", "b"]));
      await settle();
      const stop = watchRows(() => sub() as Reading | undefined);
      await settle();
      const first = rowsOf(sub());
      feed("surface/plainPage/get").push(readingOf(["a", "b"]));
      await settle();
      const second = rowsOf(sub());
      expect(second[0]).not.toBe(first[0]);
      expect(second[1]).not.toBe(first[1]);
      stop();
      dispose();
    });
  });

  it("governs a CELL's merge too, and only where declared", async () => {
    const { dispatch, feed } = stubDispatch();
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      const shelf = app.cells.shelf.use();
      const plain = app.cells.plain.use();
      await settle();
      feed("surface/shelf/get").push(readingOf(["a", "b"]));
      feed("surface/plain/get").push(readingOf(["a", "b"]));
      await settle();
      const stopShelf = watchRows(() => shelf.value() as Reading | undefined);
      const stopPlain = watchRows(() => plain.value() as Reading | undefined);
      await settle();
      const shelfFirst = rowsOf(shelf.value());
      const plainFirst = rowsOf(plain.value());
      feed("surface/shelf/get").push(readingOf(["a", "b"]));
      feed("surface/plain/get").push(readingOf(["a", "b"]));
      await settle();
      const shelfSecond = rowsOf(shelf.value());
      const plainSecond = rowsOf(plain.value());
      expect(shelfSecond[0]).toBe(shelfFirst[0]);
      expect(plainSecond[0]).not.toBe(plainFirst[0]);
      stopShelf();
      stopPlain();
      dispose();
    });
  });
});
