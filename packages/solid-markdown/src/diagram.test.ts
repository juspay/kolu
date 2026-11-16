import { describe, expect, it } from "vitest";
import { createDiagramCache } from "./diagram";
import { DiagramSyntaxError, type FrameResult } from "./diagram-frame";

const DRAWN: FrameResult = {
  light: { svg: "<svg>light</svg>", width: 10, height: 20 },
  dark: { svg: "<svg>dark</svg>", width: 11, height: 20 },
};

/** A fake frame: answers with whatever `answer` says and counts renders. */
function fakeRender(answer: () => Promise<FrameResult>) {
  const calls: string[] = [];
  return {
    calls,
    render: (source: string) => {
      calls.push(source);
      return answer();
    },
  };
}

describe("createDiagramCache", () => {
  it("encodes a drawn diagram as two sized data: image URLs", async () => {
    const fake = fakeRender(() => Promise.resolve(DRAWN));
    const cache = createDiagramCache(fake.render);

    expect(await cache.load("graph LR")).toEqual({
      ok: true,
      light: {
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg>light</svg>")}`,
        width: 10,
        height: 20,
      },
      dark: {
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg>dark</svg>")}`,
        width: 11,
        height: 20,
      },
    });
    expect(cache.peek("graph LR")?.ok).toBe(true);
  });

  it("remembers a syntax error: the same text is not rendered again", async () => {
    const fake = fakeRender(() =>
      Promise.reject(new DiagramSyntaxError("Parse error on line 1")),
    );
    const cache = createDiagramCache(fake.render);

    const first = await cache.load("graph ???");
    const second = await cache.load("graph ???");

    expect(first).toEqual({ ok: false, message: "Parse error on line 1" });
    expect(second).toEqual(first);
    expect(fake.calls).toHaveLength(1);
  });

  it("does not remember a renderer failure: the next load renders again", async () => {
    const fake = fakeRender(() =>
      Promise.reject(new Error("Diagram renderer could not be loaded")),
    );
    const cache = createDiagramCache(fake.render);

    expect(await cache.load("graph LR")).toEqual({
      ok: false,
      message: "Diagram renderer could not be loaded",
    });
    expect(cache.peek("graph LR")).toBeUndefined();
    await cache.load("graph LR");
    expect(fake.calls).toHaveLength(2);
  });

  it("shares one render between concurrent loads of one source", async () => {
    const pending = Promise.withResolvers<FrameResult>();
    const fake = fakeRender(() => pending.promise);
    const cache = createDiagramCache(fake.render);

    const both = Promise.all([cache.load("graph LR"), cache.load("graph LR")]);
    pending.resolve(DRAWN);
    const [a, b] = await both;

    expect(a).toBe(b);
    expect(fake.calls).toEqual(["graph LR"]);
  });
});
