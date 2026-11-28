/** ONE WORK'S RECORD, READ AS A SNAPSHOT — the reading every fold over a
 *  whole work is built on.
 *
 *  Its own module, and not part of `./workFacts.ts`, because BOTH sides read
 *  it: a face builds one for the work it draws, and `./useWorks.ts` builds
 *  the shared one every whole-collection reading folds. `workFacts` reads
 *  `useWorks`, so the record living there would make the two a cycle.
 *
 *  A fold over a work (where it stands, how long it waited on you, its
 *  stages, its timeline, who it waits on) is a total function of the record,
 *  so read off the store it subscribes every leaf it touches: two hundred
 *  and more nodes on ONE scope for a work with a long timeline, and one such
 *  scope per fold per face.
 *
 *  This splits that one scope the way the record itself is split. Each event
 *  and each decision is read by a memo of ITS OWN (`deep`, which subscribes
 *  a record's container and deep witness rather than every path under it),
 *  and their answers are joined in CHUNKS (`@kolu/surface/solid`): no scope
 *  holds more than a chunk of rows, so a timeline of any length stays under
 *  the 200-source judge, each row's scope is the handful that row holds,
 *  and every fold downstream carries ONE — the whole record is subscribed
 *  once per face however many folds read it.
 *
 *  An unmoved row is handed back the SAME object (`deep` copies nothing it
 *  does not have to), so a row that did not move republishes nothing and
 *  this memo re-runs only when the record really moved.
 *
 *  The value is a plain snapshot, not the store's proxy: reads off it track
 *  nothing, which is the point. A face that wants one leaf — a title, the
 *  state's arm — reads the proxy, which is one node.
 *
 *  A work that is no longer in the mirror reads `undefined`, for the shared
 *  per-work reading every whole-collection fold is built on: a row outlives
 *  its record by the moment between the record leaving and the id list being
 *  folded again, and the rows of a work that has left must not throw. */

import type { Work } from "kolu-work";
import { type Accessor, createMemo, deep, mapArray } from "solid-js";
import { joinRows } from "@kolu/surface/solid";

/** The rows of a work that is no longer in the mirror: none of anything. */
const GONE: ReadonlyArray<never> = [];

export function createWorkRecord(work: Accessor<Work>): Accessor<Work>;
export function createWorkRecord(
  work: Accessor<Work | undefined>,
): Accessor<Work | undefined>;
export function createWorkRecord(
  work: Accessor<Work | undefined>,
): Accessor<Work | undefined> {
  // THE ROWS, JOINED IN CHUNKS ({@link joinRows}): a memo that read one row
  // per event would be as wide as the timeline is long — one source per
  // event and per decision, past the 200-source judge at about 195 of them
  // on ONE work, which a work a month old reaches (only agent-state events
  // are capped, `AGENT_STATES_KEPT`). The join is two levels instead, so no
  // scope here holds more than a chunk's worth however long the timeline
  // grows. Rows are keyed by POSITION, which is what a timeline is: events
  // and decisions are appended, so an existing row keeps its chunk.
  const events = joinRows(
    "workRecord.events",
    mapArray(
      () => work()?.events ?? GONE,
      (event) => createMemo(() => deep(event), { name: "workRecord.event" }),
      { name: "workRecord.eventRows" },
    ),
  );
  const decisions = joinRows(
    "workRecord.decisions",
    mapArray(
      () => work()?.decisions ?? GONE,
      (decision) =>
        createMemo(() => deep(decision), { name: "workRecord.decision" }),
      { name: "workRecord.decisionRows" },
    ),
  );
  return createMemo(
    () => {
      const one = work();
      if (one === undefined) return undefined;
      return {
        key: deep(one.key),
        title: one.title,
        startedAt: one.startedAt,
        decisions: decisions(),
        events: events(),
        state: deep(one.state),
        worktree: deep(one.worktree),
      };
    },
    { name: "workRecord" },
  );
}
