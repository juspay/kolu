/**
 * WHAT A HOST'S FRAMES MEAN — the whole of the watch that is a function, with
 * no stream anywhere in it.
 *
 * Two halves: the one derivation that reads padi's records directly (a watched
 * terminal's `child-of` edges followed to the top-level terminal they end at,
 * which is what makes a planner and the implementor it split off ONE thing
 * going on — `walkRoot` — and the one rule that names a terminal), and the
 * reading itself: what padi's urgency lists, its roster and those records say
 * each watched terminal is DOING.
 *
 * The records are REAL ones — composed through padi's own
 * `composeTerminalMetadata`, the join that produces every record this watch
 * ever reads. A hand-built object cast to the record type would make this file
 * prove something about a shape it invented.
 */

import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import {
  composeTerminalMetadata,
  LOCAL_LOCATION,
} from "@kolu/padi-client/vocab";
import { type AgentPresence, agentPresence } from "kolu-agents/vocab";
import { describe, expect, it } from "vitest";
import {
  type HostReading,
  readingsOf,
  recordName,
  walkRoot,
} from "./readings.ts";

const HOST = "local";
const PLANNER = "11111111-1111-4111-8111-111111111111";
const SPLIT = "22222222-2222-4222-8222-222222222222";
const DEEPER = "33333333-3333-4333-8333-333333333333";

interface Over {
  parentId?: string;
  intent?: string;
  asleep?: boolean;
  agent?: boolean;
  shellInFront?: boolean;
  /** padi's PRESENCE for an agent that is in the foreground with no session
   *  yet — the record a terminal has between the agent program appearing and
   *  its transcript landing. Mutually exclusive with `agent`, which is an
   *  agent that HAS a session. */
  presence?: AgentPresence["state"];
}

/** One record, the way padi composes one: the authored half (where it is, what
 *  it is called, the parent it hangs off) joined with an observation. */
const record = (over: Over): PadiTerminal =>
  composeTerminalMetadata(
    {
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
      ...(over.parentId === undefined ? {} : { parentId: over.parentId }),
      ...(over.intent === undefined ? {} : { intent: over.intent }),
      ...(over.asleep === true
        ? ({ state: "sleeping", sleptAt: 1 } as const)
        : ({ state: "active" } as const)),
    },
    {
      cwd: "/tmp",
      git: { kind: "none" },
      pr: { kind: "pending" },
      // The PRESENCE arm is built by the registry's own constructor, so a
      // field added to that shape reaches this fixture rather than letting it
      // compose a record padi could never publish.
      agent:
        over.presence !== undefined
          ? agentPresence("claude-code", over.presence, null)
          : over.agent === true
            ? {
                kind: "claude-code",
                state: "thinking",
                sessionId: "ses-A",
                model: null,
                summary: null,
                taskProgress: null,
                workflow: null,
                contextTokens: null,
                startedAt: null,
              }
            : null,
      foreground:
        over.shellInFront === undefined
          ? null
          : { name: "bash", title: null, shell: over.shellInFront },
      ports: { status: "unknown" },
    },
  );

const records = (
  entries: Record<string, Over>,
): ReadonlyMap<string, PadiTerminal> =>
  new Map(Object.entries(entries).map(([id, over]) => [id, record(over)]));

const QUIET: PadiUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
};

/** One host's last word, as a leg accumulates it: the watched ids, padi's
 *  fold, the roster (every watched id, unless the case says otherwise) and the
 *  records read on the leg. */
const reading = (over: {
  watched: readonly string[];
  urgency?: Partial<PadiUrgency>;
  roster?: readonly string[];
  records?: Record<string, Over>;
}): HostReading => ({
  host: HOST,
  hostName: "this machine",
  watched: over.watched,
  urgency: { ...QUIET, ...over.urgency },
  keys: new Set(over.roster ?? over.watched),
  records: records(over.records ?? {}),
});

describe("which piece of work a watched terminal is in", () => {
  it("answers the PARENT for a split, by fleet ref and by its name", () => {
    // The case the whole walk exists for: the Conductor is watching an
    // implementor it split off a planner, and the thing going on is the
    // planner's — one piece of work with two terminals in it.
    expect(
      walkRoot(
        HOST,
        SPLIT,
        records({
          [PLANNER]: { intent: "plan the cutover" },
          [SPLIT]: { parentId: PLANNER, intent: "write the migration" },
        }),
      ),
    ).toEqual({ ref: `${HOST}/${PLANNER}`, name: "plan the cutover" });
  });

  it("follows the edges all the way UP, not one step", () => {
    expect(
      walkRoot(
        HOST,
        DEEPER,
        records({
          [PLANNER]: { intent: "plan the cutover" },
          [SPLIT]: { parentId: PLANNER },
          [DEEPER]: { parentId: SPLIT },
        }),
      ).ref,
    ).toBe(`${HOST}/${PLANNER}`);
  });

  it("makes a top-level terminal its OWN root", () => {
    expect(
      walkRoot(HOST, PLANNER, records({ [PLANNER]: { intent: "plan it" } })),
    ).toEqual({ ref: `${HOST}/${PLANNER}`, name: "plan it" });
  });

  it("stops at the first ancestor it has not read, and names THAT one", () => {
    // The ordinary first frame: the split's record has arrived and its
    // parent's has not. The honest answer is the furthest terminal that can be
    // named — a split whose parent is known is not a piece of work of its own
    // — and its name is empty rather than invented. The lineage subscription
    // is already open on it, so the next frame walks further.
    expect(
      walkRoot(HOST, SPLIT, records({ [SPLIT]: { parentId: PLANNER } })),
    ).toEqual({ ref: `${HOST}/${PLANNER}`, name: "" });
  });

  it("is ITSELF when its own record has not landed yet", () => {
    expect(walkRoot(HOST, SPLIT, records({}))).toEqual({
      ref: `${HOST}/${SPLIT}`,
      name: "",
    });
  });

  it("does not spin on a record whose parent edges close a loop", () => {
    // padi refuses a cycle when the edge is WRITTEN, so this cannot arrive off
    // a live host — but a walk that span forever on one would take the whole
    // watch with it, and that is not a trade worth leaving open.
    expect(
      walkRoot(
        HOST,
        SPLIT,
        records({
          [SPLIT]: { parentId: PLANNER },
          [PLANNER]: { parentId: SPLIT, intent: "plan the cutover" },
        }),
      ).ref,
    ).toBe(`${HOST}/${PLANNER}`);
  });
});

describe("what a terminal is called", () => {
  it("is the name a person gave it", () => {
    expect(recordName(record({ intent: "plan the cutover" }))).toBe(
      "plan the cutover",
    );
  });

  it("is EMPTY when nothing is known, rather than invented", () => {
    // The conversation keeps whatever its entry already remembered; a reading
    // that made something up would overwrite it.
    expect(recordName(record({}))).toBe("");
    expect(recordName(undefined)).toBe("");
  });
});

describe("what a host's frames say about each watched terminal", () => {
  it("is GONE when the host's roster no longer has it", () => {
    const seen = readingsOf(reading({ watched: [SPLIT], roster: [] }));
    expect(seen.map((one) => one.level)).toEqual(["gone"]);
    expect(seen[0]?.ref).toBe(`${HOST}/${SPLIT}`);
    expect(seen[0]?.hostName).toBe("this machine");
  });

  it("is ASLEEP for a terminal padi still lists with its PTY released", () => {
    // The one reading that never rings on its own: a slept terminal has no
    // agent in it, so it is in none of the four lists — and "no agent" must
    // not read as a shell that just finished something.
    expect(
      readingsOf(
        reading({
          watched: [SPLIT],
          records: { [SPLIT]: { asleep: true } },
        }),
      ).map((one) => one.level),
    ).toEqual(["asleep"]);
  });

  it("takes ASKING and STOPPED straight off padi's own two lists", () => {
    expect(
      readingsOf(
        reading({
          watched: [SPLIT, PLANNER],
          urgency: { awaitingIds: [SPLIT], finishedIds: [PLANNER] },
          records: { [SPLIT]: {}, [PLANNER]: {} },
        }),
      ).map((one) => one.level),
    ).toEqual(["asking", "stopped"]);
  });

  it("counts a LINGERING agent as still working", () => {
    // padi splits a waiting agent into "lingering" and "finished" on its own
    // quiet rule, and only the second half is the end of a turn.
    expect(
      readingsOf(
        reading({
          watched: [SPLIT, PLANNER],
          urgency: { workingIds: [SPLIT], lingerIds: [PLANNER] },
          records: { [SPLIT]: {}, [PLANNER]: {} },
        }),
      ).map((one) => one.level),
    ).toEqual(["working", "working"]);
  });

  it("is a SHELL when no agent is in it, and REPORTS what is in front of it", () => {
    const seen = readingsOf(
      reading({
        watched: [SPLIT],
        records: { [SPLIT]: { shellInFront: true } },
      }),
    );
    expect(seen.map((one) => one.level)).toEqual(["shell"]);
    // Reported, never concluded from: whether this is the end of a command
    // kolu typed is two readings of it, and that rule lives in `watching.ts`.
    expect(seen[0]?.foregroundShell).toBe(true);
  });

  it("reads an agent that is COMING UP and one that is FRESH off the record", () => {
    // Neither is in any of padi's four lists — there is no transcript yet to
    // put them there — and before presence the watch said nothing at all about
    // this terminal, which is exactly the moment the Conductor is waiting for.
    const seen = readingsOf(
      reading({
        watched: [SPLIT, PLANNER],
        records: {
          [SPLIT]: { presence: "starting" },
          [PLANNER]: { presence: "fresh" },
        },
      }),
    );
    expect(seen.map((one) => one.level)).toEqual(["starting", "fresh"]);
    // The agent is NAMED on both, which is what makes the entry's agent stick
    // from the moment the program appears.
    expect(seen.map((one) => one.agent)).toEqual([
      "claude-code",
      "claude-code",
    ]);
  });

  it("says NOTHING about a terminal in no list whose record has not arrived", () => {
    // Either there is no agent in it or there is one in a state padi puts in
    // no list, and the frames so far cannot tell those apart. The next one
    // says more; a silence is the answer that never misleads.
    expect(readingsOf(reading({ watched: [SPLIT] }))).toEqual([]);
  });

  it("says NOTHING about an agent in no list whose state is not a presence", () => {
    // It has a session, so it is past the two presence states, and padi puts
    // it in none of the four lists: there is nothing honest to say about it,
    // and that is unchanged by presence existing.
    expect(
      readingsOf(
        reading({ watched: [SPLIT], records: { [SPLIT]: { agent: true } } }),
      ),
    ).toEqual([]);
  });

  it("carries the name, the agent and the piece of work onto every reading", () => {
    const seen = readingsOf(
      reading({
        watched: [SPLIT],
        urgency: { awaitingIds: [SPLIT] },
        records: {
          [PLANNER]: { intent: "plan the cutover" },
          [SPLIT]: {
            parentId: PLANNER,
            intent: "write the migration",
            agent: true,
          },
        },
      }),
    );
    expect(seen).toEqual([
      {
        ref: `${HOST}/${SPLIT}`,
        host: HOST,
        terminalId: SPLIT,
        hostName: "this machine",
        name: "write the migration",
        agent: "claude-code",
        root: { ref: `${HOST}/${PLANNER}`, name: "plan the cutover" },
        foregroundShell: null,
        level: "asking",
      },
    ]);
  });
});
