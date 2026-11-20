import {
  isDeadTransportError,
  isSurfaceRelayTransportLost,
  MapKeyUnknown,
  SurfaceStdioTransportClosed,
} from "@kolu/surface/errors";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { entryDispatch } from "./entryDispatch.ts";

function named(name: string): SurfaceDispatch & { tags: string[] } {
  const tags: string[] = [];
  return {
    tags,
    unary: (tag) => {
      tags.push(tag);
      return Effect.succeed(name);
    },
    stream: (tag) => {
      tags.push(tag);
      return Stream.make(name);
    },
  };
}

const SIBLINGS = ["surface/odu/"];

describe("entryDispatch", () => {
  it("serves an entry member from the mirror and forwards a sibling's", async () => {
    const mirror = named("mirror");
    const link = named("link");
    const dispatch = entryDispatch({
      siblingTagPrefixes: SIBLINGS,
      mirror,
      link: () => link,
      host: "local",
    });

    expect(
      await Effect.runPromise(dispatch.unary("surface/terminal/list", {})),
    ).toBe("mirror");
    expect(
      await Effect.runPromise(
        Stream.runCollect(dispatch.stream("surface/odu/checkout/get", {})),
      ).then((c) => [...c]),
    ).toEqual(["link"]);

    expect(link.tags).toEqual(["surface/odu/checkout/get"]);
    expect(mirror.tags).toEqual(["surface/terminal/list"]);
  });

  it("reads the link per call, so a re-dialled host is answered by its NEW link", async () => {
    const mirror = named("mirror");
    let link = named("first");
    const dispatch = entryDispatch({
      siblingTagPrefixes: SIBLINGS,
      mirror,
      link: () => link,
      host: "remote:guest",
    });

    expect(
      await Effect.runPromise(dispatch.unary("surface/odu/service/get", {})),
    ).toBe("first");

    link = named("second");
    expect(
      await Effect.runPromise(dispatch.unary("surface/odu/service/get", {})),
    ).toBe("second");
  });

  it("fails a sibling call RETRYABLY while the host has no link", async () => {
    const dispatch = entryDispatch({
      siblingTagPrefixes: SIBLINGS,
      mirror: named("mirror"),
      link: () => undefined,
      host: "remote:guest",
    });

    const failure = await Effect.runPromise(
      Effect.flip(dispatch.unary("surface/odu/service/get", {})),
    );
    expect(isSurfaceRelayTransportLost(failure)).toBe(true);
    expect(String(failure)).toContain("remote:guest");

    const streamFailure = await Effect.runPromise(
      Effect.flip(
        Stream.runCollect(dispatch.stream("surface/odu/checkout/get", {})),
      ),
    );
    expect(isSurfaceRelayTransportLost(streamFailure)).toBe(true);
  });

  it("ends a sibling stream RETRYABLY when the padi link dies mid-stream", async () => {
    const dead = new SurfaceStdioTransportClosed({
      reason: "padi exited",
      death: "streamEnded",
    });
    const dispatch = entryDispatch({
      siblingTagPrefixes: SIBLINGS,
      mirror: named("mirror"),
      link: () => ({
        unary: () => Effect.fail(dead),
        stream: () => Stream.concat(Stream.make("live"), Stream.fail(dead)),
      }),
      host: "remote:guest",
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        Stream.runCollect(dispatch.stream("surface/odu/checkout/get", {})),
      ),
    );
    expect(isSurfaceRelayTransportLost(failure)).toBe(true);
    expect(isDeadTransportError(failure)).toBe(false);

    const unaryFailure = await Effect.runPromise(
      Effect.flip(dispatch.unary("surface/odu/service/get", {})),
    );
    expect(isSurfaceRelayTransportLost(unaryFailure)).toBe(true);
  });

  it("lets a DECLARED failure cross unchanged — it is the far end's answer", async () => {
    const declared = new MapKeyUnknown({ mapKey: "remote:ghost" });
    const dispatch = entryDispatch({
      siblingTagPrefixes: SIBLINGS,
      mirror: named("mirror"),
      link: () => ({
        unary: () => Effect.fail(declared),
        stream: () => Stream.fail(declared),
      }),
      host: "remote:guest",
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        Stream.runCollect(dispatch.stream("surface/odu/checkout/get", {})),
      ),
    );
    expect(failure).toBe(declared);
  });
});
