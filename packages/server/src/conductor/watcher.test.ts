/**
 * THE PARENT WALK — the half of the conductor's watcher that answers "which
 * piece of work is this terminal part of".
 *
 * The rest of the watcher is standing subscriptions over two padis, and what
 * it does with them is covered where the conversation's own rules are
 * (`kolu-conductor`'s `watching.ts`). What is HERE is the one derivation that
 * reads padi's records directly: a watched terminal's `child-of` edges
 * followed to the top-level terminal they end at, which is what makes a
 * planner and the implementor it split off ONE thing going on rather than two
 * (`walkRoot`), and the one rule that names a terminal (`recordName`).
 *
 * Pure, so the records are REAL ones — composed through padi's own
 * `composeTerminalMetadata`, the join that produces every record this watcher
 * ever reads. A hand-built object cast to the record type would make this file
 * prove something about a shape it invented.
 */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import {
  composeTerminalMetadata,
  LOCAL_LOCATION,
} from "@kolu/padi-client/vocab";
import { describe, expect, it } from "vitest";
import { recordName, walkRoot } from "./watcher.ts";

const HOST = "local";
const PLANNER = "11111111-1111-4111-8111-111111111111";
const SPLIT = "22222222-2222-4222-8222-222222222222";
const DEEPER = "33333333-3333-4333-8333-333333333333";

/** One live record, the way padi composes one: the authored half (where it is,
 *  what it is called, the parent it hangs off) joined with an observation. */
const record = (over: { parentId?: string; intent?: string }): PadiTerminal =>
  composeTerminalMetadata(
    {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
      ...(over.parentId === undefined ? {} : { parentId: over.parentId }),
      ...(over.intent === undefined ? {} : { intent: over.intent }),
    },
    {
      cwd: "/tmp",
      git: { kind: "none" },
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
    },
  );

const records = (
  entries: Record<string, { parentId?: string; intent?: string }>,
): ReadonlyMap<string, PadiTerminal> =>
  new Map(Object.entries(entries).map(([id, over]) => [id, record(over)]));

describe("which piece of work a watched terminal is in", () => {
  it("answers the PARENT for a split, by fleet ref and by its name", () => {
    // The case the whole walk exists for: the Conductor is watching an
    // implementor it split off a planner, and the thing going on is the
    // planner's — one piece of work with two terminals in it.
    const walk = walkRoot(
      HOST,
      SPLIT,
      records({
        [PLANNER]: { intent: "plan the cutover" },
        [SPLIT]: { parentId: PLANNER, intent: "write the migration" },
      }),
    );
    expect(walk.root).toEqual({
      ref: `${HOST}/${PLANNER}`,
      name: "plan the cutover",
    });
    // Nothing further to subscribe: the chain is fully read.
    expect(walk.missing).toBeNull();
  });

  it("follows the edges all the way UP, not one step", () => {
    const walk = walkRoot(
      HOST,
      DEEPER,
      records({
        [PLANNER]: { intent: "plan the cutover" },
        [SPLIT]: { parentId: PLANNER },
        [DEEPER]: { parentId: SPLIT },
      }),
    );
    expect(walk.root.ref).toBe(`${HOST}/${PLANNER}`);
  });

  it("makes a top-level terminal its OWN root", () => {
    const walk = walkRoot(
      HOST,
      PLANNER,
      records({ [PLANNER]: { intent: "plan the cutover" } }),
    );
    expect(walk.root).toEqual({
      ref: `${HOST}/${PLANNER}`,
      name: "plan the cutover",
    });
    expect(walk.missing).toBeNull();
  });

  it("stops at the first ancestor it has not read, and NAMES it to subscribe", () => {
    // The ordinary first frame: the split's record has arrived and its
    // parent's has not. The honest answer is the furthest terminal that can be
    // named — a split whose parent is known is not a piece of work of its own
    // — and the id whose record would say more.
    const walk = walkRoot(
      HOST,
      SPLIT,
      records({ [SPLIT]: { parentId: PLANNER } }),
    );
    expect(walk.root).toEqual({ ref: `${HOST}/${PLANNER}`, name: "" });
    expect(walk.missing).toBe(PLANNER);
  });

  it("asks for NOTHING when the watched terminal's own record is missing", () => {
    // It is already on the leg — the record simply has not landed yet. Asking
    // for it again would be the watcher subscribing a terminal twice.
    const walk = walkRoot(HOST, SPLIT, records({}));
    expect(walk.root).toEqual({ ref: `${HOST}/${SPLIT}`, name: "" });
    expect(walk.missing).toBeNull();
  });

  it("does not spin on a record whose parent edges close a loop", () => {
    // padi refuses a cycle when the edge is WRITTEN, so this cannot arrive off
    // a live host — but a walk that span forever on one would take the whole
    // watch with it, and that is not a trade worth leaving open.
    const walk = walkRoot(
      HOST,
      SPLIT,
      records({
        [SPLIT]: { parentId: PLANNER },
        [PLANNER]: { parentId: SPLIT, intent: "plan the cutover" },
      }),
    );
    expect(walk.root.ref).toBe(`${HOST}/${PLANNER}`);
    expect(walk.missing).toBeNull();
  });
});

describe("what a terminal is called", () => {
  it("is the name a person gave it", () => {
    expect(recordName(record({ intent: "plan the cutover" }))).toBe(
      "plan the cutover",
    );
  });

  it("is EMPTY when nothing is known, rather than invented", () => {
    // The conversation keeps whatever its entry already remembered; a watcher
    // that made something up would overwrite it.
    expect(recordName(record({}))).toBe("");
    expect(recordName(undefined)).toBe("");
  });
});
