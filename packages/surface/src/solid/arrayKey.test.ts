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
import { createRoot } from "solid-js";
import { unwrap } from "solid-js/store";
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
async function flush(ticks = 2): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

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
    stream: (tag) => Stream.suspend(() => feed(tag).source),
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
  });

  it("governs a STREAM's merge — a repeated frame keeps every row object", async () => {
    const { dispatch, feed } = stubDispatch();
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      const sub = app.streams.page.use(() => ({ file: "a.md" }));
      await flush();
      feed("surface/page/get").push(readingOf(["a", "b", "c"]));
      await flush();
      const first = [...(unwrap(sub()) as Reading).rows];
      feed("surface/page/get").push(readingOf(["a", "b", "c"]));
      await flush();
      const second = [...(unwrap(sub()) as Reading).rows];
      expect(second[0]).toBe(first[0]);
      expect(second[1]).toBe(first[1]);
      expect(second[2]).toBe(first[2]);
      dispose();
    });
  });

  it("a stream that declares NOTHING still replaces every row", async () => {
    const { dispatch, feed } = stubDispatch();
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      const sub = app.streams.plainPage.use(() => ({ file: "a.md" }));
      await flush();
      feed("surface/plainPage/get").push(readingOf(["a", "b"]));
      await flush();
      const first = [...(unwrap(sub()) as Reading).rows];
      feed("surface/plainPage/get").push(readingOf(["a", "b"]));
      await flush();
      const second = [...(unwrap(sub()) as Reading).rows];
      expect(second[0]).not.toBe(first[0]);
      expect(second[1]).not.toBe(first[1]);
      dispose();
    });
  });

  it("governs a CELL's merge too, and only where declared", async () => {
    const { dispatch, feed } = stubDispatch();
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      const shelf = app.cells.shelf.use();
      const plain = app.cells.plain.use();
      await flush();
      feed("surface/shelf/get").push(readingOf(["a", "b"]));
      feed("surface/plain/get").push(readingOf(["a", "b"]));
      await flush();
      const shelfFirst = [...(unwrap(shelf.value()) as Reading).rows];
      const plainFirst = [...(unwrap(plain.value()) as Reading).rows];
      feed("surface/shelf/get").push(readingOf(["a", "b"]));
      feed("surface/plain/get").push(readingOf(["a", "b"]));
      await flush();
      const shelfSecond = [...(unwrap(shelf.value()) as Reading).rows];
      const plainSecond = [...(unwrap(plain.value()) as Reading).rows];
      expect(shelfSecond[0]).toBe(shelfFirst[0]);
      expect(plainSecond[0]).not.toBe(plainFirst[0]);
      dispose();
    });
  });
});
