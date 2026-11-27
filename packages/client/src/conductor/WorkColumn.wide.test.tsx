// @vitest-environment happy-dom
/** THE BOARD'S COLUMN OVER A FLEET OF 250 OPEN WORKS.
 *
 *  The column cuts what is running into three groups: what needs the human,
 *  what is moving, and the watches. Whether a work is a WATCH is a leaf of
 *  its record (`key.kind`), and reading it per row in the grouping memo put
 *  two store leaves per open work on that one scope — past the development
 *  build's 200-source judge at about a hundred works, on the page a person
 *  looks at all day. The fact is read in each work's own row now
 *  (`useWorkSplit`), and the column reads the one set.
 *
 *  Driven through the REAL per-key collection view
 *  (`./collectionMirror.testlib.ts`), because the cost this file is about is
 *  the cost of reading a mirrored record.
 *
 *  Judged twice over: the three groups hold EXACTLY the works this file
 *  planned for them, in the board's own order, and Solid raised nothing —
 *  every grade, `info` included. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { render } from "@solidjs/web";
import { settle } from "@kolu/surface/solid/testlib";
import {
  openWork,
  type Work,
  type WorkId,
  type WorkKey,
  workIdOf,
} from "kolu-work";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  works: undefined as unknown,
  empty: undefined as unknown,
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
      workMembers: { use: () => held.empty },
      memberReadings: { use: () => held.empty },
      workPrs: { use: () => held.empty },
    },
    // The column's module graph reaches the daemon's own cells at import
    // (`useDeepLinks` → `useDaemonStatus`); nothing here reads one.
    cells: {
      padiLink: { use: () => ({ value: () => undefined }) },
    },
  },
}));

// The cards and the rail are each their own subject; what this file judges is
// the board's grouping.
vi.mock("./WorkCard", () => ({
  default: (props: { id: WorkId }) => (
    <div data-testid="work-card-stub" data-work={props.id} />
  ),
}));
vi.mock("./WorkRail", () => ({
  default: () => <nav data-testid="works-rail-stub" />,
}));

import { collectionMirror } from "./collectionMirror.testlib";
import WorkColumn from "./WorkColumn";

const HOST = "local";
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0);
const at = (minute: number): string =>
  new Date(T0 + minute * 60_000).toISOString();

/** THE FLEET: past the judge at every count a column could pay. */
const WORKS = 250;

/** Every third work is a WATCH — kolu keeping an eye on a terminal rather
 *  than building anything. */
const isWatch = (n: number): boolean => n % 3 === 0;

const workOf = (n: number): Work => {
  const key: WorkKey = isWatch(n)
    ? { kind: "watch", host: HOST, id: `t-${n}` }
    : {
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

const mirror = collectionMirror<WorkId, Work>("works");
held.works = mirror.view;
held.empty = collectionMirror<string, never>("empty").view;

const ids: WorkId[] = [];
const watched: WorkId[] = [];
const moving: WorkId[] = [];
for (let n = 0; n < WORKS; n++) {
  const work = workOf(n);
  const id = workIdOf(work.key);
  ids.push(id);
  (isWatch(n) ? watched : moving).push(id);
  mirror.push(id, work);
}
mirror.pushKeys(ids);

const raised = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) =>
      `[${event.severity ?? "(no severity)"}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** The works a section drew, in the order it drew them. */
const drawn = (host: HTMLElement, section: string): ReadonlyArray<string> =>
  [
    ...(host
      .querySelector(`[data-testid="${section}"]`)
      ?.querySelectorAll("[data-work]") ?? []),
  ].map((el) => el.getAttribute("data-work") ?? "");

it("groups 250 open works without reading a leaf per work", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <WorkColumn />, host);
  await settle();
  flush();

  expect(drawn(host, "work-in-progress")).toEqual(moving);
  expect(drawn(host, "work-watching")).toEqual(watched);
  expect(drawn(host, "work-waiting")).toEqual([]);
  expect(moving.length + watched.length).toBe(WORKS);

  expect(raised()).toEqual([]);
});
