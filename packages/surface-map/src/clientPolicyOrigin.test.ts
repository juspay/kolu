/**
 * SR11 — surface-map ORIGIN injection, exercised at RUNTIME (codex round-1 F2).
 *
 * `@kolu/surface-map` is the ONE layer where a `{ key }` origin exists: a per-key
 * entry client's builder holds the decoded key, so `connectSurfaceMap` wraps the
 * app's `onClientError` to close `{ key }` over it PER KEY, while the membership
 * `entries` collection (no per-key origin) forwards origin-OMITTED (design §B/§C).
 *
 * This file drives both halves through a REAL served map (`serveSurfaceMap` +
 * `connectSurfaceMap` over `directLink`), modelled on `mapHarness.testlib.ts` and the
 * `armableRegistry` in `mapHarness.test.ts`:
 *   - a per-key ENTRY member's policy fires with `origin: { key }` (the decoded key);
 *   - the membership ENTRIES policy fires with `origin` UNDEFINED.
 */

import { defineSurfaceWithPolicy } from "@kolu/surface/define";
import { directLink } from "@kolu/surface/links/direct";
import type { AnyContractRouter } from "@orpc/contract";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { connectSurfaceMap } from "./client";
import { defineSurfaceMap } from "./define";
import {
  type EntryConnectionState,
  type EntrySession,
  type MapRegistry,
  serveSurfaceMap,
} from "./server";
import {
  A,
  connected,
  type HostKey,
  HostKeySchema,
  identityCodec,
  settle,
  type TestFailure,
  testFailureSchema,
} from "./mapHarness.testlib";

// The app-owned policy union — opaque to the framework; only the interpreter reads it.
type Policy = { kind: "toast"; label: string };
const URGENCY_POLICY: Policy = { kind: "toast", label: "urgency" };
const ENTRIES_POLICY: Policy = { kind: "toast", label: "entries" };

/** A policy-bearing entry surface — its ONE get-only cell declares a client policy, so
 *  a per-key subscription failure routes through the interpreter with `origin: { key }`. */
const policyEntrySurface = defineSurfaceWithPolicy<Policy>()({
  cells: {
    urgency: {
      schema: z.object({ awaiting: z.number() }),
      default: { awaiting: 0 },
      verbs: ["get"],
      client: { onError: URGENCY_POLICY },
    },
  },
});

/** The map, with BOTH policies declared: the entry surface's `urgency` (per-key origin)
 *  AND the membership `entries` collection (origin-free, via `entriesClient`). */
function buildPolicyMap() {
  return defineSurfaceMap({
    key: HostKeySchema,
    entry: policyEntrySurface,
    codec: identityCodec,
    failure: testFailureSchema,
    entriesClient: { onError: ENTRIES_POLICY },
  });
}

/** A minimal `MapRegistry` whose `resolve` can be armed to THROW once for a key —
 *  the membership-fault escape hatch (a copy of `mapHarness.test.ts`'s `armableRegistry`,
 *  which is test-local there). */
function armableRegistry() {
  const entries = new Map<HostKey, EntrySession<"copying", TestFailure>>();
  const listeners = new Set<() => void>();
  let throwOnResolve: HostKey | null = null;
  const fire = () => {
    for (const l of [...listeners]) l();
  };
  const registry: MapRegistry<HostKey, "copying", TestFailure> = {
    members: () => [...entries.keys()],
    has: (k) => entries.has(k),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    resolve: (k) => {
      if (throwOnResolve === k) {
        throwOnResolve = null;
        throw new Error("membership resolve boom");
      }
      return (
        entries.get(k) ?? {
          kind: "fault",
          failure: { cause: "fault", reason: "unknown key" },
          // An unknown key produced no output — `[]` is the honest fact.
          evidence: [],
        }
      );
    },
  };
  return {
    registry,
    addSession(
      k: HostKey,
      link: unknown,
      state: EntryConnectionState<"copying", TestFailure>,
    ) {
      entries.set(k, { kind: "session", link, state });
      fire();
    },
    armResolveThrow(k: HostKey) {
      throwOnResolve = k;
    },
  };
}

/** A stub entry-surface host link the map FORWARDS to (`link.surface.urgency.get`) —
 *  its `urgency` stream REJECTS, so the per-key entry subscription faults for real. */
const brokenHostLink = {
  surface: {
    urgency: {
      // biome-ignore lint/suspicious/noExplicitAny: rejected thunk stands in for a failing forwarded stream.
      get: () => Promise.reject(new Error("urgency boom")) as any,
    },
  },
};

function connectPolicyMap(
  onClientError: (
    policy: unknown,
    err: Error,
    origin?: { key: HostKey },
  ) => void,
) {
  const map = buildPolicyMap();
  const reg = armableRegistry();
  const served = serveSurfaceMap(map, reg.registry);
  const mapLink = directLink<AnyContractRouter>(served.router as never);
  const client = connectSurfaceMap(map, mapLink, { onClientError });
  return { map, client, ...reg };
}

describe("SR11 surface-map origin — the per-key { key } vs origin-free membership split", () => {
  it("(6a) a per-key ENTRY member's policy dispatches with origin { key } (the decoded key)", async () => {
    const onClientError =
      vi.fn<(policy: unknown, err: Error, origin?: { key: HostKey }) => void>();
    await createRoot(async (dispose) => {
      const { client, addSession } = connectPolicyMap(onClientError);
      // A is a live member whose forwarded `urgency` stream rejects.
      addSession(A, brokenHostLink, connected(0));
      // Open A's per-key entry cell — its subscription forwards to the broken host
      // link and faults, routing the declared policy through the { key }-wrapped interpreter.
      client.entry(A).cells.urgency.use();
      await settle();
      expect(onClientError).toHaveBeenCalledTimes(1);
      const [policy, err, origin] = onClientError.mock.calls[0]!;
      expect(policy).toBe(URGENCY_POLICY);
      expect((err as Error).message).toMatch(/urgency boom/);
      // The ORIGIN carries the decoded key — reachable only where the key exists.
      expect(origin).toEqual({ key: A });
      dispose();
    });
  });

  it("(6b) the membership ENTRIES policy dispatches with origin OMITTED (undefined)", async () => {
    const onClientError =
      vi.fn<(policy: unknown, err: Error, origin?: { key: HostKey }) => void>();
    await createRoot(async (dispose) => {
      const { client, addSession, armResolveThrow } =
        connectPolicyMap(onClientError);
      // A healthy live member (its host link is never forwarded here — we fault the
      // MEMBERSHIP status stream, not the entry surface).
      addSession(A, brokenHostLink, connected(0));
      const view = client.entries.use();
      await settle();
      // Arm A's next resolve() to throw, then read its status lazily → the membership
      // status stream faults for real, through the entries whole-collection dedup slot.
      armResolveThrow(A);
      view.byKey(A);
      await settle();
      expect(onClientError).toHaveBeenCalledTimes(1);
      const [policy, err, origin] = onClientError.mock.calls[0]!;
      expect(policy).toBe(ENTRIES_POLICY);
      expect((err as Error).message).toMatch(/membership resolve boom/);
      // The membership authority has NO per-key origin — it fires origin-free.
      expect(origin).toBeUndefined();
      dispose();
    });
  });
});

describe("SR11 surface-map fail-fast — a membership policy with no interpreter CRASHES at connect", () => {
  it("(2-map) connectSurfaceMap THROWS when the map declares entriesClient but no onClientError was threaded", () => {
    const map = buildPolicyMap();
    const reg = armableRegistry();
    const served = serveSurfaceMap(map, reg.registry);
    const mapLink = directLink<AnyContractRouter>(served.router as never);
    createRoot((dispose) => {
      expect(() =>
        // No `onClientError` — the membership `entries` policy would route nowhere, so
        // the eager `entriesClient` build fails fast at connect time.
        connectSurfaceMap(map, mapLink),
      ).toThrow(/no `onClientError` interpreter was threaded/);
      dispose();
    });
  });
});
