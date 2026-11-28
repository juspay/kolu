/**
 * THE MEMBERSHIP AXIS AT POOL SIZE — 300 members in one map.
 *
 * The membership collection's `keys()` hands back a Solid STORE-PROXY array, and
 * walking one is a reactive read PER INDEX. Every membership question in this
 * client walked it: `foldState` asked `keys().includes(enc)` before reading a
 * status, `membershipIdOf` asked it again on every re-key, the external
 * `entries.use().keys()` mapped it to decode, and the departed-member prune
 * spread it. So one `state()` read — a per-key chip's whole job — subscribed its
 * scope to every member in the pool, and a scope that folded over the pool was
 * quadratic in it. Solid's 200-source `WIDE_SCOPE_DEPS` judge caught that at ~65
 * hosts folded, or ~199 members for one lookup; a host pool has no cap.
 *
 * The keyset is folded ONCE here now, in chunks, into a plain array — so every
 * membership question costs one source and answers the same thing.
 *
 * Driven through the REAL vertical slice (`serveSurfaceMap` + a real registry +
 * `connectSurfaceMap` over a direct dispatch), because the proxy array is
 * exactly what a mock would flatten away.
 */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Schema } from "effect";
import { createMemo, createRoot, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import {
  A,
  connected,
  disconnected,
  type HostKey,
  HostKeySchema,
  makeEntry,
  settle,
  setup,
} from "./mapHarness.testlib";

/** Past the bar on both shapes: one `.includes` over 300 proxy slots is 301
 *  sources on its own, and the pool is never capped. */
const MEMBERS = 300;
const decodeHostKey = Schema.decodeUnknownSync(HostKeySchema);
const hosts = Array.from({ length: MEMBERS }, (_, n) =>
  decodeHostKey(`host-${n}`),
);
/** The LAST member — `.includes` short-circuits at the hit, so the widest
 *  honest lookup is the one that walks the whole list. */
const LAST = hosts[MEMBERS - 1] as HostKey;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

describe("the membership axis", () => {
  it("answers every membership question over 300 members with no wide scope", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, setState, remove } = setup();
      // ONE served entry surface behind every member: the registry maps a key to
      // a dispatch, and what this test measures is the MEMBERSHIP keyset, not 300
      // independent entry servers.
      const entry = makeEntry({ awaiting: 0, awaitingIds: [] });
      for (const host of hosts) addSession(host, entry.dispatch, connected(0));

      // The three membership questions a consumer asks, each in its OWN scope so
      // the judge names the one that is wide.
      const state = createMemo(() => client.entry(LAST).state(), {
        name: "chip.state",
      });
      const absent = createMemo(() => client.entry(A).state(), {
        name: "chip.absent",
      });
      const members = createMemo(() => client.entries.use().keys(), {
        name: "strip.members",
        equals: false,
      });

      await settle();
      flush();

      expect(members()).toHaveLength(MEMBERS);
      expect(members().map(String)).toContain(String(LAST));
      expect(state().kind).toBe("connected");
      // A key the registry never had is still answered, and answered honestly.
      expect(absent()).toEqual({ kind: "not-a-member" });
      expect(diagnostics()).toEqual([]);

      // ONE member's status changes, and a flush: its own chip re-reads, the
      // keyset does not move, and nothing goes wide.
      setState(LAST, disconnected());
      await settle();
      flush();
      expect(state().kind).toBe("warming");
      expect(members()).toHaveLength(MEMBERS);
      expect(diagnostics()).toEqual([]);

      // MEMBERSHIP itself moves: the departed member leaves the keyset and its
      // own lookup reads `not-a-member`.
      remove(LAST);
      await settle();
      flush();
      expect(members()).toHaveLength(MEMBERS - 1);
      expect(members().map(String)).not.toContain(String(LAST));
      expect(state()).toEqual({ kind: "not-a-member" });
      expect(diagnostics()).toEqual([]);

      dispose();
    });
  });
});
