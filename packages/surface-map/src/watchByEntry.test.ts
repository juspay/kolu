/**
 * `watchByEntry` — the eager per-member attention watcher, pinned end-to-end
 * over the in-process map harness. Proves: EAGER subscription (a background
 * member is watched without ever being activated), raise detection as a pure
 * SET-DIFF over `updated` `{prev, next}` pairs (a first frame never raises; a new
 * id raises once; a held id never re-raises; a cleared-then-re-raised id raises
 * again), and point reads that mark `live`/`stale` on link liveness.
 */

import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { watchByEntry } from "./client";
import {
  A,
  B,
  connected,
  failed,
  type HostKey,
  makeEntry,
  settle,
  setup,
} from "./mapHarness.testlib";

interface Raise {
  host: HostKey;
  ids: string[];
}

describe("watchByEntry — eager attention over entries membership", () => {
  it("watches a background member EAGERLY (never activated) and raises new ids", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      const raises: Raise[] = [];
      const att = watchByEntry(
        client,
        (e) => e.cells.urgency,
        (v) => [...v.awaitingIds],
        (host, raised) => raises.push({ host, ids: [...raised] }),
      );

      const entry = makeEntry({ awaiting: 0, awaitingIds: [] });
      addSession(A, entry.link, connected(0));
      await settle();

      // EAGER: the member is watched with NO activation. A first frame is a
      // value, not a change — no raise. The point read reflects it, live.
      expect(raises).toEqual([]);
      expect(att.get(A)).toEqual({
        kind: "live",
        value: { awaiting: 0, awaitingIds: [] },
      });

      // A terminal starts awaiting → exactly one raise for the new id.
      entry.setUrgency({ awaiting: 1, awaitingIds: ["t1"] });
      await settle();
      expect(raises).toEqual([{ host: A, ids: ["t1"] }]);

      // A second id joins → the set-diff raises ONLY the new one (t1 is held).
      entry.setUrgency({ awaiting: 2, awaitingIds: ["t1", "t2"] });
      await settle();
      expect(raises).toEqual([
        { host: A, ids: ["t1"] },
        { host: A, ids: ["t2"] },
      ]);

      dispose();
    });
  });

  it("a held id never re-raises; a cleared-then-re-raised id raises again", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      const raises: Raise[] = [];
      // The watcher runs via its per-key effects — no need to bind the handle.
      watchByEntry(
        client,
        (e) => e.cells.urgency,
        (v) => [...v.awaitingIds],
        (host, raised) => raises.push({ host, ids: [...raised] }),
      );
      const entry = makeEntry({ awaiting: 0, awaitingIds: [] });
      addSession(A, entry.link, connected(0));
      await settle();

      entry.setUrgency({ awaiting: 1, awaitingIds: ["t1"] });
      await settle();
      // A no-op re-publish of the SAME ids — no change, no raise (change-iff-fired).
      entry.setUrgency({ awaiting: 1, awaitingIds: ["t1"] });
      await settle();
      // Cleared, then the same id raises again — it is genuinely new relative to
      // the empty set, so it raises (not suppressed by a stale per-window memory).
      entry.setUrgency({ awaiting: 0, awaitingIds: [] });
      await settle();
      entry.setUrgency({ awaiting: 1, awaitingIds: ["t1"] });
      await settle();

      expect(raises).toEqual([
        { host: A, ids: ["t1"] },
        { host: A, ids: ["t1"] },
      ]);
      dispose();
    });
  });

  it("get() marks a member with a down link STALE, keeping its last value", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, setState } = setup();
      const att = watchByEntry(
        client,
        (e) => e.cells.urgency,
        (v) => [...v.awaitingIds],
        () => {},
      );
      const entry = makeEntry({ awaiting: 1, awaitingIds: ["t1"] });
      addSession(A, entry.link, connected(0));
      await settle();
      expect(att.get(A)?.kind).toBe("live");

      // The host's link goes down → its chip must DIM, not lie: stale, last value held.
      setState(
        A,
        failed("link died", { cause: "link-failed", reason: "link died" }),
      );
      await settle();
      const stale = att.get(A);
      expect(stale?.kind).toBe("stale");
      expect(stale?.value).toEqual({ awaiting: 1, awaitingIds: ["t1"] });

      dispose();
    });
  });

  it("a non-member key reads undefined (no total(), no owner created)", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      const att = watchByEntry(
        client,
        (e) => e.cells.urgency,
        (v) => [...v.awaitingIds],
        () => {},
      );
      addSession(
        A,
        makeEntry({ awaiting: 0, awaitingIds: [] }).link,
        connected(0),
      );
      await settle();
      expect(att.get(B)).toBeUndefined(); // B never joined
      dispose();
    });
  });
});
