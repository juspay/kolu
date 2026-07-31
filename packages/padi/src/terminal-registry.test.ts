/**
 * `requireMutableTerminal` — the record-level "PARKED is IMMUTABLE" invariant
 * (split-restore FIX 3).
 *
 * A PARKED record is a restore-card placeholder standing in for a saved active
 * terminal until `session.restore` consumes it (the parked→active flip). A client
 * chrome mutation — `chrome.setParent` / `setSubPanel` / `setCanvasLayout` /
 * `setTheme` / `setIntent` / `setRightPanel`, all routed through
 * `requireMutableTerminal` in `servePadi.ts` — targeting one is a STALE write from
 * a supervised restart's drain window (the client's list-driven reconcile promoting
 * a split's sub the drain just removed). It MUST reject: silently un-parenting the
 * parked sub would make the split restore as an orphaned top-level. This closes the
 * hole at the RECORD level — timing-independent, not a restart-in-flight gate.
 *
 * The ACTIVE and SLEEPING arms stay MUTABLE (a chrome edit on a dormant tile is
 * valid); the read/query guard `requireTerminal` keeps ACCEPTING parked.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { ORPCError } from "@orpc/server";
import { afterEach, describe, expect, it } from "vitest";
import { caught, seedActive, snapshot } from "./servePadi.testlib.ts";
import {
  isPaintableParent,
  isPermanentlyUnpaintableParent,
  registerTerminal,
  requireFlatParentEdge,
  requireMutableTerminal,
  requireTerminal,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { LOCAL_LOCATION } from "./vocab.ts";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;
const ROOT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TerminalId;
const MID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as TerminalId;
const LEAF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as TerminalId;
const FRESH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" as TerminalId;

function seedSleeping(): void {
  registerTerminal(ID, {
    info: { id: ID, pid: 1 },
    meta: {
      state: "sleeping",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      sleptAt: 1,
    },
    snapshot: snapshot(),
  });
}

function seedParked(): void {
  registerTerminal(ID, {
    info: { id: ID, pid: 1 },
    meta: {
      state: "parked",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      parkedAt: 1,
    },
    snapshot: snapshot(),
  });
}

afterEach(() => {
  for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
});

describe("requireMutableTerminal — parked records are immutable", () => {
  it("REJECTS a mutation targeting a PARKED record (typed NOT_FOUND)", () => {
    seedParked();
    const err = caught(() => requireMutableTerminal(ID));
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
    // ...yet the read/query guard STILL accepts it — the restore card reads it.
    expect(requireTerminal(ID).meta.state).toBe("parked");
  });

  it("ALLOWS a mutation on a live ACTIVE record", () => {
    seedActive(ID);
    expect(requireMutableTerminal(ID).meta.state).toBe("active");
  });

  it("ALLOWS a mutation on a SLEEPING record (chrome edit on a dormant tile is valid)", () => {
    seedSleeping();
    expect(requireMutableTerminal(ID).meta.state).toBe("sleeping");
  });

  it("REJECTS an absent id (typed NOT_FOUND)", () => {
    const err = caught(() => requireMutableTerminal(ID));
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });
});

/** The ONE parent-edge rule, tested where it lives. Every clause — self-edge,
 *  absent / parked / nested parent, non-leaf child — is a case here rather than an
 *  end-to-end handler assertion, so the suite's shape matches the rule's shape
 *  (#2059). `servePadi.nestedParent.test.ts` keeps only the DOOR-level facts. */
describe("requireFlatParentEdge — the one parent-edge rule (#2059)", () => {
  it("ACCEPTS a fresh child under a top-level tile (the ordinary split)", () => {
    seedActive(ROOT);
    expect(caught(() => requireFlatParentEdge(FRESH, ROOT))).toBeUndefined();
  });

  it("REJECTS a self-parent", () => {
    seedActive(ROOT);
    const err = caught(() => requireFlatParentEdge(ROOT, ROOT));
    expect(err).toBeInstanceOf(ORPCError);
    const orpc = err as ORPCError<string, unknown>;
    expect(orpc.code).toBe("BAD_REQUEST");
    expect(orpc.message).toContain(ROOT);
  });

  it("REJECTS a parent that is itself a split child, naming the ROOT tile", () => {
    seedActive(ROOT);
    seedActive(MID, ROOT);
    seedActive(LEAF, MID);

    // A multi-hop chain: the message must name the top of it, not the first hop.
    const err = caught(() => requireFlatParentEdge(FRESH, LEAF));
    expect(err).toBeInstanceOf(ORPCError);
    const orpc = err as ORPCError<string, unknown>;
    expect(orpc.code).toBe("BAD_REQUEST");
    expect(orpc.message).toContain(LEAF);
    expect(orpc.message).toContain(ROOT);
  });

  it("REJECTS an ABSENT parent with the typed NOT_FOUND fault", () => {
    // Presence is the rule's own floor — NOT a guard the caller must remember
    // one layer up, so an in-process create can't mint a dangling parent edge.
    const err = caught(() => requireFlatParentEdge(FRESH, "nope"));
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("REJECTS a PARKED parent as NOT_FOUND — same answer an absent id gets", () => {
    // A parked record is an invisible restore-card placeholder:
    // `requireMutableTerminal` already makes every client mutation read it as
    // `terminalNotFound`, so naming it in a BAD_REQUEST would leak a record the
    // same client is told does not exist.
    seedParked();
    const err = caught(() => requireFlatParentEdge(FRESH, ID));
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("REJECTS a SLEEPING parent — a dormant tile paints no splits at all", () => {
    // `TerminalContent` swaps its whole body for `DormantTileBody` behind
    // `<Show when={isLive()}>`, and the split `Resizable` lives INSIDE that
    // branch — so a pane hung off a dormant tile is not painted, top-level or
    // not. The create door happened to reject this via `requireActiveTerminal`;
    // `chrome.setParent` validates only the SUBJECT, so without this clause it
    // let a caller mint exactly the invisible live pane #2059 is about.
    seedSleeping();
    const err = caught(() => requireFlatParentEdge(FRESH, ID));
    expect(err).toBeInstanceOf(ORPCError);
    const orpc = err as ORPCError<string, unknown>;
    expect(orpc.code).toBe("BAD_REQUEST");
    expect(orpc.message).toMatch(/dormant/i);
  });

  it("REJECTS a non-leaf child — the move would push its splits to depth 2", () => {
    seedActive(ROOT);
    seedActive(MID, ROOT);
    seedActive(LEAF);

    const err = caught(() => requireFlatParentEdge(ROOT, LEAF));
    expect(err).toBeInstanceOf(ORPCError);
    const orpc = err as ORPCError<string, unknown>;
    expect(orpc.code).toBe("BAD_REQUEST");
    expect(orpc.message).toContain(MID);
  });

  it("CRASHES LOUDLY on a cyclic ancestor chain rather than naming a non-root", () => {
    // Only reachable through the unfenced restore door or a hand-edited blob.
    // Returning "the first revisited id" used to advise parenting against the
    // very id just rejected — unfollowable. A corrupt graph must surface.
    seedActive(MID, LEAF);
    seedActive(LEAF, MID);

    const err = caught(() => requireFlatParentEdge(FRESH, MID));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ORPCError);
    expect((err as Error).message).toMatch(/cycle/i);
  });
});

/** The REPAIR counterpart of the reject rule. The two doors want different
 *  questions answered — "would this paint NOW" (refuse if not) versus "will it
 *  EVER" (promote if not) — and the difference is exactly the dormant arm: a
 *  sleeping tile repaints its splits on wake, so a restore/adopt sweep that
 *  promoted its children would destroy the user's arrangement for good. */
describe("isPermanentlyUnpaintableParent — the repair rule (#2059)", () => {
  it("is FALSE for a live top-level tile (nothing to repair)", () => {
    seedActive(ROOT);
    expect(isPermanentlyUnpaintableParent(ROOT)).toBe(false);
  });

  it("is FALSE for a DORMANT top-level tile — wake repaints its splits", () => {
    seedSleeping();
    expect(isPaintableParent(ID)).toBe(false); // not paintable NOW…
    expect(isPermanentlyUnpaintableParent(ID)).toBe(false); // …but not forever
  });

  it("is TRUE for a parent that is itself a split child — no wake fixes depth 2", () => {
    seedActive(ROOT);
    seedActive(MID, ROOT);
    expect(isPermanentlyUnpaintableParent(MID)).toBe(true);
  });

  it("is TRUE for a DORMANT parent that is itself a split child", () => {
    // The dormant carve-out must not swallow the nested case: waking a split
    // does not make the canvas paint splits OF that split.
    seedActive(ROOT);
    registerTerminal(MID, {
      info: { id: MID, pid: 1 },
      meta: {
        state: "sleeping",
        location: LOCAL_LOCATION,
        lastActivityAt: 1,
        sleptAt: 1,
        parentId: ROOT,
      },
      snapshot: snapshot(),
    });
    expect(isPermanentlyUnpaintableParent(MID)).toBe(true);
  });

  it("is TRUE for a parked placeholder and for an absent id", () => {
    seedParked();
    expect(isPermanentlyUnpaintableParent(ID)).toBe(true);
    expect(isPermanentlyUnpaintableParent("nope")).toBe(true);
  });
});
