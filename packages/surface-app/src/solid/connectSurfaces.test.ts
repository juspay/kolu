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
 */

import {
  composeSurfaceContracts,
  defineSurface,
  defineSurfaceWithPolicy,
} from "@kolu/surface/define";
import { Schema } from "effect";
import { createRoot, createSignal } from "solid-js";
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
