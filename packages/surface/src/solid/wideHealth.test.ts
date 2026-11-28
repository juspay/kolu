/**
 * THE ENROLLED-SUBSCRIPTION AXIS AT FLEET SIZE — 300 per-key subscriptions on
 * ONE client, read through the readout every indicator binds.
 *
 * `health()` is the fact every gate, dot and overlay folds, and per-key
 * collection delivery enrols one subscription PER KEY. A fold that reads each
 * enrolled sub's `pending()` and `error()` from the CALLING scope charges that
 * scope two sources per subscription, so the readout memo crossed Solid's
 * 200-source `WIDE_SCOPE_DEPS` judge at ~99 subscriptions — a number a page
 * with a row per document reaches on an ordinary morning. The registry folds
 * its own subs now, in chunks, so every caller pays a fixed two.
 *
 * This drives the REAL stack — `surfaceClient` over a real dispatch, the real
 * keys-stream, the real per-key `createSubscription` stores, the real
 * `createSurfaceReadout` — because a mocked `health()` handing out a plain
 * array undercounts the production graph by exactly the factor that matters.
 *
 * The FIXTURE is itself bounded (a `mapArray` row per key, each row its own
 * scope), so a diagnostic raised here is the framework's, never the test's.
 */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Effect, Schema, Stream } from "effect";
import {
  createEffect,
  createMemo,
  createRoot,
  flush,
  mapArray,
} from "solid-js";
import { describe, expect, it } from "vitest";
import { defineSurface } from "../define";
import type { SurfaceDispatch } from "../link";
import {
  type ControllableStream,
  controllableStream,
} from "./controllableStream.testlib";
import { settle as oneTurn } from "./deltasHarness.testlib";
import { gateStatus } from "./health";
import { createSurfaceReadout, type SurfaceReadout } from "./readout";
import { surfaceClient } from "./surfaceClient";

/** Past the 200-source bar on BOTH halves of the fold: 300 keys enrol 300
 *  per-key value subs plus the keys-stream, so the old per-read walk charged
 *  its caller 602 sources. */
const KEYS = 300;
const ids = Array.from({ length: KEYS }, (_, n) => `k${n}`);

/** The sub left without a first frame through phase one, and the one failed in
 *  phase three — named here so the expected readout is spelled once. */
const PENDING_KEY = "k11";
const FAILING_KEY = "k7";

const surface = defineSurface({
  collections: {
    items: {
      keySchema: Schema.String,
      schema: Schema.Struct({ v: Schema.Number }),
    },
  },
});

/** Three of the shared harness's turns. One turn carries a pushed frame across
 *  the stream fiber; the keys frame, the 300 per-key subscribes it fans out and
 *  their own first frames are three such hops, and an assertion is never
 *  relaxed to fit the timing. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await oneTurn();
};

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

/** The membership stream and one hand-driven value stream per key — a real
 *  wire's shape (nothing emits synchronously with the subscribe, which the
 *  dispatch contract requires). */
function fleetDispatch(): {
  dispatch: SurfaceDispatch;
  keys: ControllableStream<string[]>;
  values: Map<string, ControllableStream<{ v: number }>>;
} {
  const keys = controllableStream<string[]>();
  const values = new Map<string, ControllableStream<{ v: number }>>();
  for (const id of ids) values.set(id, controllableStream<{ v: number }>());
  const dispatch: SurfaceDispatch = {
    unary: (tag) => Effect.fail(new Error(`no member served at "${tag}"`)),
    stream: (tag, payload) => {
      if (tag === "surface/items/keys") return keys.source;
      if (tag === "surface/items/get") {
        const key =
          typeof payload === "object" && payload !== null && "key" in payload
            ? String(payload.key)
            : "";
        const value = values.get(key);
        if (value === undefined)
          return Stream.fail(new Error(`no entry at "${key}"`));
        return value.source;
      }
      return Stream.fail(new Error(`no member served at "${tag}"`));
    },
  };
  return { dispatch, keys, values };
}

describe("the enrolled-subscription axis", () => {
  it("folds 300 enrolled subs into a readout with no wide scope", async () => {
    const { dispatch, keys, values } = fleetDispatch();
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      const items = app.collections.items.use({});

      // EVERY computation is built HERE, before the first `await`: a reactive
      // owner does not survive one, so a later `createEffect` would be ownerless
      // (and Solid says so). It is also how a page is actually wired — the
      // indicators exist before the frames arrive.
      //
      // THE FIXTURE is bounded by construction: `mapArray` over the keys is two
      // sources flat (it reads the accessor and the store array's container
      // node, then iterates the raw backing untracked), each row memo reads its
      // own key's subscription and nothing else, and each row's effect is its
      // own scope. So nothing here is a wide scope, and a finding is the
      // framework's.
      const arrived = new Set<string>();
      const rows = mapArray(
        items.keys,
        (id) => {
          const row = createMemo(() => items.byKey(id)?.(), {
            name: `fixture[${id}]`,
          });
          createEffect(row, (value) => {
            if (value === undefined) arrived.delete(id);
            else arrived.add(id);
          });
          return row;
        },
        { name: "fixture.byKey" },
      );
      const mounted = createMemo(() => rows().length, {
        name: "fixture.mounted",
      });

      // The readout EVERY indicator binds — a memo over the whole fact.
      const readout = createSurfaceReadout(() => "live", app.health);
      const seen: SurfaceReadout[] = [];
      createEffect(
        () => readout.readout(),
        (next) => {
          seen.push(next);
        },
      );

      keys.push(ids);
      await settle();
      // Every key's first frame but one: the sub left alone stays PENDING, which
      // is what a page mid-load looks like.
      for (const id of ids)
        if (id !== PENDING_KEY) values.get(id)?.push({ v: 1 });
      await settle();
      flush();

      // Totality first: the keys-stream plus one value sub per key.
      const subs = app.health().subs;
      expect(subs).toHaveLength(KEYS + 1);
      expect(subs.filter((s) => s.pending).map((s) => s.name)).toEqual([
        `items[${PENDING_KEY}]`,
      ]);
      expect(mounted()).toBe(KEYS);
      expect(arrived.size).toBe(KEYS - 1);
      // A pending sub does not degrade — a first frame that has not landed is
      // what every page load looks like.
      expect(gateStatus(app.health())).toBe("connecting");
      expect(readout.readout()).toEqual({
        status: "live",
        needsReload: false,
        presentingDown: false,
      });
      expect(diagnostics()).toEqual([]);

      // ONE subscription's PENDING changes, and a flush.
      values.get(PENDING_KEY)?.push({ v: 2 });
      await settle();
      flush();
      expect(app.health().subs.filter((s) => s.pending)).toEqual([]);
      expect(gateStatus(app.health())).toBe("ready");
      expect(arrived.size).toBe(KEYS);
      expect(readout.readout()).toEqual({
        status: "live",
        needsReload: false,
        presentingDown: false,
      });
      expect(diagnostics()).toEqual([]);

      // ONE subscription's ERROR changes, and a flush: the readout degrades and
      // NAMES it, out of 300 healthy siblings.
      values.get(FAILING_KEY)?.fail(new Error("entry boom"));
      await settle();
      flush();
      expect(
        app.health().subs.find((s) => s.name === `items[${FAILING_KEY}]`)?.error
          ?.message,
      ).toMatch(/entry boom/);
      expect(gateStatus(app.health())).toBe("degraded");
      expect(readout.readout()).toEqual({
        status: "degraded",
        stopped: [`items[${FAILING_KEY}]`],
        needsReload: false,
        presentingDown: false,
      });
      // The readout notified once per real change and never for the churn of a
      // re-fold: live, then degraded.
      expect(seen.map((r) => r.status)).toEqual(["live", "degraded"]);
      expect(diagnostics()).toEqual([]);

      readout.dispose();
      dispose();
    });
  });
});
