// @vitest-environment happy-dom
/**
 * A WORK'S MEMBERS, READ OVER THE REAL FLEET MIRROR.
 *
 * A member's standing is not a field: it is the fleet index's per-key memo
 * and that key's `store.v`, on top of the host's own connected/roster reads
 * (`palette/fleetTerminals.ts`). So a single memo building one line per
 * member carried two to four sources per member, and a card asking "is any
 * terminal up?" off each line's standing record read that record's leaves on
 * its own JSX scope. Both are past Solid's 200-source `WIDE_SCOPE_DEPS`
 * judge at about a hundred members — and a work's membership is not capped
 * anywhere in the code, only by what a waterfall usually runs.
 *
 * So the fixture is a work with 250 member terminals, served through the
 * REAL per-key collection view (`hostWireMirror`): the keys arrive as a
 * store-proxy array and a record costs the per-key memo plus `store.v`,
 * which is what the browser pays. A mock handing back plain arrays
 * under-measures that graph about threefold.
 *
 * What the cases hold: the members are folded a row at a time
 * (`workFacts.members`), each line carrying its own `up`, so the join and
 * the card's `anyUp` are both flat — and the lines still keep their objects
 * when another member's record moves.
 */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { openWork, type WorkId, workIdOf, type WorkMember } from "kolu-work";
import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import { createRoot, createStore, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

// `useCollection` opens each key's stream through this; the mirror's procedure
// IS the stream, so calling it is the whole wire.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({
  entry: (() => undefined) as () => unknown,
  members: (() => new Map()) as () => ReadonlyMap<string, unknown>,
}));

// The dynamic import is vitest's own shape: a `vi.mock` factory is hoisted
// above every static import in the file.
vi.mock("../wire", async () => {
  const { Effect } = await import("effect");
  // Modules the card's graph pulls in open their own app-lifetime
  // subscriptions at IMPORT time (the agent listing, the forwards table).
  // None of them is a reading under test, so every face of `app` answers one
  // inert subscription that never yields.
  const sub = Object.assign(() => undefined, {
    value: () => undefined,
    pending: () => true,
    error: () => undefined,
    keys: () => [],
    byKey: () => undefined,
  });
  const member = { use: () => sub, unenrolledKeys: () => undefined };
  const app = new Proxy(
    {},
    { get: () => new Proxy({}, { get: () => member }) },
  );
  return {
    app,
    padiMap: { entry: () => held.entry() },
    hostKeys: () => [{ kind: "local" }],
    activeHost: () => ({ kind: "local" }),
    interpretClientError: () => {},
    // Nothing in this file asks the server anything; the card's shell reads
    // the identity once at import and is left waiting for it.
    client: { server: { info: () => Effect.never } },
  };
});
// The card's question form names the agents a choice can pick; this file's
// work has no question, so the listing has nothing to answer.
vi.mock("../agents/useAgentDistro", () => ({
  agentDistroListing: () => undefined,
}));
// The fleet index asks a host scope for its activity window; nothing here has
// one, so the stored preference answers, exactly as it does before a host is
// born.
vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => undefined,
  hostScopeOf: () => undefined,
}));
vi.mock("./useWorks", () => ({
  useWorkMap: () => () => new Map(),
  useWorkAt: () => undefined,
  useWorkMembers: () => held.members,
  useWorkPrs: () => () => new Map(),
}));
vi.mock("./WorkCode", () => ({ default: () => <div /> }));
vi.mock("./WorkLive", () => ({ default: () => <div /> }));
vi.mock("./WorkTerminals", () => ({ default: () => <div /> }));

import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { Shown } from "../ui/shown";
import WorkCard from "./WorkCard";
import { pickWork, unpickWork } from "./workListing";
import { fleetTerminalStanding } from "../palette/fleetTerminals";
import { readWorkFacts } from "./workFacts";

/** THE MEMBERSHIP: 250 terminals joined to one work — a waterfall's whole
 *  fleet, and well past the hundred members at which the single memo was
 *  judged. */
const MEMBERS = 250;
const HOST = encodeHostKey(LOCAL_HOST);
const idAt = (n: number): TerminalId =>
  `11111111-1111-4111-8111-${String(n).padStart(12, "0")}` as TerminalId;
const refAt = (n: number): string => `${HOST}/${idAt(n)}`;

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/r",
  branch: "wide-membership",
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);

/** The work the card draws: open (so it has members at all), in a STORE —
 *  the card reads its record through `deep()`, which is a reading of a store
 *  and nothing else. */
const [WORK] = createStore(
  openWork({
    key: KEY,
    title: "A work with a fleet of members",
    at: "2026-11-16T01:00:00.000Z",
    request: { kind: "none" },
  }),
);

/** A composed record as this host serves one: live, so the member has a
 *  screen to watch. */
const recordAt = (n: number, state = "active"): PadiTerminal =>
  ({
    state,
    cwd: `/w/p${n}`,
    git: { kind: "none" },
    agent: null,
    foreground: null,
    parentId: null,
    ports: { status: "unknown" },
    lastActivityAt: n,
    promptedAt: null,
  }) as unknown as PadiTerminal;

const members = new Map<string, WorkMember>(
  Array.from({ length: MEMBERS }, (_, n) => [
    refAt(n),
    {
      work: ID,
      role: n === 0 ? "planner" : "implementor",
      joinedAt: "2026-11-16T01:00:00.000Z",
    } as unknown as WorkMember,
  ]),
);
held.members = () => members;

const rows = Array.from({ length: MEMBERS }, (_, n) => ({
  terminal: refAt(n),
  member: members.get(refAt(n)) as WorkMember,
}));

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

/** ONE mirror for the file: the fleet index is an app-lifetime shared root,
 *  so the first case to read it binds the host's streams for every later
 *  one. */
const mirror = hostWireMirror();
held.entry = () => ({
  clock: { toLocal: (at: number) => at },
  ...(mirror.entry as object),
});
let seeded = false;
const fleet = async (): Promise<void> => {
  if (seeded) return;
  seeded = true;
  const ids = Array.from({ length: MEMBERS }, (_, n) => idAt(n));
  // ASK FOR A STANDING FIRST: the fleet index is an app-lifetime shared root
  // built on first read, and it is that build which opens this host's key
  // stream. Seeding before it exists would push into nothing.
  createRoot((dispose) => {
    disposers.push(dispose);
    fleetTerminalStanding(HOST, idAt(0));
  });
  mirror.pushKeys(ids);
  // The host's own word that the list IS its census — without it every
  // standing is `loading`, which is a different reading.
  mirror.pushRoster({ kind: "established", at: 0, ids: [...ids] });
  for (let n = 0; n < MEMBERS; n++) mirror.pushRecord(idAt(n), recordAt(n));
  await settle();
  flush();
};

const disposers: Array<() => void> = [];
let root: HTMLElement | undefined;
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  root?.remove();
  root = undefined;
  unpickWork();
});

const mount = (ui: () => JSX.Element): HTMLElement => {
  root = document.createElement("div");
  document.body.append(root);
  disposers.push(render(() => <Shown value={() => true}>{ui()}</Shown>, root));
  flush();
  return root;
};

it("reads a 250-member work's lines over the real mirror with no wide scope", async () => {
  await fleet();
  takeSolidDiagnostics();

  const lines = createRoot((dispose) => {
    disposers.push(dispose);
    return readWorkFacts(() => rows).members;
  });
  flush();

  expect(lines().map((one) => one.terminal)).toEqual(
    Array.from({ length: MEMBERS }, (_, n) => refAt(n)),
  );
  expect(lines().every((one) => one.up)).toBe(true);
  expect(diagnostics()).toEqual([]);

  // ONE member's terminal goes to sleep: its line says there is no screen to
  // watch, and every other line is the object it was.
  const before = lines();
  mirror.pushRecord(idAt(7), recordAt(7, "sleeping"));
  await settle();
  flush();

  expect(lines()[7]?.up).toBe(false);
  expect(lines().filter((one) => one.up)).toHaveLength(MEMBERS - 1);
  for (const [n, one] of lines().entries())
    if (n !== 7) expect(one).toBe(before[n]);
  expect(diagnostics()).toEqual([]);
});

it("draws the picked card of a 250-member work with no wide scope", async () => {
  await fleet();
  takeSolidDiagnostics();
  pickWork(ID);

  const el = mount(() => <WorkCard id={ID} work={WORK} shape="picked" />);

  // A terminal of the work is up, so the live view is the one in front —
  // which is `anyUp`'s whole answer, read off the folded lines.
  expect(
    el
      .querySelector('[data-testid="work-view"][data-view="terminals"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(diagnostics()).toEqual([]);

  // One member's record moves: the card holds its answer and nothing widens.
  mirror.pushRecord(idAt(11), recordAt(11, "active"));
  await settle();
  flush();
  expect(
    el
      .querySelector('[data-testid="work-view"][data-view="terminals"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(diagnostics()).toEqual([]);
});

it("draws the card of a work whose 250 terminals are all asleep", async () => {
  // THE CASE `anyUp` IS WIDE IN. `.some` stops at the first member that is
  // up, so a fleet with one live terminal costs two sources whatever the
  // membership; a fleet with NONE is walked to the end, and asking each
  // standing's record there read a leaf per member on the card's own scope.
  await fleet();
  for (let n = 0; n < MEMBERS; n++)
    mirror.pushRecord(idAt(n), recordAt(n, "sleeping"));
  await settle();
  flush();
  takeSolidDiagnostics();
  pickWork(ID);

  const el = mount(() => <WorkCard id={ID} work={WORK} shape="picked" />);

  // Nothing to watch: the details are what the picked work shows.
  expect(
    el
      .querySelector('[data-testid="work-view"][data-view="terminals"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
  expect(el.querySelector('[data-testid="work-details"]')).not.toBeNull();
  expect(diagnostics()).toEqual([]);

  // One of them wakes: the card offers its screen, and nothing widens.
  mirror.pushRecord(idAt(3), recordAt(3, "active"));
  await settle();
  flush();
  expect(
    el
      .querySelector('[data-testid="work-view"][data-view="terminals"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(diagnostics()).toEqual([]);
});
