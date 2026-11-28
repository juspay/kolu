/** THE THREE MIRRORS BESIDE THE WORKS, AND WHAT READS THEM WHOLE — 250
 *  entries each, which is a fleet after a few days.
 *
 *  `useWorkMembers`, `useSeen` and `useWorkPrs` are the same fold as the
 *  works map: walk the collection's keys, read each key's accessor, publish
 *  a `Map`. Over the real per-key seam that costs an index leaf on the keys
 *  STORE ARRAY, the per-key memo and that subscription's stored value — three
 *  sources per entry, past the development build's 200-source judge at about
 *  66 entries, not the 199 a plain-mock test would report. So this file
 *  drives the REAL collection views (`./collectionMirror.testlib.ts`).
 *
 *  Two readings that fold those maps are judged with them, because a map that
 *  is narrow and a reader that is wide leave the app exactly where it was:
 *
 *   - `membershipMap` — every terminal's membership at once. Its entries used
 *     to be the projection's own store proxies, so this map was one source
 *     per member AND every reader's walk of it paid two or three leaves more
 *     per member;
 *   - `knownNames` (`./memberNames.ts`) — the names the peek's tabs and a
 *     work's terminal rows go by, which walks every membership through
 *     `memberDetail`. It crossed 200 at about seventy members.
 *
 *  Each is judged against the same pure fold applied to this file's own plain
 *  records, with `takeSolidDiagnostics()` empty — every grade, `info`
 *  included — and again after one entry of each mirror moves. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { MemberReading } from "kolu-common/works";
import type { PrResult } from "kolu-common/surface";
import type { TerminalId } from "kolu-common/surface";
import {
  membershipOf,
  openWork,
  type Work,
  type WorkId,
  type WorkKey,
  type WorkMember,
  workIdOf,
} from "kolu-work";
import { createRoot, flush } from "solid-js";
import { expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  works: undefined as unknown,
  members: undefined as unknown,
  readings: undefined as unknown,
  prs: undefined as unknown,
  fleet: (() => []) as () => unknown[],
}));

vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

vi.mock("../wire", () => ({
  app: {
    collections: {
      works: { use: () => held.works },
      workMembers: { use: () => held.members },
      memberReadings: { use: () => held.readings },
      workPrs: { use: () => held.prs },
    },
  },
}));

// The fleet index is the terminals' own axis, and plain here: what this file
// judges is what the names reading pays PER MEMBERSHIP. Only the index is
// replaced — the module's own folds are the real ones.
vi.mock("../palette/fleetTerminals", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useFleetTerminalIndex: () => () => held.fleet(),
}));

import { collectionMirror } from "./collectionMirror.testlib";
import { useKnownNames } from "./memberNames";
import { fleetMentionCandidates } from "./mentionCandidates";
import { useMembership, useSeen, useWorkMembers, useWorkPrs } from "./useWorks";

const HOST = "local";
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** THE FLEET: past 200 whichever way an entry is counted, and well past the
 *  66 the per-key seam crosses at. */
const ENTRIES = 250;

/** A terminal id this file can spell 250 of — the fleet index wants real
 *  ones, and a member ref is `<host>/<id>`. */
const terminalId = (n: number): TerminalId =>
  `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111` as TerminalId;

const refOf = (n: number): string => `${HOST}/${terminalId(n)}`;

const workOf = (n: number): Work => {
  const key: WorkKey = {
    kind: "branch",
    host: HOST,
    repo: "/home/code/kolu",
    branch: `work-${n}`,
    repoBy: { kind: "git" },
  };
  return openWork({
    key,
    title: `Work number ${n}`,
    at: at(n),
    request: { kind: "said", text: "do it" },
  });
};

const readingOf = (n: number): MemberReading => ({
  level: n % 2 === 0 ? "working" : "shell",
  since: at(n + 100),
});

const prOf = (n: number): PrResult =>
  n % 3 === 0 ? { kind: "pending" } : { kind: "absent" };

const works = collectionMirror<WorkId, Work>("works");
const members = collectionMirror<string, WorkMember>("workMembers");
const readings = collectionMirror<string, MemberReading>("memberReadings");
const prs = collectionMirror<WorkId, PrResult>("workPrs");
held.works = works.view;
held.members = members.view;
held.readings = readings.view;
held.prs = prs.view;

/** What this file holds, which every oracle below folds. */
const workPlan = new Map<WorkId, Work>();
const memberPlan = new Map<string, WorkMember>();
const readingPlan = new Map<string, MemberReading>();
const prPlan = new Map<WorkId, PrResult>();
const ids: WorkId[] = [];
const refs: string[] = [];

for (let n = 0; n < ENTRIES; n++) {
  const work = workOf(n);
  const id = workIdOf(work.key);
  const ref = refOf(n);
  ids.push(id);
  refs.push(ref);
  workPlan.set(id, work);
  memberPlan.set(ref, { work: id, role: "planner", joinedAt: at(n + 1) });
  readingPlan.set(ref, readingOf(n));
  prPlan.set(id, prOf(n));
  works.push(id, work);
  members.push(ref, { work: id, role: "planner", joinedAt: at(n + 1) });
  readings.push(ref, readingOf(n));
  prs.push(id, prOf(n));
}
works.pushKeys(ids);
members.pushKeys(refs);
readings.pushKeys(refs);
prs.pushKeys(ids);

/** The fleet's rows, plain: one terminal per member, in ref order. */
held.fleet = () =>
  refs.map((_, n) => ({
    host: HOST,
    id: terminalId(n),
    meta: {
      cwd: `/home/code/kolu/work-${n}`,
      intent: `work ${n}`,
      git: { kind: "none" },
    },
    recencyAt: n,
  }));

const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) =>
      `[${event.severity ?? "(no severity)"}] ${event.code} ${event.message}`,
  );

const memberMap = useWorkMembers();
const seen = useSeen();
const prMap = useWorkPrs();
const membership = useMembership();
const names = createRoot(() => useKnownNames());

const judgeEveryMirror = (): void => {
  expect([...memberMap()]).toEqual([...memberPlan]);
  expect([...seen()]).toEqual([...readingPlan]);
  expect([...prMap()]).toEqual([...prPlan]);
  const expected = membershipOf(workPlan, memberPlan);
  expect([...membership()]).toEqual([...expected]);
  expect(membership().size).toBe(ENTRIES);
  expect([...names()]).toEqual(
    fleetMentionCandidates(held.fleet() as never, expected).map(
      (one) => [`${one.host}/${one.terminalId}`, one.name] as const,
    ),
  );
  expect(names().size).toBe(ENTRIES);
};

it("mirrors 250 members, readings and pull requests without one wide memo", async () => {
  await settle();
  flush();

  judgeEveryMirror();
  expect(raised()).toEqual([]);
});

it("says the same after one entry of each mirror moves", async () => {
  await settle();
  flush();
  raised();

  const ref = refs[9] as string;
  const id = ids[9] as WorkId;
  const movedMember: WorkMember = {
    work: id,
    role: "implementor",
    joinedAt: at(10),
  };
  const movedReading: MemberReading = { level: "fresh", since: at(999) };
  const movedPr: PrResult = { kind: "unsupported" };
  memberPlan.set(ref, movedMember);
  readingPlan.set(ref, movedReading);
  prPlan.set(id, movedPr);
  members.push(ref, movedMember);
  readings.push(ref, movedReading);
  prs.push(id, movedPr);
  await settle();
  flush();

  expect(memberMap().get(ref)?.role).toBe("implementor");
  expect(seen().get(ref)?.level).toBe("fresh");
  expect(prMap().get(id)?.kind).toBe("unsupported");
  judgeEveryMirror();
  expect(raised()).toEqual([]);
});
