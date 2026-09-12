import { Effect, Schema, Stream } from "effect";
import { createRoot } from "solid-js";
import { expect, it } from "vitest";
import {
  collectionDeltasSchema,
  defineSurface,
  type CollectionDeltasMsg,
} from "../define";
import type { SurfaceDispatch } from "../link";
import { controllableStream } from "./controllableStream.testlib";
import { settle } from "./deltasHarness.testlib";
import { surfaceClient } from "./surfaceClient";

const row = Schema.Struct({ text: Schema.String });
const surface = defineSurface({
  collections: {
    rows: { keySchema: Schema.String, schema: row, verbs: ["deltas"] },
  },
  streams: {
    conversation: {
      inputSchema: Schema.Struct({
        agent: Schema.String,
        session: Schema.String,
      }),
      outputSchema: collectionDeltasSchema(Schema.String, row),
    },
    prose: { inputSchema: Schema.String, outputSchema: Schema.String },
  },
});
type Frame = CollectionDeltasMsg<string, { readonly text: string }>;

it("shares equal stream keys, isolates other keys, folds frames, and releases the last owner's wire and health", async () => {
  const sources = new Map<
    string,
    ReturnType<typeof controllableStream<Frame>>
  >();
  const opened: string[] = [];
  const closed: string[] = [];
  const dispatch: SurfaceDispatch = {
    unary: () => Effect.fail(new Error("no unary expected")),
    stream: (tag, input) =>
      Stream.suspend(() => {
        expect(tag).toBe("surface/conversation/get");
        const session = (input as { session: string }).session;
        opened.push(session);
        const source = controllableStream<Frame>();
        sources.set(session, source);
        return Stream.ensuring(
          source.source,
          Effect.sync(() => {
            closed.push(session);
          }),
        );
      }),
  };
  const owner = createRoot((dispose) => {
    const app = surfaceClient(surface, dispatch);
    const mount = (session: string, reverse = false) =>
      createRoot((stop) => ({
        stop,
        view: app.streams.conversation.useCollection(
          reverse ? { session, agent: "one" } : { agent: "one", session },
          surface.descriptors.collections.rows,
        ),
      }));
    return { dispose, app, mount };
  });
  try {
    const first = owner.mount("a");
    const twin = owner.mount("a", true);
    const other = owner.mount("b");
    await settle();
    expect(opened.sort()).toEqual(["a", "b"]);
    expect(owner.app.health().subs).toHaveLength(2);
    sources
      .get("a")!
      .push({ kind: "snapshot", entries: [["row", { text: "first" }]] });
    sources
      .get("b")!
      .push({ kind: "snapshot", entries: [["row", { text: "other" }]] });
    await settle();
    expect(first.view.byKey("row")?.()).toEqual({ text: "first" });
    expect(twin.view.byKey("row")?.()).toEqual({ text: "first" });
    expect(other.view.byKey("row")?.()).toEqual({ text: "other" });
    first.stop();
    await settle();
    expect(closed).toEqual([]);
    sources.get("a")!.push({
      kind: "delta",
      upserts: [["row", { text: "changed" }]],
      removes: [],
    });
    await settle();
    expect(twin.view.byKey("row")?.()).toEqual({ text: "changed" });
    twin.stop();
    await settle();
    expect(closed).toEqual(["a"]);
    expect(owner.app.health().subs).toHaveLength(1);
    other.stop();
    await settle();
    expect(closed.sort()).toEqual(["a", "b"]);
    expect(owner.app.health().subs).toHaveLength(0);
    const reopened = owner.mount("a");
    await settle();
    expect(opened).toHaveLength(3);
    expect(reopened.view.byKey("row")).toBeUndefined();
    reopened.stop();
  } finally {
    owner.dispose();
  }
});

it("only permits collection-shaped output at the type boundary", () => {
  const check = (
    app: ReturnType<typeof surfaceClient<typeof surface.spec>>,
  ) => {
    // @ts-expect-error prose frames cannot be folded as collection deltas
    app.streams.prose.useCollection("a", surface.descriptors.collections.rows);
  };
  expect(typeof check).toBe("function");
});
