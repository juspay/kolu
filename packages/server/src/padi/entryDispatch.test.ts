/**
 * Where one host entry's calls go — and, on a host that leaves the pool and
 * comes back, whose link they go down.
 *
 * Both claims are about a tag arriving at the same per-entry dispatch: padi's
 * own members are served from the mirror kolu-server holds for that host, and a
 * sibling's are forwarded onto the host's live link so the daemon at the far end
 * keeps its own demand gate honest. The third is the flap: the link is read on
 * every call, never captured, so a dispatch rebuilt over a fresh session (or an
 * old one that somehow survived) can never answer from a destroyed link.
 */

import { isSurfaceRelayTransportLost } from "@kolu/surface/errors";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { entryDispatch } from "./entryDispatch.ts";

/** A dispatch that records the tags it was asked for and answers with its own
 *  name, so a test can say WHICH of two dispatches a call reached. */
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

    // The forwarded call keeps the tag it arrived with: that IS the tag the far
    // daemon serves odu at, so there is nothing to re-prefix.
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

    // The host left and came back — a fresh session, a fresh link. A dispatch
    // that had captured the first one would answer from a socket nobody is on
    // the other end of.
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

    // Not a hold and not a silent empty: the subscriber is told, with the tag
    // the client's own retry fence re-subscribes on once padi is back.
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
});
