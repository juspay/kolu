/**
 * `connectSurfaces` — the MULTI-surface seam: one wire → a `surfaceClients`
 * bundle + ONE default-on heartbeat probing the first sibling's reserved
 * `system/live` tag, with the one wire's liveness folded into the combined
 * `surfaceClientsHealth().live`. The hand-built admin path (a bare socket +
 * status + `surfaceClients` with NO heartbeat) is what this replaces, so half-open
 * detection is no longer a function of which constructor a consumer called.
 *
 * Four properties are pinned for the siblings-only wire: the combined `live`
 * tracks the one wire (NOT a constant `true`), the heartbeat probes the FIRST
 * sibling's reserved liveness TAG (the scoped tag must be the one
 * `implementSurfaces` binds), the `readout` folds the MERGED fact so a degraded
 * bundle names the stopped sub by its sibling-prefixed name, and a call that
 * passes nothing at all fails fast (no member ⇒ no probe target). The socket is
 * faked through the link's own `connect` seam — no module mocking — and
 * `createHeartbeat` is captured so the probe thunk can be fired without waiting
 * on its interval.
 *
 * The ROOTED bundle — a `core` surface beside the siblings — is pinned in its own
 * block below: where the two reserved round-trips are addressed with a root and
 * without one, that the root is a first-class client and a first-class member of
 * the health fold, and the miswirings the slot refuses.
 *
 * The last block pins the ROSTER MOVE (juspay/kolu#2227): a new wire is dialled and
 * the old one released, but the CONNECTION and every handle it handed out survive —
 * so a standing subscription re-opens itself against the new generation rather than
 * the app rebuilding its tree to follow the roster.
 */

import {
  composeSurfaceContracts,
  defineSurface,
  defineSurfaceWithPolicy,
} from "@kolu/surface/define";
import { Effect, Schema } from "effect";
import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  heartbeatProbe: undefined as undefined | (() => Promise<unknown>),
  // Counted, not spied: the watchdog is armed inside `createLiveSignal`, so a
  // failed connect's unwind is the only thing that can give it back — and there
  // is no handle to observe it through when the connect rejects.
  heartbeatDisposals: 0,
}));

// Mock the heartbeat PRIMITIVE (capture the probe thunk so the test can fire it
// without waiting on the 15s interval). `connectSurfaces` wires the watchdog
// through `createLiveSignal` (`@kolu/surface`), which uses THIS primitive — so the
// capture lives here, not on surface-app's `../connect` wrapper.
vi.mock("@kolu/surface/heartbeat", async (importActual) => {
  const actual = await importActual<typeof import("@kolu/surface/heartbeat")>();
  return {
    ...actual,
    createHeartbeat: (opts: { probe: () => Promise<unknown> }) => {
      mocked.heartbeatProbe = opts.probe;
      return {
        dispose: () => {
          mocked.heartbeatDisposals += 1;
        },
        wake: () => {},
      };
    },
  };
});

import { connectSurfaces } from "./connectSurfaces";
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

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("connectSurfaces — one wire, multi-surface, heartbeat by construction", () => {
  it("folds the ONE wire's liveness into the merged surfaceClientsHealth().live", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface, b: surface },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      // Pre-open: `connecting` → not live (NOT a constant `true` the hand-built
      // path would leave when `{ live }` was forgotten).
      expect(conn.health().live).toBe(false);
      const first = await d.nth(1);
      first.open();
      await settle();
      expect(conn.health().live).toBe(true);
      // A drop / silent half-open → not live, for EVERY sibling (AND-reduce).
      first.close(1006);
      await settle();
      expect(conn.health().live).toBe(false);
      (await d.nth(2)).open();
      await settle();
      expect(conn.health().live).toBe(true);
      await conn.dispose();
      dispose();
    });
  });

  it("wires the default-on heartbeat to probe the FIRST sibling's reserved system/live TAG", async () => {
    const d = dialRecorder();
    mocked.heartbeatProbe = undefined;
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface, b: surface },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      // The heartbeat is default-ON: `createLiveSignal` handed `createHeartbeat`
      // a probe thunk.
      expect(typeof mocked.heartbeatProbe).toBe("function");
      const ws = await d.nth(1);
      ws.open();
      await settle();
      // Firing it puts ONE request on the wire, addressed to the first sibling's
      // scoped reserved liveness member — `surface/a/system/live`, exactly the tag
      // `implementSurfaces({ a, b })` binds. Nothing answers (the fake peer is
      // silent), so we read the FRAME rather than the result.
      // The real `createHeartbeat` always attaches handlers to the probe promise
      // (it races it against a timer); this stand-in doesn't, and `dispose()`
      // INTERRUPTS an in-flight probe — so swallow the interruption rejection
      // here rather than leave it unhandled.
      mocked.heartbeatProbe?.().catch(() => {});
      await expect
        .poll(() => ws.sent.length, { timeout: 3_000 })
        .toBeGreaterThan(0);
      const frames = ws.sent.map((f) => String(f)).join("");
      expect(frames).toContain('"tag":"surface/a/system/live"');
      expect(frames).not.toContain('"tag":"surface/b/system/live"');
      // The identity echo the socket fired on open rode the SAME first sibling's
      // tag — the two reserved round-trips share one target. Pinned here as the
      // byte-compatibility fact the `core` slot must not disturb: with no root,
      // this seam addresses exactly what it addressed before the slot existed.
      expect(frames).toContain('"tag":"surface/a/system/identity"');
      expect(frames).not.toContain('"tag":"surface/system/identity"');
      await conn.dispose();
      dispose();
    });
  });

  it("degrades the readout over a stopped sub, naming it by SIBLING-prefixed name", async () => {
    // The multi-surface readout folds the MERGED fact, whose names are prefixed
    // by surface key (`mergeSurfaceHealth`). That prefix is what makes a degraded
    // bundle say WHICH surface went quiet — a documented claim (the seam's own
    // docstring, `ref-surface.mdx`), so it is pinned at the seam that produces
    // it rather than inferred from the single-surface fold.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface, b: surface },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      expect(conn.readout().status).toBe("live");

      const [error, setError] = createSignal<Error | undefined>(undefined);
      conn.clients.b.enroll("conn", { pending: () => false, error });
      expect(conn.readout().status).toBe("live");

      setError(new Error("Internal server error"));
      expect(conn.readout()).toEqual({
        status: "degraded",
        stopped: ["b/conn"],
        needsReload: false,
      });

      await conn.dispose();
      dispose();
    });
  });

  it("fails fast when NOTHING was passed — no core, no siblings, no probe target", async () => {
    // What is left of the old empty-map refusal once a root slot exists: an empty
    // sibling map is an ordinary wire when a `core` rides beside it (see the
    // rooted block), so the only unspellable wire is one with no members at all.
    await expect(
      connectSurfaces({ surfaces: {}, url: "ws://test", retired: () => {} }),
    ).rejects.toThrow(/nothing was passed/);
  });

  it("hands back NO core client on a siblings-only wire", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface, b: surface },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      expect(conn.core).toBeUndefined();
      await conn.dispose();
      dispose();
    });
  });
});

describe("connectSurfaces — the ROOTED bundle (an unprefixed core beside the siblings)", () => {
  /** The root's own surface. A different member name from the sibling surface's,
   *  so a test can tell whose client it is holding. */
  const core = defineSurface({
    cells: {
      floor: {
        schema: Schema.Struct({ s: Schema.String }),
        default: { s: "x" },
        verbs: ["get"],
      },
    },
  });

  it("addresses BOTH reserved round-trips at the root's BARE tags", async () => {
    // With a root present the identity echo and the half-open watchdog probe
    // `surface/system/*` — the path `createSurfaceSocket` and `createLiveSignal`
    // already implement by omitting `siblingKey`. It is the root, not a sibling,
    // because the root is on every serve this wire can reach: a build that
    // imported more siblings than the serve composed would otherwise probe a tag
    // that serve does not carry and read the refusal as a dead wire.
    const d = dialRecorder();
    mocked.heartbeatProbe = undefined;
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface, b: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      const ws = await d.nth(1);
      ws.open();
      await settle();
      // The identity echo, fired by the socket itself on every open.
      await expect
        .poll(() => ws.sent.length, { timeout: 3_000 })
        .toBeGreaterThan(0);
      expect(ws.sent.map(String).join("")).toContain(
        '"tag":"surface/system/identity"',
      );
      expect(ws.sent.map(String).join("")).not.toContain(
        '"tag":"surface/a/system/identity"',
      );
      // The watchdog, over the same wire.
      const before = ws.sent.length;
      // The stand-in `createHeartbeat` does not attach handlers to the probe
      // promise the way the real one does (it races it against a timer), and
      // `dispose()` INTERRUPTS an in-flight probe — so this swallows the
      // interruption rejection rather than leaving it unhandled. Discarding it is
      // the point: the probe's VALUE is never the signal, only that a frame went
      // out, which is what the assertions below read.
      mocked.heartbeatProbe?.().catch(() => {});
      await expect
        .poll(() => ws.sent.length, { timeout: 3_000 })
        .toBeGreaterThan(before);
      const frames = ws.sent.slice(before).map(String).join("");
      expect(frames).toContain('"tag":"surface/system/live"');
      expect(frames).not.toContain('"tag":"surface/a/system/live"');
      await conn.dispose();
      dispose();
    });
  });

  it("connects a ROOT-ONLY wire — an empty sibling map is ordinary, and the watchdog still bites", async () => {
    // The `--plugins=""` shape: the roster this run composed is empty, so the wire
    // carries only its root. The seam that used to refuse this outright now dials
    // it, probes the root's bare liveness tag, and keeps the same half-open
    // watchdog every other wire gets.
    const d = dialRecorder();
    mocked.heartbeatProbe = undefined;
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: {},
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      expect(conn.health().live).toBe(false);
      const first = await d.nth(1);
      first.open();
      await settle();
      expect(conn.health().live).toBe(true);
      // The probe addresses the root, over a wire that carries no sibling at all.
      const before = first.sent.length;
      // The stand-in `createHeartbeat` does not attach handlers to the probe
      // promise the way the real one does (it races it against a timer), and
      // `dispose()` INTERRUPTS an in-flight probe — so this swallows the
      // interruption rejection rather than leaving it unhandled. Discarding it is
      // the point: the probe's VALUE is never the signal, only that a frame went
      // out, which is what the assertions below read.
      mocked.heartbeatProbe?.().catch(() => {});
      await expect
        .poll(() => first.sent.length, { timeout: 3_000 })
        .toBeGreaterThan(before);
      expect(first.sent.slice(before).map(String).join("")).toContain(
        '"tag":"surface/system/live"',
      );
      // A drop still flips the fact and the link still re-dials — the root-only
      // wire is not a lesser wire.
      first.close(1006);
      await settle();
      expect(conn.health().live).toBe(false);
      (await d.nth(2)).open();
      await settle();
      expect(conn.health().live).toBe(true);
      await conn.dispose();
      dispose();
    });
  });

  it("gives the root a typed client and folds its health under the caller's word", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      expect(conn.readout().status).toBe("live");
      // The root's client is an ordinary client over the same wire — reachable,
      // and typed by the root's OWN spec (`floor` is the root's member; the
      // siblings' `conn` is not on it).
      expect(typeof conn.core.cells.floor.use).toBe("function");
      // …and its subscriptions are in the SAME fold the siblings are, named by
      // the word the caller supplied — which is what makes a degraded readout say
      // the root went quiet rather than saying nothing.
      const [error, setError] = createSignal<Error | undefined>(undefined);
      conn.core.enroll("floor", { pending: () => false, error });
      setError(new Error("Internal server error"));
      expect(conn.readout()).toEqual({
        status: "degraded",
        stopped: ["floor/floor"],
        needsReload: false,
      });
      await conn.dispose();
      dispose();
    });
  });

  it("refuses a CONDITIONAL or absent root at the type level, not at runtime", () => {
    // The two shapes one signature with an optional `core` used to admit, each of
    // which made `conn.core`'s TYPE and its VALUE disagree. Neither is a runtime
    // check: the pins below are the `@ts-expect-error`s, which fail `tsc` the day
    // an overload starts accepting these again. Nothing here dials.
    const conditionalRoot = (enabled: boolean) =>
      connectSurfaces({
        surfaces: { a: surface },
        // @ts-expect-error — a conditionally-supplied root matches NEITHER overload.
        // Inferred from the non-`undefined` arm, `conn.core` would type as a definite
        // client while the seam took the rootless path and handed back `undefined`.
        core: enabled ? { surface: core, name: "floor" } : undefined,
        url: "ws://test",
        retired: () => {},
      });
    const undefinedRoot = () =>
      connectSurfaces({
        surfaces: { a: surface },
        // @ts-expect-error — `core.surface` cannot be `undefined`: the rooted overload
        // pins `C` to an actual `Surface`. This used to reach a raw `TypeError` rather
        // than either of the seam's named refusals.
        core: { surface: undefined, name: "floor" },
        url: "ws://test",
        retired: () => {},
      });
    expect(
      [conditionalRoot, undefinedRoot].every((f) => typeof f === "function"),
    ).toBe(true);
  });

  it("defaults the url to surfaceWsUrl(location.origin) — the same law as the singular door", async () => {
    // The residue a downstream collapse found: this seam REQUIRED `url` while
    // `connectSurface` defaulted it, so a rooted app spelled at its call site the
    // one line its single-surface twin got free. A browser app dials the origin
    // that served it — not a choice, so not an option — and the derivation is the
    // ONE `surfaceWsUrl` (`https:` → `wss:`, the surface path, the page's own
    // authority, the page's PATH replaced rather than appended to).
    vi.stubGlobal("location", new URL("https://box.example:7681/some/page"));
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        retired: () => {},
        connect: d.connect,
      });
      expect((await d.nth(1)).url).toBe("wss://box.example:7681/rpc/ws");
      await conn.dispose();
      dispose();
    });
    vi.unstubAllGlobals();
  });

  it("an explicit url WINS, and no `location` REFUSES — the default fills, never overrides or fabricates", async () => {
    vi.stubGlobal("location", new URL("https://box.example:7681/some/page"));
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "wss://elsewhere.example/rpc/ws",
        retired: () => {},
        connect: d.connect,
      });
      expect((await d.nth(1)).url).toBe("wss://elsewhere.example/rpc/ws");
      await conn.dispose();
      dispose();
    });
    vi.unstubAllGlobals();
    // …and with no browser `location` at all (a Node caller, a test, an SSR pass)
    // it throws BEFORE allocating anything, rather than dialling a fabricated
    // address that would retry forever against nothing. The thunk is deferred to
    // connect time, so importing the module never touches `location`.
    const none = dialRecorder();
    await expect(
      connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        retired: () => {},
        connect: none.connect,
      }),
    ).rejects.toThrow(
      /connectSurfaces: no `url` was given and there is no browser `location`/,
    );
    expect(none.dialled).toEqual([]);
  });
  it("refuses a root whose word is already a sibling key", async () => {
    // The health fold is keyed by that word, so two clients under one name would
    // drop one of them — from the fold AND from the readout — in silence.
    await expect(
      connectSurfaces({
        surfaces: { floor: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
      }),
    ).rejects.toThrow(/also a sibling key/);
  });

  it("refuses a sibling-SCOPED surface as the root", async () => {
    // The client face is built from the SPEC and mints standalone tags whatever
    // prefix the value carries, so a scoped root would dial
    // `surface/<member>/<verb>` over a wire serving `surface/<key>/…` — a wire
    // that connects cleanly and then answers nothing.
    const scoped = composeSurfaceContracts({ core }).siblings.core;
    await expect(
      connectSurfaces({
        surfaces: { a: surface },
        core: { surface: scoped, name: "floor" },
        url: "ws://test",
        retired: () => {},
      }),
    ).rejects.toThrow(/not the standalone/);
  });

  it("disposes the ROOT's client too — the fold, not just the siblings", async () => {
    // `dispose` walks `folded`, which is the siblings PLUS the root. Walking
    // `clients` instead would leak the root's standing subscriptions and every
    // other assertion in this file would still pass, so the tear-down is spied
    // rather than inferred.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      const coreDispose = vi.spyOn(conn.core, "dispose");
      const siblingDispose = vi.spyOn(conn.clients.a, "dispose");
      await conn.dispose();
      expect(coreDispose).toHaveBeenCalledTimes(1);
      expect(siblingDispose).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it("gives the wire back when a construction step throws AFTER the dial", async () => {
    // A root whose spec DECLARES a `client.onError` policy, connected with no
    // interpreter: `buildSurfaceClient` refuses that at construction (design
    // §D/F5) — and it refuses it AFTER `createSurfaceSocket` has dialled and
    // `createLiveSignal` has armed a heartbeat over the open wire. Without the
    // unwind the rejection hands the caller no `dispose` at all while the socket
    // stays open and the watchdog keeps probing it: a leak with no name to
    // release. `connectSurface`'s `url` refusal states the same law on the other
    // side of the dial ("nothing was ever dialled"); this is that law after it.
    const policyRoot = defineSurfaceWithPolicy<{ kind: "toast" }>()({
      cells: {
        floor: {
          schema: Schema.Struct({ s: Schema.String }),
          default: { s: "x" },
          verbs: ["get"],
          client: { onError: { kind: "toast" } },
        },
      },
    });
    const d = dialRecorder();
    const disposalsBefore = mocked.heartbeatDisposals;
    await createRoot(async (dispose) => {
      await expect(
        connectSurfaces({
          surfaces: { a: surface },
          core: { surface: policyRoot, name: "floor" },
          url: "ws://test",
          retired: () => {},
          connect: d.connect,
        }),
      ).rejects.toThrow();
      // The WATCHDOG is the resource with no other way home: `createLiveSignal`
      // armed it over the open wire one step before the throw, and a rejected
      // connect hands the caller no handle to stop it with. One disposal, from
      // the unwind — the wire's own release rides the same path (and the link's
      // dial fiber may not even have reached `connect` before the scope closed,
      // which is why the socket is not what this asserts on).
      expect(mocked.heartbeatDisposals).toBe(disposalsBefore + 1);
      expect(d.dialled.every((ws) => ws.readyState === 3)).toBe(true);
      dispose();
    });
  });
  it("refuses a root whose tags collide with an extra group", async () => {
    // The root joins the dialled group through the same counted merge
    // `extraGroups` rides, so a hand-written group that spells one of the root's
    // tags is a boot crash naming both halves — never a tag that answers the
    // wrong schema.
    await expect(
      connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        extraGroups: [core.group],
        url: "ws://test",
        retired: () => {},
      }),
    ).rejects.toThrow(/claimed by "core" and "extraGroups\[0\]"/);
  });

  it("names the SIBLING, not the bundle, when a sibling's tags collide with an extra group", async () => {
    // The labels exist so a collision report says WHICH TWO of the caller's own
    // halves claimed the tag. Handing the composed bundle in as one half named
    // "siblings" would answer the question with the half the caller already knew.
    const composed = composeSurfaceContracts({ a: surface });
    await expect(
      connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        extraGroups: [composed.siblings.a.group],
        url: "ws://test",
        retired: () => {},
      }),
    ).rejects.toThrow(/claimed by "surfaces\.a" and "extraGroups\[0\]"/);
  });

  it("refuses a root word that a degraded readout cannot say", async () => {
    // The word is a LABEL and not a tag segment — but it is the word the readout
    // says, prefixed onto every stopped subscription as `<name>/<sub>`. Empty, it
    // reads as `/floor`; carrying the separator, it is indistinguishable from a sub
    // of a sibling named `a`. Naming is the field's only job.
    for (const name of ["", "a/b"]) {
      await expect(
        connectSurfaces({
          surfaces: { a: surface },
          core: { surface: core, name },
          url: "ws://test",
          retired: () => {},
        }),
      ).rejects.toThrow(/must be non-empty and carry no/);
    }
  });
});

describe("connectSurfaces — a ROSTER CHANGE moves the WIRE, not the connection", () => {
  /** The root's own surface, as in the rooted block above. */
  const core = defineSurface({
    cells: {
      floor: {
        schema: Schema.Struct({ s: Schema.String }),
        default: { s: "x" },
        verbs: ["get"],
      },
    },
  });
  /** A second sibling surface, to arrive on the new roster. */
  const later = defineSurface({
    cells: {
      queue: {
        schema: Schema.Struct({ n: Schema.Number }),
        default: { n: 0 },
        verbs: ["get"],
      },
    },
  });

  /** Every frame a fake socket has sent, as one string to match tags against. */
  const framesOf = (ws: { sent: (string | Uint8Array)[] }): string =>
    ws.sent.map((f) => String(f)).join("");

  /** Ask a client for the reserved `system/live` round-trip and report what came
   *  back as a string — the cheapest way to ask a client whether it will still
   *  dial at all. `SurfaceFace` types its leaves `unknown` on purpose (per-member
   *  precision lives in the bound faces), so the reach through it is cast here
   *  rather than at each call. */
  const askLive = (client: {
    rpc: { surface: Record<string, Record<string, unknown>> };
  }): Promise<string> => {
    const live = client.rpc.surface.system?.live as (
      input: unknown,
    ) => Effect.Effect<unknown, unknown>;
    return Effect.runPromise(live({})).then(
      () => "resolved",
      (err: unknown) => String(err),
    );
  };

  it("dials a NEW wire over the new roster, releases the old one, and keeps every handle the app holds", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: {},
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      const firstSocket = await d.nth(1);
      firstSocket.open();
      await settle();
      expect(Object.keys(conn.clients)).toEqual([]);
      // Everything the app could be holding, captured BEFORE the move.
      const held = {
        clients: conn.clients,
        core: conn.core,
        transport: conn.transport,
        readout: conn.readout,
        health: conn.health,
        link: conn.link,
        wire: conn.link.wire,
        dispatch: conn.link.dispatch,
      };

      const next = await conn.redial({ b: later });
      // A SECOND socket — a roster change IS a new wire at both ends, which is
      // the one thing this door cannot hide (the group is fixed at the dial).
      const secondSocket = await d.nth(2);
      expect(secondSocket).not.toBe(firstSocket);
      secondSocket.open();
      await settle();

      // ...and the superseded wire was released.
      expect(firstSocket.readyState).toBe(3);
      // THE property this seam exists for: the connection is the same object,
      // and so is every handle it ever handed out. An app holding any of these
      // — drishti keeps `conn.link.wire` and `conn.transport` at module scope —
      // keeps holding something live.
      expect(next).toBe(conn);
      expect(conn.clients).toBe(held.clients);
      expect(conn.core).toBe(held.core);
      expect(conn.transport).toBe(held.transport);
      expect(conn.readout).toBe(held.readout);
      expect(conn.health).toBe(held.health);
      expect(conn.link).toBe(held.link);
      expect(conn.link.wire).toBe(held.wire);
      expect(conn.link.dispatch).toBe(held.dispatch);
      // The new roster is on the map the app already holds...
      expect(Object.keys(held.clients)).toEqual(["b"]);
      // ...the ROOT came across unchanged (it is the member on every serve)...
      expect(conn.core).toBeDefined();
      // ...and the connection reads live over the wire it now rides.
      expect(conn.readout().status).toBe("live");

      await conn.dispose();
      dispose();
    });
  });

  it("an arriving sibling appears on `clients`; a departing one is dropped, and ITS client refuses in words", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      // What a still-mounted component would be holding across the move.
      const departing = conn.clients.a;

      const next = await conn.redial({ b: later });
      (await d.nth(2)).open();
      await settle();

      // The map tells the truth about the roster: the arrival is on it, the
      // departure is not.
      expect(Object.keys(next.clients)).toEqual(["b"]);
      expect(next.clients.b).toBeDefined();

      // And the departed sibling's own client — which the map no longer names,
      // but a component may still hold — refuses IN WORDS rather than dialling
      // a tag this generation does not serve.
      expect(await askLive(departing)).toMatch(
        /no longer on this bundle's roster/,
      );

      await conn.dispose();
      dispose();
    });
  });

  it("re-opens a standing subscription against the NEW generation, through the fence", async () => {
    // The half of "follows in place" that is not about object identity: a
    // subscription opened before the move keeps delivering after it, without the
    // app re-subscribing. The following wire fails what was in flight with the
    // transport error the per-subscription retry fence already retries on, so the
    // re-subscribe is the framework's ONE recovery path rather than a second one.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      const firstSocket = await d.nth(1);
      firstSocket.open();
      await settle();
      // A standing subscription on the sibling that SURVIVES the move, opened
      // under its own root — the ownerless shape a component never has, and the
      // one `keyedSubscriptionCache` deliberately tears down in the same tick.
      let unmount = () => {};
      createRoot((disposeSub) => {
        unmount = disposeSub;
        conn.clients.a.cells.conn.use();
      });
      await expect
        .poll(() => framesOf(firstSocket), { timeout: 3_000 })
        .toContain('"tag":"surface/a/conn/get"');

      await conn.redial({ a: surface, b: later });
      const secondSocket = await d.nth(2);
      secondSocket.open();

      // Nothing in the app asked for this: the fence saw the supersession as a
      // transport failure and re-subscribed onto the generation now underneath.
      await expect
        .poll(() => framesOf(secondSocket), { timeout: 8_000 })
        .toContain('"tag":"surface/a/conn/get"');

      unmount();
      await conn.dispose();
      dispose();
    });
  }, 20_000);

  it("does NOT read retired across a roster move — a move is not a retirement", async () => {
    // The old shape superseded the connection, so its `readout` read `retired`
    // and its `health` read not-live from the instant `redial` resolved. A
    // consumer had to fork its indicator around that ("between wires") to stop
    // the page announcing a retirement that had not happened. Now the readout is
    // about the wire this connection rides, throughout.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      expect(conn.readout().status).toBe("live");
      expect(conn.health().live).toBe(true);

      await conn.redial({ b: later });
      (await d.nth(2)).open();
      await settle();

      expect(conn.readout().status).toBe("live");
      expect(conn.readout().needsReload).toBe(false);
      expect(conn.health().live).toBe(true);

      // A DISPOSED connection is the one that answers about nothing — the arm
      // the terminal state still owns.
      await conn.dispose();
      expect(conn.readout().status).toBe("retired");
      expect(conn.readout().needsReload).toBe(true);
      // ...and it is the SAME frozen value on every read, so a consumer memo over
      // a disposed connection is not woken forever by a fresh object.
      expect(conn.readout()).toBe(conn.readout());
      expect(conn.health().live).toBe(false);
      expect(conn.health().subs).toEqual([]);
      dispose();
    });
  });

  it("rebuilds the client for a key whose SURFACE was replaced", async () => {
    // Same key, different surface VALUE — an edited plugin rebuilt at a new
    // chunk is the shape. A client built over the old spec binds members the new
    // one may not have, so "the key is still there" is not enough to keep it.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      const before = conn.clients.a;

      // `later` under the SAME key `a`.
      const next = await conn.redial({ a: later });
      (await d.nth(2)).open();
      await settle();

      expect(Object.keys(next.clients)).toEqual(["a"]);
      expect(next.clients.a).not.toBe(before);
      // The client built over the OLD surface is retracted, not left dialling.
      expect(await askLive(before)).toMatch(
        /no longer on this bundle's roster/,
      );
      await conn.dispose();
      dispose();
    });
  });

  it("follows the reserved probes' target when a ROOTLESS wire re-rosters", async () => {
    // On a rootless wire the probe addresses the FIRST sibling, and "first" is a
    // fact about the roster — so a roster that drops it must move the probe with
    // it. The watchdog is built ONCE (that is what keeps `conn.transport` stable),
    // so the target has to be re-read per probe rather than resolved at the dial.
    const d = dialRecorder();
    mocked.heartbeatProbe = undefined;
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface, b: surface },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      const firstSocket = await d.nth(1);
      firstSocket.open();
      await settle();
      const probe = mocked.heartbeatProbe;
      expect(typeof probe).toBe("function");

      // `a` LEAVES; `b` is now the first sibling.
      await conn.redial({ b: surface, c: later });
      const secondSocket = await d.nth(2);
      secondSocket.open();
      await settle();
      // The SAME watchdog — no second `createHeartbeat` was armed.
      expect(mocked.heartbeatProbe).toBe(probe);

      probe?.().catch(() => {});
      await expect
        .poll(() => secondSocket.sent.length, { timeout: 3_000 })
        .toBeGreaterThan(0);
      const frames = framesOf(secondSocket);
      expect(frames).toContain('"tag":"surface/b/system/live"');
      expect(frames).not.toContain('"tag":"surface/a/system/live"');
      // The identity echo the NEW generation fired on its open rode the same
      // moved target — the two reserved round-trips still share one.
      expect(frames).toContain('"tag":"surface/b/system/identity"');

      await conn.dispose();
      dispose();
    });
  });

  it("re-uses the options this connection was dialled with, so a consumer cannot drift them", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://recorded-url",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      await conn.redial({ a: surface, b: later });
      const second = await d.nth(2);
      // The `url` — the residue a hand-rolled redial re-spells and gets wrong.
      expect(second.url).toContain("recorded-url");
      // ...and the fake `connect` itself, which is an option too: a redial that
      // re-spelled the call would have dialled a REAL socket here.
      expect(d.dialled.length).toBe(2);
      await conn.dispose();
      dispose();
    });
  });

  it("leaves the working wire AND its roster alone when the redial's dial fails", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      const firstSocket = await d.nth(1);
      firstSocket.open();
      await settle();
      expect(conn.health().live).toBe(true);
      const standing = conn.clients.a;

      // A roster carrying a sibling keyed with the root's own word — one of the
      // refusals `connectSurfaces` owes a rooted call, and like all of them it is
      // raised BEFORE anything is dialled. It is re-made for EVERY roster, not
      // just the first, which is the reason it moved out of `resolveRoot`.
      await expect(conn.redial({ a: surface, floor: core })).rejects.toThrow(
        /also a sibling key/,
      );
      // The connection is untouched: still live, still THIS socket, still on its
      // current roster with the same clients, and still redialable.
      expect(conn.health().live).toBe(true);
      expect(firstSocket.readyState).not.toBe(3);
      expect(Object.keys(conn.clients)).toEqual(["a"]);
      expect(conn.clients.a).toBe(standing);
      const next = await conn.redial({ a: surface, b: later });
      (await d.nth(2)).open();
      await settle();
      expect(Object.keys(next.clients).sort()).toEqual(["a", "b"]);
      // `a` was on both rosters and its surface did not move, so its client — and
      // everything standing on it — came across untouched.
      expect(next.clients.a).toBe(standing);
      await conn.dispose();
      dispose();
    });
  });

  it("releases the replacement wire when a dispose lands DURING the redial", async () => {
    // The concurrent case the sequential tests missed. `onCleanup(() => conn.dispose())`
    // racing a roster-change redial is the ordinary shape in a Solid app, and a
    // wire adopted onto a connection whose clients and watchdog are already
    // released is an open socket plus a running heartbeat that nobody holds.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();

      const pending = conn.redial({ b: later });
      // The caller gives the connection up while the dial is still in flight.
      await conn.dispose();
      await expect(pending).rejects.toThrow(
        /disposed while `redial` was dialling/,
      );
      // THE property, stated over the whole set rather than over a socket index:
      // no wire is left open. Whether the replacement got as far as dialling is a
      // race with the protocol's own fiber — what must never happen is one
      // surviving it.
      await settle();
      for (const ws of d.dialled) expect(ws.readyState).toBe(3);
      dispose();
    });
  });

  it("leaves NO wire open when a dispose races a redial, whichever side wins", async () => {
    // The race-agnostic invariant, which is the honest shape for a race. A
    // `dispose()` can land during the DIAL (covered above, with its own message)
    // or during the SUPERSEDED generation's release that follows the handover.
    // The second is only a few microtasks wide with fake sockets, so a test that
    // tried to land inside it would be pinning a schedule rather than a
    // guarantee. What must hold either way is that the caller ends up holding
    // nothing open: the handover is synchronous, so a dispose either finds a
    // connection that is still on its old roster or one that is fully on the new
    // one, and releases whichever wire that connection holds.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();

      const pending = conn.redial({ b: later });
      await conn.dispose();
      // Whoever won, the connection ends up disposed and nothing is left open.
      const outcome = await pending.then(
        () => ({ ok: true as const }),
        (err: unknown) => ({ ok: false as const, err }),
      );
      if (!outcome.ok) {
        expect(String(outcome.err)).toMatch(/disposed while `redial` was/);
      }
      await settle();
      // THE invariant: nothing the connection ever dialled is still open.
      for (const ws of d.dialled) expect(ws.readyState).toBe(3);
      expect(conn.readout().status).toBe("retired");
      dispose();
    });
  });

  it("a dispose during a FAILING dial is not erased — the connection stays gone", async () => {
    // One boolean could not carry two facts: the dial-failure path restored it
    // unconditionally, so a dispose that landed in that window was erased and the
    // connection re-armed itself over already-released allocations.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();

      // A roster the seam refuses — the dial never happens.
      const failing = conn.redial({ a: surface, floor: core });
      await conn.dispose();
      await expect(failing).rejects.toThrow();
      // `gone` is TERMINAL: the failed dial must not have re-armed it.
      await expect(conn.redial({ b: later })).rejects.toThrow(
        /`redial` on a DISPOSED connection/,
      );
      dispose();
    });
  });

  it("RELEASES the connection when the new roster's clients cannot be built after the wire was adopted", async () => {
    // The price of building arrivals AFTER the adopt, paid out loud. An arriving
    // sibling whose spec declares a `client.onError` policy with no interpreter is
    // refused at construction (design §D/F5) — and by then the wire has already
    // moved and cannot move back. A connection whose wire serves one roster while
    // its clients were built for another cannot be made honest, so it is given up
    // completely rather than left wedged mid-transition with every later `redial`
    // refused (which is what a bare rethrow left behind).
    const policied = defineSurfaceWithPolicy<{ kind: "toast" }>()({
      cells: {
        note: {
          schema: Schema.Struct({ s: Schema.String }),
          default: { s: "x" },
          verbs: ["get"],
          client: { onError: { kind: "toast" } },
        },
      },
    });
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();

      await expect(conn.redial({ a: surface, bad: policied })).rejects.toThrow(
        /could not be built after its wire had already been adopted/,
      );
      await settle();
      // RELEASED, not wedged: the readout says so, every wire it ever dialled is
      // closed, and the connection is terminal rather than stuck in "redialing".
      expect(conn.readout().status).toBe("retired");
      expect(conn.health().live).toBe(false);
      for (const ws of d.dialled) expect(ws.readyState).toBe(3);
      await expect(conn.redial({ b: later })).rejects.toThrow(
        /`redial` on a DISPOSED connection/,
      );
      dispose();
    });
  });

  it("a memo bound to `conn.health()` RE-FOLDS across the move, naming the arrival and not the departure", async () => {
    // The reactivity invariant the whole in-place move rests on, and the one a
    // green suite used to be silent about. `clients` is mutated in place, so
    // nothing about its key set is trackable — the membership notification comes
    // from the bundle, beside the mutation. Delete it and this test fails: the
    // memo keeps naming the departed sibling's subscription and never names the
    // arrival's, while every object-identity assertion above still passes.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      // A standing subscription on the sibling that LEAVES, so the fold has a
      // name to lose.
      createRoot(() => conn.clients.a.cells.conn.use());
      let runs = 0;
      const folded = createMemo(() => {
        runs += 1;
        return conn.health();
      });
      createEffect(() => folded());
      await settle();
      const before = runs;
      expect(folded().subs.map((s) => s.name)).toContain("a/conn");

      const moved = await conn.redial({ b: later });
      (await d.nth(2)).open();
      // ...and one on the ARRIVAL, so the fold has a name to gain. Reached
      // through the redial's result, which is this same connection retyped to
      // the roster it now carries.
      createRoot(() => moved.clients.b.cells.queue.use());
      await settle();

      expect(runs).toBeGreaterThan(before);
      const names = folded().subs.map((s) => s.name);
      expect(names).toContain("b/queue");
      expect(names).not.toContain("a/conn");

      await conn.dispose();
      dispose();
    });
  });

  it("dials NOTHING for a roster this connection is already on", async () => {
    // Idempotence, not a fallback. The documented pattern publishes the roster as
    // a cell and drives `redial` off its changes, so a redundant call is ordinary
    // — and dialling anyway would fail every call in flight and re-open every
    // standing subscription on the page to arrive back where it started. The
    // comparison is the BUNDLE's own, so this door and the move cannot diff by
    // two rules.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface, b: later },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      const firstSocket = await d.nth(1);
      firstSocket.open();
      await settle();
      const standing = conn.clients.a;

      // The SAME roster, in a fresh object literal and a different key order —
      // what an over-firing effect re-publishing an unchanged roster hands over.
      const same = await conn.redial({ b: later, a: surface });
      await settle();
      expect(same).toBe(conn);
      // No second socket was dialled, the first is still open, and every client
      // came through untouched.
      expect(d.dialled.length).toBe(1);
      expect(firstSocket.readyState).not.toBe(3);
      expect(conn.clients.a).toBe(standing);
      expect(conn.readout().status).toBe("live");
      // ...and the connection is still redialable: the no-op left the state
      // machine exactly where it found it.
      await conn.redial({ a: surface });
      (await d.nth(2)).open();
      await settle();
      expect(Object.keys(conn.clients)).toEqual(["a"]);

      await conn.dispose();
      dispose();
    });
  });

  it("still refuses a NO-OP roster that is illegal — the refusals come first", async () => {
    // A roster carrying a sibling keyed with the root's own word is refused
    // before anything is dialled, and the idempotence door is downstream of that:
    // "nothing to do" must never become a way past a refusal.
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: {},
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      // An EMPTY roster is the one this connection is already on...
      expect(await conn.redial({})).toBe(conn);
      // ...but the same emptiness plus the root's word is still refused.
      await expect(conn.redial({ floor: core })).rejects.toThrow(
        /also a sibling key/,
      );
      await conn.dispose();
      dispose();
    });
  });

  it("refuses a CONCURRENT redial, and a redial after dispose", async () => {
    const d = dialRecorder();
    await createRoot(async (dispose) => {
      const conn = await connectSurfaces({
        surfaces: { a: surface },
        core: { surface: core, name: "floor" },
        url: "ws://test",
        retired: () => {},
        connect: d.connect,
      });
      (await d.nth(1)).open();
      await settle();
      // Two rosters in hand at once: this connection dials one wire at a time, so
      // the QUEUE belongs to the caller. A second dial would open a wire the
      // first one is about to supersede.
      const first = conn.redial({ b: later });
      await expect(conn.redial({ c: later })).rejects.toThrow(
        /another `redial` is still in flight/,
      );
      await first;
      (await d.nth(2)).open();
      await settle();
      expect(Object.keys(conn.clients)).toEqual(["b"]);

      await conn.dispose();
      await expect(conn.redial({ b: later })).rejects.toThrow(
        /`redial` on a DISPOSED connection/,
      );
      dispose();
    });
  });
});
