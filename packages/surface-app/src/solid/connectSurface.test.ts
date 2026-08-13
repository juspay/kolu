/**
 * `connectSurface`'s DEFAULT dial URL, through the real seam — only the
 * WebSocket is faked (the link's `connect` option), so what is asserted is the
 * URL the link actually dials.
 *
 * The readout and the rest of the seam's behaviour live in `readout.test.ts`;
 * this file pins exactly the two halves of the `url` default:
 *   - omitted in a browser, the seam dials `surfaceWsUrl(location.origin)` —
 *     the ONE origin derivation every consumer used to spell by hand;
 *   - omitted with no `location` (a Node caller), the seam throws loudly
 *     instead of dialling a fabricated address.
 */

import { defineSurface } from "@kolu/surface/define";
import { Schema } from "effect";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeWebSocket } from "../fakeSocket.testlib";
import { connectSurface } from "./connectSurface";
import { dialRecorder } from "./dialRecorder.testlib";

const surface = defineSurface({
  cells: {
    conn: {
      schema: Schema.Struct({ s: Schema.String }),
      default: { s: "x" },
      verbs: ["get"],
    },
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connectSurface() — the url default", () => {
  it("dials surfaceWsUrl(location.origin) when no url is given", async () => {
    // A browser-shaped `location`. Node has none, so the stub also proves the
    // default reads the PAGE's origin rather than anything ambient.
    vi.stubGlobal("location", new URL("https://box.example:7681/some/page"));
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurface({
        surface,
        retired: () => {},
        connect: d.connect,
      });
      // The one derivation: `https:` → `wss:`, the surface path, the page's
      // own authority — and the page's PATH replaced, not appended to.
      expect((await d.nth(1)).url).toBe("wss://box.example:7681/rpc/ws");
      await conn.dispose();
      dispose();
    });
  });

  it("throws loudly when no url is given and there is no location (Node)", async () => {
    // vitest's node env has no `location` — exactly the caller the default
    // must refuse: a fabricated dial address would fail later and elsewhere.
    expect(typeof location).toBe("undefined");
    await expect(
      connectSurface({
        surface,
        retired: () => {},
        connect: (url: string) =>
          new FakeWebSocket(url) as unknown as WebSocket,
      }),
    ).rejects.toThrow(/no `url` was given and there is no browser `location`/);
  });
});
