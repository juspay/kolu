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

import {
  defineSurface,
  defineSurfaceWithPolicy,
} from "@kolu/surface/define";
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

  it("an explicit url WINS while a location is present — the default fills, never overrides", async () => {
    vi.stubGlobal("location", new URL("https://box.example:7681/some/page"));
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurface({
        surface,
        url: "wss://other.example/rpc/ws",
        retired: () => {},
        connect: d.connect,
      });
      const dialled = (await d.nth(1)).url;
      expect(dialled).toBe("wss://other.example/rpc/ws");
      // …and provably not the stubbed page's derivation.
      expect(dialled).not.toBe("wss://box.example:7681/rpc/ws");
      await conn.dispose();
      dispose();
    });
  });

  it("throws loudly when no url is given and there is no location (Node)", async () => {
    // vitest's node env has no `location` — exactly the caller the default
    // must refuse: a fabricated dial address would fail later and elsewhere.
    expect(typeof location).toBe("undefined");
    const connect = vi.fn(
      (url: string) => new FakeWebSocket(url) as unknown as WebSocket,
    );
    await expect(
      connectSurface({
        surface,
        retired: () => {},
        connect,
      }),
    ).rejects.toThrow(/no `url` was given and there is no browser `location`/);
    // BEFORE allocation: the throw happens while the socket seam's arguments
    // are still being built — nothing was ever dialled.
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("connectSurface() — the client-error interpreter", () => {
  /** A surface whose cell DECLARES a `client.onError` policy. `buildSurfaceClient`
   *  refuses to construct a client for it with no interpreter threaded (a declared
   *  policy may never route nowhere), so this surface is the one that can tell
   *  whether the door forwards the slot or drops it. */
  const policied = defineSurfaceWithPolicy<{ kind: "toast"; label: string }>()({
    cells: {
      conn: {
        schema: Schema.Struct({ s: Schema.String }),
        default: { s: "x" },
        verbs: ["get"],
        client: { onError: { kind: "toast", label: "Conn" } },
      },
    },
  });

  it("threads onClientError to the client — a policy-bearing surface is reachable through the SINGULAR door", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurface({
        surface: policied,
        url: "wss://box.example/rpc/ws",
        retired: () => {},
        connect: d.connect,
        onClientError: () => {},
      });
      expect(conn.client).toBeDefined();
      await conn.dispose();
      dispose();
    });
  });

  it("still CRASHES at construction when the policy would route nowhere", async () => {
    // The slot is optional at the type (a policy-free surface needs none), so the
    // enforcement stays `buildSurfaceClient`'s construction scan — and it must keep
    // firing at this door, or the slot would have turned a loud refusal into a
    // silent swallow.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      await expect(
        connectSurface({
          surface: policied,
          url: "wss://box.example/rpc/ws",
          retired: () => {},
          connect: d.connect,
        }),
      ).rejects.toThrow(/no `onClientError` interpreter was threaded/);
      dispose();
    });
  });
});
