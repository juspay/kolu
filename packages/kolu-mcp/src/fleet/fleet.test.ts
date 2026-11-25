/**
 * The FLEET face over a two-host fixture — the projection's whole contract,
 * driven through a real served MCP face.
 *
 * Two fake padis behind a fake {@link FleetHosts}, because every claim this
 * face makes is about N hosts and none of them is observable with one: that an
 * id is host-qualified, that a call lands on the RIGHT machine, that two
 * queues merge into one ordered drain, that a host arriving mid-watch flows in
 * and a host leaving says `gone`, and that a host which is not connected is
 * refused BY NAME rather than answered with an empty list.
 *
 * WHAT THE FIXTURE IS, AND WHAT IT IS NOT — stated here because the previous
 * version of this sentence is the reason a production bug lived behind a green
 * suite. Each host's padi used to be a hand-written object literal cast to
 * `PadiSurfaceClient`. A cast makes ANY shape a padi client, so the thing this
 * file exercised was the fleet face against a client the file itself had
 * invented — and kolu-server's real client, built by `padiClientOver` over a
 * surface it was never bound to, failed every terminal-level call in
 * production (`no handler bound at "surface/padi/terminals/keys"`) while this
 * suite stayed green.
 *
 * So each padi here is now a HANDLER RECORD at padi's own wire tags, dialled
 * through the real `padiClientOver` + `directDispatch`. That pins the FACE
 * half end to end: the tag each member is dialled at, the face walk that mints
 * them, and the fail-loud resolver that refuses a tag nothing is bound at. A
 * member renamed in `padiSurface` now breaks this file instead of passing.
 *
 * The half it still cannot pin is kolu-server's MOUNTING — which handlers the
 * client is pointed at, and whether a host's calls carry the host-map's
 * `{ mapKey, input }` envelope. That needs `padiHostMap` + `serveHostMap`,
 * which live behind kolu-server's dependencies, so it is pinned where the
 * mounting lives: `packages/server/src/fleet/fleetHosts.test.ts`, whose
 * fixture serves the real map over a stub pool and calls a terminal member
 * through it.
 */

import { type PadiSurfaceClient, padiClientOver } from "@kolu/padi-client/dial";
import {
  type PadiTerminal,
  type PadiUrgency,
  type PadiWatchEvent,
  padiSurface,
  padiSurfaceSibling,
  TerminalNotActive,
  WatchSubscriptionNotFound,
} from "@kolu/padi-client/surface";
import type { AgentModelLaunch } from "@kolu/agent-distro/models";
import { surfaceTag } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceHandlers } from "@kolu/surface/server";
import { resolveExpose } from "@kolu/surface-mcp";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Option, Queue, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SetupAsk, WorkRefusal } from "kolu-work";
import { normalisePromptText } from "kolu-agents/vocab";
import { SAY_STEER_CAP_MS } from "../say.ts";
import { KOLU_FLEET_EXPOSE, KOLU_MCP_EXPOSE } from "../expose.ts";
import { KOLU_MCP_TOOLS } from "../tools.ts";
import { fleetSurface } from "./fleetSurface.ts";
import type { FleetHosts } from "./hosts.ts";
import { FLEET_SETTLE_CAP_MS, KOLU_FLEET_TOOL_NAMES } from "./lift.ts";
import { serveKoluFleetMcp } from "./serve.ts";
import { notAFleetRef } from "./ref.ts";
import type {
  FleetMemory,
  FleetMemoryChange,
  FleetMemoryView,
} from "./memory.ts";
import {
  type FleetWatchJoin,
  type FleetWorkMemberRow,
  type FleetWorkOpened,
  type FleetWorkRow,
  type FleetWorks,
  parseWorkKey,
} from "./works.ts";

const ALPHA_1 = "11111111-1111-4111-8111-111111111111" as TerminalId;
const ALPHA_2 = "22222222-2222-4222-8222-222222222222" as TerminalId;
const BETA_1 = "33333333-3333-4333-8333-333333333333" as TerminalId;

/** A value with subscribers, as a snapshot-then-change `Stream` — the shape
 *  every padi cell and collection-keys member has on the wire. */
interface Cell<T> {
  readonly value: T;
  set(next: T): void;
  stream(): Stream.Stream<T>;
}

function cell<T>(initial: T): Cell<T> {
  let current = initial;
  const subs = new Set<(value: T) => void>();
  return {
    get value(): T {
      return current;
    },
    set(next: T): void {
      current = next;
      for (const sub of subs) sub(next);
    },
    stream: (): Stream.Stream<T> =>
      Stream.callback<T>((queue) =>
        Effect.gen(function* () {
          Queue.offerUnsafe(queue, current);
          const sub = (value: T): void => {
            Queue.offerUnsafe(queue, value);
          };
          subs.add(sub);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              subs.delete(sub);
            }),
          );
        }),
      ),
  };
}

/** What padi serves as a terminal record — and it carries NO `id`: on a face
 *  that serves one machine the collection KEY is the identity, which is
 *  precisely why the fleet face has to put an addressable one on the row. */
const terminalRecord = (title: string, parentId?: TerminalId): PadiTerminal =>
  ({
    state: "active",
    title,
    agent: null,
    ...(parentId === undefined ? {} : { parentId }),
  }) as unknown as PadiTerminal;

/** The same record with a live agent in it — what `agent_say` reads to decide
 *  whose keys to press. The agent carries EVERY field its wire schema has —
 *  padi serves a whole `AgentInfo` and `agent_say` decodes one — with
 *  `fields` for the facts a test is about (omp's `lastPromptId` /
 *  `lastPromptText`, which a steer's landing is read off). A superset: a key
 *  another agent's schema does not have is ignored by the decode. */
const withAgent = (
  title: string,
  kind: string,
  state: string,
  fields: object = {},
): PadiTerminal =>
  ({
    state: "active",
    title,
    agent: {
      kind,
      state,
      sessionId: `${kind}-session`,
      sessionPath: `/w/${kind}.jsonl`,
      model: null,
      summary: null,
      taskProgress: null,
      workflow: null,
      contextTokens: null,
      startedAt: null,
      lastPromptId: null,
      lastPromptText: null,
      ...fields,
    },
  }) as unknown as PadiTerminal;

const EMPTY_URGENCY: PadiUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
  settled: true,
};

interface FakePadi {
  readonly client: PadiSurfaceClient;
  readonly calls: string[];
  add(id: TerminalId, title: string, parentId?: TerminalId): void;
  /** Put a live agent of `kind` in `state` into that terminal's record. */
  runAgent(id: TerminalId, kind: string, state: string, fields?: object): void;
  /** Arm that terminal's agent to BEGIN WORKING when a submit key (`\r`)
   *  reaches it — a TUI accepting a prompt, which is what `agent_say`'s "did
   *  it take" wait watches for. */
  startsWorkingOnSubmit(id: TerminalId, kind: string): void;
  /** Arm that terminal's WORKING omp to answer a steer's Enter as omp 18.20.2
   *  did when measured: `holds` — a step it cannot interrupt is running, so
   *  the words are DRAWN in its steering pane and its transcript gains
   *  nothing; `takes` — the turn took them, so its transcript gains a new
   *  prompt carrying them; `takes-late` — the turn took them as the watch ran
   *  out, so the pane is already empty and the record only catches up
   *  afterwards; `steals` — a DIFFERENT message landed in the window (an
   *  older held steer handed over, the human typing); `dies` — the terminal
   *  went away on the keys. Unarmed, the Enter does nothing at all. */
  steersLike(
    id: TerminalId,
    behaviour: "holds" | "takes" | "takes-late" | "steals" | "dies",
  ): void;
  /** Put that terminal to sleep IN ITS RECORD — padi's `state` arm, which is
   *  what any reader of the roster sees (distinct from `sleep`, which is the
   *  screen-read gate). */
  park(id: TerminalId, state: "sleeping" | "parked"): void;
  remove(id: TerminalId): void;
  /** Queue a settle event and ring the pulse, as padi's registry would. */
  fire(id: TerminalId, kind: "asking" | "finished" | "gone"): void;
  setUrgency(next: PadiUrgency): void;
  /** Make this padi REFUSE every `watch.open` — a host that is answering but
   *  cannot carry a subscription (a padi mid-restart, a registry at its cap).
   *  `null` restores it. */
  refuseWatchOpen(why: string | null): void;
  /** Make `lifecycle.sendInput` fail — how a create stops PARTWAY with a real
   *  terminal already on the canvas. */
  refuseSendInput(why: string | null): void;
  /** Make this padi's SCREEN READS answer the active-terminal gate's dormant
   *  refusal — what a terminal that has been put to sleep answers (kolu#2361).
   *  `null` restores it. */
  sleep(id: TerminalId | null): void;
  /** Drop every subscription this padi holds, keeping the client — a padi
   *  that RESTARTED under a mirror that never dropped, so nothing upstream
   *  observed a disconnect and the next drain finds no such queue. */
  forgetWatches(): void;
  readonly openedWatches: string[];
  readonly closedWatches: string[];
}

function fakePadi(host: string, seeded: readonly TerminalId[]): FakePadi {
  const calls: string[] = [];
  // One cell PER RECORD, because a collection `get` is a live stream on the
  // wire: a terminal whose agent starts working while something is watching
  // it publishes that, and a fixture that answered one frame and completed
  // would make every state change after the first unobservable.
  const records = new Map<TerminalId, Cell<PadiTerminal>>(
    seeded.map((id) => [id, cell(terminalRecord(`${host} ${id.slice(0, 4)}`))]),
  );
  const keys = cell<TerminalId[]>([...records.keys()]);
  const urgency = cell<PadiUrgency>(EMPTY_URGENCY);
  const roster = cell<{
    kind: "established";
    at: number;
    ids: readonly TerminalId[];
  }>({
    kind: "established",
    at: 1000,
    ids: [...records.keys()],
  });
  const pulse = cell<{ seq: number }>({ seq: 0 });
  const queue: PadiWatchEvent[] = [];
  const openedWatches: string[] = [];
  const closedWatches: string[] = [];
  /** Open subscription names → the watermark each has acknowledged. */
  const open = new Map<string, number>();
  let seq = 0;
  let watchOpenRefusal: string | null = null;
  let sendInputRefusal: string | null = null;
  /** Terminals whose agent begins WORKING when its submit key arrives, by the
   *  agent kind that is in them. */
  const startsOnSubmit = new Map<TerminalId, string>();
  /** Terminals whose working omp answers a steer, and how. */
  const steers = new Map<
    TerminalId,
    "holds" | "takes" | "takes-late" | "steals" | "dies"
  >();
  /** What each terminal's screen draws, when a steer has changed it. */
  const screens = new Map<TerminalId, string>();
  /** The last TEXT written to each terminal — what a submit hands over. */
  const typed = new Map<TerminalId, string>();
  /** The one terminal this padi reports as ASLEEP, if any. */
  let sleeping: TerminalId | null = null;

  /** ONE host's padi, as a HANDLER RECORD at the tags padi's own face dials —
   *  `surfaceTag(padiSurfaceSibling.tagPrefix, member, verb)`, minted by the
   *  framework from padi's own sibling, never typed out here. Every member
   *  this fixture serves therefore has to exist, at its real name, in the real
   *  surface. */
  const at = (member: string, verb: string): string =>
    surfaceTag(padiSurfaceSibling.tagPrefix, member, verb);
  const handlers = {
    [at("identity", "get")]: () =>
      Stream.make({
        commit: `${host}-commit`,
        surfaceVersion: "7.0",
        startedAt: 1000,
      }),
    [at("status", "get")]: () => Stream.make({}),
    [at("urgency", "get")]: () => urgency.stream(),
    // THE ROSTER STANDING: this fixture's padi has adopted its terminals, so
    // its key list is a census — which is what lets a reader of it conclude
    // that a terminal missing from it is really not there.
    [at("roster", "get")]: () => roster.stream(),
    [at("terminals", "keys")]: () => keys.stream(),
    [at("terminals", "get")]: ({ key }: { key: TerminalId }) => {
      const record = records.get(key);
      return record === undefined ? Stream.never : record.stream();
    },
    [at("screen", "text")]: (input: { id: TerminalId }) =>
      Effect.suspend(() => {
        calls.push(`screen.text:${input.id}`);
        // padi's active-terminal gate: a dormant record is refused by name,
        // never as "not found" (kolu#2361).
        return input.id === sleeping
          ? Effect.fail(
              new TerminalNotActive({ id: input.id, state: "sleeping" }),
            )
          : Effect.succeed(
              screens.get(input.id) ?? `screen of ${host}/${input.id}`,
            );
      }),
    [at("screen", "history")]: (input: { id: TerminalId; max: number }) =>
      Effect.sync(() => {
        calls.push(`screen.history:${input.id}`);
        return { kind: "ok", chunk: host, topLine: 1, exhausted: true };
      }),
    [at("lifecycle", "create")]: (input: unknown) =>
      Effect.sync(() => {
        calls.push(`lifecycle.create:${JSON.stringify(input)}`);
        return { id: BETA_1, pid: 77 };
      }),
    [at("lifecycle", "kill")]: (input: { id: TerminalId }) =>
      Effect.sync(() => {
        calls.push(`lifecycle.kill:${input.id}`);
        return { id: input.id, pid: 42 };
      }),
    [at("lifecycle", "sendInput")]: (input: unknown) =>
      Effect.suspend(() => {
        calls.push(`lifecycle.sendInput:${JSON.stringify(input)}`);
        if (sendInputRefusal !== null) {
          return Effect.fail(new Error(sendInputRefusal));
        }
        // A submit KEY landing on an agent that was armed to start: what a
        // real TUI does a beat after its Enter, and the only way an
        // in-process fixture can let `agent_say`'s "did it take" wait observe
        // the thing it is there to observe.
        const { id, data } = input as { id: TerminalId; data: string };
        const starting = startsOnSubmit.get(id);
        const record = records.get(id);
        if (data !== "\r") typed.set(id, data);
        if (data === "\r" && starting !== undefined && record !== undefined) {
          record.set(withAgent(`${host} agent`, starting, "thinking"));
        }
        // A steer's Enter on a working omp, as measured: held in the pane,
        // taken into the transcript as a new prompt (at once, or a beat after
        // the watch's cap — the record is derived from a POLLED transcript
        // read, so it lags the pane), or a terminal that dies on the keys.
        const steer = steers.get(id);
        if (data === "\r" && steer !== undefined && record !== undefined) {
          const words = typed.get(id) ?? "";
          const took = (): void => {
            record.set(
              withAgent(`${host} agent`, "omp", "thinking", {
                lastPromptId: "p-steer",
                lastPromptText: normalisePromptText(words),
              }),
            );
          };
          if (steer === "holds") {
            screens.set(
              id,
              [
                " Steering · 1 ",
                `   1. ${words} `,
                "   └ Alt+↑ to edit ",
                "╰─",
              ].join("\n"),
            );
          } else if (steer === "takes") {
            took();
          } else if (steer === "takes-late") {
            // The turn took the words in the last moment of the cap: they
            // have LEFT the pane and the record has not caught up. A REAL
            // timer, deliberately: what is under test is a wait against the
            // host clock inside a live surface mirror, which a fake clock
            // cannot drive (the same reason this suite's steer tests already
            // run at 15 s).
            setTimeout(took, SAY_STEER_CAP_MS + 200).unref();
          } else if (steer === "steals") {
            // Someone else's words landed in the window — an older held steer
            // handed over, or the human typing in that terminal.
            record.set(
              withAgent(`${host} agent`, "omp", "thinking", {
                lastPromptId: "p-someone-else",
                lastPromptText: "what the human typed instead",
              }),
            );
          } else {
            // The terminal died on the keys.
            records.delete(id);
            keys.set([...records.keys()]);
          }
        }
        return Effect.void;
      }),
    [at("git", "getStatus")]: (input: { repoPath: string }) =>
      Effect.sync(() => {
        calls.push(`git.getStatus:${input.repoPath}`);
        return { files: [], branch: host };
      }),
    // padi's own rule, because the fleet leans on it: a FRESH subscription
    // starts acknowledged at the daemon's current sequence (it reports what
    // happens next), and a RE-ATTACH keeps the watermark it had — which is
    // what makes a reconnect hand over what was queued while the link was
    // down instead of skipping it.
    [at("watch", "open")]: (input: { name: string }) =>
      Effect.suspend(() => {
        openedWatches.push(input.name);
        if (watchOpenRefusal !== null) {
          return Effect.fail(new Error(watchOpenRefusal));
        }
        const held = open.get(input.name);
        const acknowledged = held ?? seq;
        open.set(input.name, acknowledged);
        return Effect.succeed({
          name: input.name,
          acknowledged,
          reattached: held !== undefined,
        });
      }),
    [at("watch", "drain")]: (input: { name: string; after?: number }) =>
      Effect.suspend(() => {
        const held = open.get(input.name);
        if (held === undefined) {
          return Effect.fail(
            new WatchSubscriptionNotFound({
              name: input.name,
              known: [...open.keys()],
            }),
          );
        }
        const after = input.after ?? held;
        open.set(input.name, after);
        const events = queue.filter((event) => event.seq > after);
        return Effect.succeed({
          events,
          dropped: 0,
          ackAfter: events.at(-1)?.seq ?? seq,
        });
      }),
    [at("watch", "close")]: (input: { name: string }) =>
      Effect.suspend(() => {
        if (!open.has(input.name)) {
          return Effect.fail(
            new WatchSubscriptionNotFound({
              name: input.name,
              known: [...open.keys()],
            }),
          );
        }
        closedWatches.push(input.name);
        open.delete(input.name);
        return Effect.succeed({});
      }),
    // The output feed `agent_say`'s settle (and every `wait_*`) subscribes to.
    // ONE snapshot frame and then silence, which is a terminal that has
    // finished redrawing — so the idle window fires instead of the call
    // spending its whole cap.
    [at("terminalAttach", "get")]: () =>
      Stream.make({ kind: "snapshot", data: `screen of ${host}` }),
    [at("watchPulse", "get")]: () => pulse.stream(),
    // WHERE A BRANCH IS CHECKED OUT, as git on this host would answer: every
    // path under `/repo` is inside the one repository rooted there (its
    // root, a linked worktree, a trailing slash); `/broken` is a git that
    // would not answer; anything else is no repository.
    [at("branchCheckout", "get")]: (input: { repoPath: string }) =>
      Stream.make(
        input.repoPath === "/repo" || input.repoPath.startsWith("/repo/")
          ? { kind: "repository", root: "/repo", checkout: { kind: "none" } }
          : input.repoPath === "/broken"
            ? { kind: "unavailable", reason: "git hung" }
            : { kind: "not-a-repository" },
      ),
  } as unknown as SurfaceHandlers;

  // THE REAL FACE WALK — `padiClientOver`, the one kolu-server hands the fleet
  // face, over an in-process dispatch into the record above. A hand-built
  // object cast to `PadiSurfaceClient` is what this used to be, and it is
  // exactly what let the production bug ship: the cast makes any shape a padi
  // client, so a face that dials tags nothing is bound at looks identical to
  // one that works. Built this way the fixture cannot pass unless padi's face
  // and this padi's handlers agree on every tag.
  const client = padiClientOver(directDispatch({ handlers })).padi;

  return {
    client,
    calls,
    openedWatches,
    closedWatches,
    runAgent(id, kind, state, fields) {
      const held = records.get(id);
      const next = withAgent(`${host} agent`, kind, state, fields);
      if (held === undefined) records.set(id, cell(next));
      else held.set(next);
      keys.set([...records.keys()]);
    },
    startsWorkingOnSubmit(id, kind) {
      startsOnSubmit.set(id, kind);
    },
    steersLike(id, behaviour) {
      steers.set(id, behaviour);
    },
    park(id, state) {
      const held = records.get(id);
      const dormant = {
        state,
        title: `${host} parked`,
        agent: null,
      } as unknown as PadiTerminal;
      if (held === undefined) records.set(id, cell(dormant));
      else held.set(dormant);
      keys.set([...records.keys()]);
    },
    add(id, title, parentId) {
      const held = records.get(id);
      const next = terminalRecord(title, parentId);
      if (held === undefined) records.set(id, cell(next));
      else held.set(next);
      keys.set([...records.keys()]);
    },
    remove(id) {
      records.delete(id);
      keys.set([...records.keys()]);
    },
    fire(id, kind) {
      seq += 1;
      queue.push({ seq, id, kind, at: Date.now() } as PadiWatchEvent);
      pulse.set({ seq });
    },
    setUrgency(next) {
      urgency.set(next);
    },
    refuseWatchOpen(why) {
      watchOpenRefusal = why;
    },
    refuseSendInput(why) {
      sendInputRefusal = why;
    },
    sleep(id) {
      sleeping = id;
    },
    forgetWatches() {
      open.clear();
      queue.length = 0;
      seq = 0;
    },
  };
}

/** kolu-server's host map, as a test holds it: a mutable roster of states. */
function fakeFleet(
  seed: readonly {
    key: string;
    display: string;
    padi: FakePadi | null;
    state?: "warming" | "connected" | "failed";
  }[],
) {
  const rows = new Map(
    seed.map((one) => [
      one.key,
      {
        display: one.display,
        padi: one.padi,
        state: one.state ?? ("connected" as const),
      },
    ]),
  );
  const subs = new Set<() => void>();
  const moved = (): void => {
    for (const sub of subs) sub();
  };
  const hosts: FleetHosts = {
    keys: () => [...rows.keys()],
    display: (key) => rows.get(key)?.display ?? key,
    padi: (key) => rows.get(key)?.padi?.client ?? null,
    state: (key) => rows.get(key)?.state ?? "failed",
    subscribe: (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
  return {
    hosts,
    join(key: string, display: string, padi: FakePadi): void {
      rows.set(key, { display, padi, state: "connected" });
      moved();
    },
    leave(key: string): void {
      rows.delete(key);
      moved();
    },
    setState(key: string, state: "warming" | "connected" | "failed"): void {
      const row = rows.get(key);
      if (row !== undefined) {
        rows.set(key, { ...row, state, padi: null });
        moved();
      }
    },
  };
}

/** The one text body a `resources/read` answers with, as JSON. The SDK types
 *  `contents` as text-or-blob; every resource this face serves is text, so the
 *  read is narrowed here once rather than at each assertion. */
const jsonOf = (result: {
  readonly contents: readonly Record<string, unknown>[];
}): unknown => JSON.parse(String(result.contents[0]?.text));

/** A waterfall role's start, as kolu-server answers it for a setup it still
 *  offers: the saved harness and model, and the host's launch. */
interface SetUpStart {
  readonly harness: string;
  readonly model: string;
  readonly launch: AgentModelLaunch;
}

/** omp's launch, as its adapter answers it: a flag before its arguments. */
const MODEL_FLAG: AgentModelLaunch = { kind: "flag", flag: "--model" };

/** kolu's memory, as a test holds it: what was proposed, and a refusal the
 *  test can arm. The real record is the server's; this face only reads it
 *  and asks. */
type FakeMemory = FleetMemory & {
  proposed: Array<{ change: FleetMemoryChange; why: string | null }>;
  refuseWith(why: string | null): void;
  set(view: FleetMemoryView): void;
};

function fakeMemory(): FakeMemory {
  let view: FleetMemoryView = {
    entries: [],
    waiting: [],
    room: { used: 0, of: 16_000 },
  };
  let refusal: string | null = null;
  const readers = new Set<() => void>();
  const proposed: Array<{ change: FleetMemoryChange; why: string | null }> = [];
  return {
    proposed,
    refuseWith: (why) => {
      refusal = why;
    },
    set: (next) => {
      view = next;
      for (const tell of readers) tell();
    },
    view: () => view,
    subscribe: (cb) => {
      readers.add(cb);
      return () => {
        readers.delete(cb);
      };
    },
    propose: (change, why) => {
      if (refusal !== null) return { kind: "refused", why: refusal };
      proposed.push({ change, why });
      return { kind: "waiting", proposal: `p${proposed.length}` };
    },
  };
}

/** kolu's pieces of work, as a test holds them: one work opened per
 *  `work_open`, add-ordered members, in memory, recording HOW each joined,
 *  every terminal the conductor has spoken to, and what the server's watcher
 *  last SAW in each one. The real record is stored with the rest of kolu's
 *  state and read by that watcher — this face moves it and serves it back,
 *  which is exactly what these tests are about. */
function fakeWorks(): FleetWorks & {
  /** Open a work the way kolu-server would, without going through the tool —
   *  for the cases that are about something else and need a work to hang it
   *  on. */
  seed(id: string, title?: string): string;
  joinOf(ref: string): FleetWatchJoin | undefined;
  roleOf(ref: string): string | undefined;
  /** Every member ref, across every work — what most of these cases assert. */
  refs(): string[];
  /** What the SERVER's watcher does between turns: it reads a member terminal
   *  and writes back what it found. Nothing on this face does it, and the
   *  `works` resource has to show it. */
  sawIn(ref: string, name: string, agent: string | null): void;
  /** End a work, as kolu-server would when its PR merged. */
  end(id: string): void;
  readonly saids: string[];
  /** Every `closed` the face told the record, in order. */
  readonly closeds: string[];
  /** Every `work_open` that reached the port — with the setup AS THE RECORD
   *  TAKES IT, which is what the tool's edge conversion is about — every
   *  `work_ask`, and every note. */
  readonly opened: { title: string; setup: ReadonlyArray<SetupAsk> }[];
  readonly asks: {
    work: string;
    questions: Parameters<FleetWorks["ask"]>[1];
  }[];
  readonly notes: { work: string; text: string }[];
  /** What a waterfall role of a seeded work starts on — what `startOf`
   *  answers once kolu-server has judged the saved setup against its offer
   *  and read the host's launch — or the refusal it answers instead. */
  setUp(
    work: string,
    role: "planner" | "implementor",
    start: SetUpStart | WorkRefusal,
  ): void;
} {
  const works = new Map<string, FleetWorkRow>();
  const ended = new Map<string, string>();
  const listeners = new Set<() => void>();
  const saids: string[] = [];
  const closeds: string[] = [];
  const opened: { title: string; setup: ReadonlyArray<SetupAsk> }[] = [];
  const asks: {
    work: string;
    questions: Parameters<FleetWorks["ask"]>[1];
  }[] = [];
  const notes: { work: string; text: string }[] = [];
  const starts = new Map<string, SetUpStart | WorkRefusal>();
  const moved = (): void => {
    for (const one of listeners) one();
  };
  const blank = (id: string, title: string): FleetWorkRow => ({
    id,
    title,
    key: {
      kind: "branch",
      host: "local",
      repo: "/repo",
      branch: "work",
      repoBy: "git",
    },
    host: "local",
    mode: Option.some("full"),
    onGreen: Option.some("merge"),
    standing: {
      why: "working",
      since: "2026-01-01",
    },
    members: [],
    openQuestions: [],
  });
  const self = {
    rows: () => ({
      works: [...works.values()],
      finished: [...ended.entries()].map(([id, title]) => ({
        id,
        title,
        outcome: { kind: "merged" as const, pr: 1 },
        endedAt: "2026-01-02",
      })),
    }),
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    open: async (intent: Parameters<FleetWorks["open"]>[0]) => {
      opened.push({
        title: intent.title,
        setup: intent.setup,
      });
      const id = `work:${works.size + 1}`;
      works.set(id, blank(id, intent.title));
      moved();
      const answer: FleetWorkOpened = {
        work: id,
        setup: {
          host: "local",
          mode: Option.some("full"),
          roles: [
            {
              role: "planner",
              setup: {
                kind: "harness-and-model",
                harness: "omp",
                model: "opus",
              },
            },
            {
              role: "implementor",
              setup: {
                kind: "harness-and-model",
                harness: "omp",
                model: "sonnet",
              },
            },
          ],
          onGreen: Option.some("merge"),
        },
        ask: `ask:${id}`,
        asked: true,
        created: true,
        reopened: false,
      };
      return answer;
    },
    startOf: async (work: string, role: "planner" | "implementor") => {
      const one = works.get(work);
      const start = starts.get(`${work}#${role}`);
      if (start instanceof WorkRefusal) throw start;
      if (one === undefined || start === undefined)
        throw new WorkRefusal(
          "missing-setup",
          `The ${role} of ${work} has no harness and model answered yet. Nothing was created.`,
        );
      return { host: one.host, ...start };
    },
    setUp(
      work: string,
      role: "planner" | "implementor",
      start: SetUpStart | WorkRefusal,
    ) {
      starts.set(`${work}#${role}`, start);
    },
    ask: (work: string, questions: Parameters<FleetWorks["ask"]>[1]) => {
      asks.push({ work, questions });
      return { ask: `ask:${works.size}` };
    },
    join(
      ref: string,
      work: string,
      role: FleetWorkMemberRow["role"],
      joined: FleetWatchJoin,
    ) {
      const one = works.get(work);
      if (one === undefined)
        throw Object.assign(new Error("gone"), {
          kind: "unknown-work",
          why: `no work ${work}`,
        });
      if (one.members.some((two) => two.ref === ref)) return;
      works.set(work, {
        ...one,
        members: [
          ...one.members,
          { ref, role, name: null, agent: null, joined, driver: "conductor" },
        ],
      });
      moved();
    },
    leave(ref: string) {
      for (const [id, work] of works) {
        if (!work.members.some((one) => one.ref === ref)) continue;
        works.set(id, {
          ...work,
          members: work.members.filter((one) => one.ref !== ref),
        });
        moved();
        return true;
      }
      return false;
    },
    note(work: string, text: string) {
      notes.push({ work, text });
    },
    said(ref: string) {
      saids.push(ref);
    },
    closed(ref: string) {
      closeds.push(ref);
      if (self.leave(ref)) moved();
    },
    check: (work: string): Option.Option<"unknown-work" | "work-ended"> =>
      works.has(work)
        ? Option.none()
        : Option.some(ended.has(work) ? "work-ended" : "unknown-work"),
    seed(id: string, title = "a piece of work") {
      works.set(id, blank(id, title));
      moved();
      return id;
    },
    joinOf: (ref: string) =>
      [...works.values()]
        .flatMap((one) => one.members)
        .find((one) => one.ref === ref)?.joined,
    roleOf: (ref: string) =>
      [...works.values()]
        .flatMap((one) => one.members)
        .find((one) => one.ref === ref)?.role,
    refs: () =>
      [...works.values()].flatMap((one) => one.members.map((two) => two.ref)),
    sawIn(ref: string, name: string, agent: string | null) {
      for (const [id, work] of works) {
        if (!work.members.some((one) => one.ref === ref)) continue;
        works.set(id, {
          ...work,
          members: work.members.map((one) =>
            one.ref === ref ? { ...one, name, agent } : one,
          ),
        });
        moved();
      }
    },
    end(id: string) {
      const work = works.get(id);
      if (work === undefined) return;
      ended.set(id, work.title);
      works.delete(id);
      moved();
    },
    /** STOP — the one ending the Conductor itself can write, which for this
     *  fixture is the same move as the forge ending one. */
    stop(id: string) {
      self.end(id);
    },
    saids,
    closeds,
    opened,
    asks,
    notes,
  };
  return self;
}

/** The two-host fixture, at module scope so both suites raise it. */
function twoHostFleet() {
  const alpha = fakePadi("local", [ALPHA_1, ALPHA_2]);
  const beta = fakePadi("remote:box", [BETA_1]);
  const fleet = fakeFleet([
    { key: "local", display: "this machine", padi: alpha },
    { key: "remote:box", display: "box", padi: beta },
  ]);
  return { alpha, beta, fleet };
}

describe("the fleet face's git reads", () => {
  it("declare padi's own error set, so a missing base branch reaches the agent", () => {
    // The fleet face forwards to padi's members; an error padi declares and
    // the fleet face does not fails the fleet's response encode instead of
    // reaching an agent calling `git_getStatus`.
    const fleetGit = fleetSurface.spec.procedures.git;
    const padiGit = padiSurface.spec.procedures.git;
    expect(fleetGit.getStatus.error).toBe(padiGit.getStatus.error);
    expect(fleetGit.getDiff.error).toBe(padiGit.getDiff.error);
  });
});

describe("the fleet face over two hosts", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  /** The record these cases create INTO. A terminal belongs to a piece of
   *  work and nothing is created outside one, so even the addressing cases
   *  name a work — this is it, and nothing here reads it back. */
  const addressingWorks = fakeWorks();
  addressingWorks.seed("work:1");

  async function servedFleet(hosts: FleetHosts): Promise<Client> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      // These cases are about addressing, not about the works — the port is
      // handed one that already holds the work they name, and nothing here
      // reads it back.
      works: addressingWorks,
      memory: fakeMemory(),
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    teardown = async () => {
      await mcp.close();
      await close();
    };
    return mcp;
  }

  const twoHosts = twoHostFleet;

  it("`terminals` lists every host's terminals, host-qualified, local first", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const keys = jsonOf(
      await mcp.readResource({ uri: "surface://collections/terminals" }),
    );
    expect(keys).toEqual([
      `local/${ALPHA_1}`,
      `local/${ALPHA_2}`,
      `remote:box/${BETA_1}`,
    ]);
  });

  it("a terminal record is read from the host that owns it, and SAYS so", async () => {
    const { beta, fleet } = twoHosts();
    // A split living inside another terminal on the same host — the one place
    // a record carries a second id of its own.
    beta.add(BETA_1, "box worker", ALPHA_1);
    const mcp = await servedFleet(fleet.hosts);
    // The ESCAPED spelling of a reference (`encodeURIComponent`, what an `{id}`
    // expansion writes) names the same record as the one handed out.
    const record = jsonOf(
      await mcp.readResource({
        uri: `surface://collections/terminals/${encodeURIComponent(`remote:box/${BETA_1}`)}`,
      }),
    ) as { id: string; parentId: string; host: string; title: string };
    expect(record.title).toBe("box worker");
    // Every id on the row is one the TOOLS on this face accept. A bare `id`
    // here is a row an agent reads and cannot act on: `lifecycle_kill` refuses
    // it as "not a fleet terminal reference".
    expect(record.id).toBe(`remote:box/${BETA_1}`);
    expect(record.parentId).toBe(`remote:box/${ALPHA_1}`);
    expect(record.host).toBe("remote:box");
    const killed = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: record.id },
    });
    expect(killed.isError ?? false, JSON.stringify(killed.content)).toBe(false);
  });

  it("reads a record at the reference the face hands out — local and remote, unescaped", async () => {
    // A reference is `host/id`, so the URI an agent writes by pasting one
    // after the collection has a slash in its name. Both arms, because
    // `local/<id>` carries the slash too.
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const asked = (ref: string) => `surface://collections/terminals/${ref}`;

    const localUri = asked(`local/${ALPHA_1}`);
    const local = await mcp.readResource({ uri: localUri });
    expect(jsonOf(local)).toMatchObject({
      id: `local/${ALPHA_1}`,
      host: "local",
    });
    // The answer comes back at the address the caller WROTE — an agent handed
    // a different one reads it as a second, secret spelling.
    expect(local.contents[0]?.uri).toBe(localUri);

    expect(
      jsonOf(await mcp.readResource({ uri: asked(`remote:box/${BETA_1}`) })),
    ).toMatchObject({ id: `remote:box/${BETA_1}`, host: "remote:box" });
  });

  it("subscribes to a record at the reference the face hands out, and hears it change there", async () => {
    const { beta, fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const uri = `surface://collections/terminals/remote:box/${BETA_1}`;
    const updates: string[] = [];
    mcp.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
      updates.push(note.params.uri);
    });
    await mcp.subscribeResource({ uri });
    // The opening snapshot is announced too, after the pusher's debounce — so
    // wait until it has been heard, and only then clear: what arrives after the
    // change is the change.
    await vi.waitFor(() => {
      expect(updates).toContain(uri);
    });
    updates.length = 0;

    beta.runAgent(BETA_1, "claude-code", "thinking");

    await vi.waitFor(() => {
      expect(updates).toContain(uri);
    });
    expect(jsonOf(await mcp.readResource({ uri }))).toMatchObject({
      agent: { kind: "claude-code" },
    });
  });

  it("a reference that names no terminal gets the host's own answer", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    // A well-formed reference, to a terminal that is on the OTHER host: the
    // address is right in shape, so it is read, and the read finds nothing.
    const uri = `surface://collections/terminals/local/${BETA_1}`;
    const refusal = await mcp.readResource({ uri }).then(
      () => null,
      (e: unknown) => String(e),
    );
    expect(refusal).toContain(
      `resource "${uri}" has no value yet — its collection key is not present`,
    );
  });

  it("refuses a name that is not a reference in the reference grammar's own words", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const uri = "surface://collections/terminals/bogus";
    const refusal = await mcp.readResource({ uri }).then(
      () => null,
      (e: unknown) => String(e),
    );
    expect(refusal).toContain(
      `names no item of "surface://collections/terminals"`,
    );
    expect(refusal).toContain(notAFleetRef("bogus"));
  });

  it("refuses an address this face does not serve by naming what it does", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const refusal = await mcp
      .readResource({ uri: "surface://cells/screens" })
      .then(
        () => null,
        (e: unknown) => String(e),
      );
    expect(refusal).toContain("unknown resource");
    expect(refusal).toContain('"surface://collections/terminals/{+id}"');
    expect(refusal).toContain('"surface://cells/hosts"');
  });

  it("`hosts` answers the whole roster — every host and its facts — in ONE read", async () => {
    // The question an agent asks first is "which hosts can I use", and the
    // answer has to arrive whole. As a COLLECTION this resource was its key
    // set: five strings, and a per-host template URI an agent had to guess at
    // to learn anything else. One read, every row.
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/hosts" })),
    ).toEqual([
      {
        host: "local",
        display: "this machine",
        state: "connected",
        commit: "local-commit",
        surfaceVersion: "7.0",
        startedAt: 1000,
      },
      {
        host: "remote:box",
        display: "box",
        state: "connected",
        commit: "remote:box-commit",
        surfaceVersion: "7.0",
        startedAt: 1000,
      },
    ]);
  });

  it("`urgency` concatenates every host's ids, host-qualified", async () => {
    const { alpha, beta, fleet } = twoHosts();
    alpha.setUrgency({ ...EMPTY_URGENCY, awaitingIds: [ALPHA_2] });
    beta.setUrgency({ ...EMPTY_URGENCY, awaitingIds: [BETA_1] });
    const mcp = await servedFleet(fleet.hosts);
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/urgency" })),
    ).toEqual({
      awaitingIds: [`local/${ALPHA_2}`, `remote:box/${BETA_1}`],
      finishedIds: [],
      workingIds: [],
      lingerIds: [],
    });
  });

  it("a tool call lands on the host its reference names", async () => {
    const { alpha, beta, fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "screen_text",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(res.isError ?? false).toBe(false);
    expect(beta.calls).toEqual([`screen.text:${BETA_1}`]);
    expect(alpha.calls).toEqual([]);
  });

  it("a SLEEPING terminal is refused by name, with its id re-qualified", async () => {
    // The refusal an agent on this face actually reads. Two things have to be
    // true at once: it must say the terminal is ASLEEP (not "not found" — a
    // terminal it can see in the roster), and the id it names must be the
    // FLEET reference, in the prose as well as in the data, or the agent is
    // handed an id every tool on this face refuses.
    const { beta, fleet } = twoHosts();
    beta.sleep(BETA_1);
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "screen_text",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(res.isError).toBe(true);
    expect(String((res.content as { text: string }[])[0]?.text)).toContain(
      `Terminal remote:box/${BETA_1} is asleep — wake it before reading its screen`,
    );
    expect(res.structuredContent).toEqual({
      kind: "terminal-not-active",
      tag: "TerminalNotActive",
      id: `remote:box/${BETA_1}`,
      state: "sleeping",
    });
  });

  it("a lifted answer carries ids back host-qualified", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: `local/${ALPHA_1}` },
    });
    expect(res.structuredContent).toEqual({
      id: `local/${ALPHA_1}`,
      pid: 42,
    });
  });

  it("`lifecycle_create` takes a host and answers a fleet reference", async () => {
    const { beta, fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "remote:box",
        placement: { kind: "toplevel" },
        work: "work:1",
        role: "other",
      },
    });
    expect(res.isError ?? false).toBe(false);
    expect(res.structuredContent).toMatchObject({
      id: `remote:box/${BETA_1}`,
      pid: 77,
    });
    expect(beta.calls).toHaveLength(1);
  });

  it("a create that stops PARTWAY names the survivor at a reference another tool accepts", async () => {
    const { beta, fleet } = twoHosts();
    beta.refuseSendInput("the pty went away mid-write");
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "remote:box",
        placement: { kind: "toplevel" },
        run: "pnpm test",
        work: "work:1",
        role: "other",
      },
    });
    expect(res.isError).toBe(true);
    // The terminal EXISTS on box. An id the agent cannot pass back is an
    // orphan it was told about and cannot remove.
    expect(res.structuredContent).toMatchObject({
      kind: "stopped-partway",
      landed: { id: `remote:box/${BETA_1}` },
    });
    // The prose the model actually reads carries the same reference.
    expect(JSON.stringify(res.content)).toContain(`remote:box/${BETA_1}`);
    const killed = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(killed.isError ?? false, JSON.stringify(killed.content)).toBe(false);
    expect(beta.calls).toContain(`lifecycle.kill:${BETA_1}`);
  });

  it("refuses a cross-host parent instead of flattening the hierarchy", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "remote:box",
        placement: { kind: "child-of", parentId: `local/${ALPHA_1}` },
        work: "work:1",
        role: "other",
      },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("remote:box");
    expect(res.structuredContent).toMatchObject({
      kind: "cross-host-reference",
    });
  });

  it("refuses a disconnected host BY NAME, never with an empty answer", async () => {
    const { fleet } = twoHosts();
    fleet.setState("remote:box", "warming");
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "git_getStatus",
      arguments: { host: "remote:box", repoPath: "/repo", mode: "working" },
    });
    expect(res.isError).toBe(true);
    const said = JSON.stringify(res.content);
    expect(said).toContain("remote:box");
    expect(said).toContain("warming");
    expect(res.structuredContent).toMatchObject({
      kind: "host-not-connected",
      host: "remote:box",
      state: "warming",
    });
  });

  it("refuses an unknown host by name, naming the fleet", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "screen_text",
      arguments: { id: `remote:elsewhere/${BETA_1}` },
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({
      kind: "unknown-host",
      host: "remote:elsewhere",
    });
  });
});

describe("`agent_say` over the fleet", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  async function servedFleet(
    hosts: FleetHosts,
    works: FleetWorks = fakeWorks(),
  ): Promise<Client> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      works,
      memory: fakeMemory(),
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    teardown = async () => {
      await mcp.close();
      await close();
    };
    return mcp;
  }

  it("types the words, presses the submit keys, and reports that it TOOK", async () => {
    const { alpha, fleet } = twoHostFleet();
    alpha.runAgent(ALPHA_1, "omp", "waiting");
    // The agent accepts the prompt a beat after its Enter — so the "did it
    // take" wait sees the bucket turn `working`, which is the whole claim.
    alpha.startsWorkingOnSubmit(ALPHA_1, "omp");
    const mcp = await servedFleet(fleet.hosts);

    const res = await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "ship it" },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    expect(res.structuredContent).toMatchObject({
      said: {
        agent: "omp",
        working: false,
        keys: ["Enter"],
        delivery: "submitted",
        textBytes: "ship it".length,
      },
      took: { observed: "began-working" },
    });
    // TWO writes, in order: the text, then the submit — never one fused write,
    // which is the paste-debounce race this whole protocol exists for.
    const writes = alpha.calls.filter((one) =>
      one.startsWith("lifecycle.sendInput:"),
    );
    expect(writes).toEqual([
      `lifecycle.sendInput:{"id":"${ALPHA_1}","data":"ship it"}`,
      `lifecycle.sendInput:{"id":"${ALPHA_1}","data":"\\r"}`,
    ]);
  });

  it("tells the record it SPOKE, at the fleet reference", async () => {
    // The member's held news is about a state the conductor has now acted on;
    // the server withdraws it on this call, which is what stops a wake about
    // the worker that was just briefed.
    const { alpha, fleet } = twoHostFleet();
    alpha.runAgent(ALPHA_1, "claude-code", "tool_use");
    const works = fakeWorks();
    const mcp = await servedFleet(fleet.hosts, works);

    await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "skip the review" },
    });

    expect(works.saids).toEqual([`local/${ALPHA_1}`]);
  });

  it("a WORKING agent is told what its keys actually did, and that taking is not observable", async () => {
    const { alpha, fleet } = twoHostFleet();
    alpha.runAgent(ALPHA_1, "claude-code", "tool_use");
    const mcp = await servedFleet(fleet.hosts);

    const res = await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "skip the review" },
    });

    // claude-code holds a mid-turn message for the NEXT turn — so the answer
    // says `queue`, and a conductor reading it knows the worker has not heard
    // this yet. There is no state change to wait for, so none is waited for.
    expect(res.structuredContent).toMatchObject({
      said: { agent: "claude-code", working: true, delivery: "queue" },
      took: { observed: "not-observable" },
    });
  });

  /** A steer into a WORKING omp, through the whole face: the record says what
   *  its transcript's newest prompt is, and the stand-in TUI answers the one
   *  Enter as omp 18.20.2 did when measured. */
  async function steerOmp(
    behaviour: "holds" | "takes" | "takes-late" | "steals" | "dies" | "drops",
    words: string,
  ) {
    const { alpha, fleet } = twoHostFleet();
    alpha.runAgent(ALPHA_1, "omp", "tool_use", { lastPromptId: "p-brief" });
    if (behaviour !== "drops") alpha.steersLike(ALPHA_1, behaviour);
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: words },
    });
    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    const writes = alpha.calls.filter((one) =>
      one.startsWith("lifecycle.sendInput:"),
    );
    return { took: (res.structuredContent as { took: unknown }).took, writes };
  }

  it("a steer HELD behind a step omp cannot interrupt is reported as held, after ONE Enter", async () => {
    // The bug: a steer sent while omp ran a long tool call sat in its
    // steering pane, and `agent_say` answered "steer" — words it never saw
    // land. Measured, a held steer is delivered when the step ends, and a
    // second Enter would deliver it by killing the step: so the answer names
    // the hold, and the keys stay ONE Enter.
    const { took, writes } = await steerOmp(
      "holds",
      "STEER-FOUR: also say the word LYCHEE.",
    );
    expect(took).toMatchObject({ observed: "held" });
    expect(writes).toEqual([
      `lifecycle.sendInput:{"id":"${ALPHA_1}","data":"STEER-FOUR: also say the word LYCHEE."}`,
      `lifecycle.sendInput:{"id":"${ALPHA_1}","data":"\\r"}`,
    ]);
  }, 15_000);

  it("a steer the turn TOOK is reported as landed, off the transcript's newest prompt", async () => {
    const { took } = await steerOmp("takes", "skip the review");
    expect(took).toMatchObject({ observed: "landed" });
  });

  it("a steer neither taken nor held is reported as did-not-land — never as delivered", async () => {
    const { took } = await steerOmp("drops", "skip the review");
    expect(took).toMatchObject({ observed: "did-not-land" });
  }, 15_000);

  it("a steer the turn took AS THE WATCH RAN OUT is landed, not did-not-land", async () => {
    // The record a verdict reads is derived from a polled, coalesced
    // transcript read, so a steer taken in the last moment of the cap has
    // left the pane and is not in the record yet. Reading the two
    // back-to-back answered `did-not-land` for words that had landed — and
    // the caller is told to go say it again.
    const { took } = await steerOmp("takes-late", "skip the review");
    expect(took).toMatchObject({ observed: "landed" });
  }, 20_000);

  it("SOMEONE ELSE'S prompt landing in the window is not this steer landing", async () => {
    // An older held steer handed over, or the human typing in that terminal:
    // the newest prompt moves while what was said is still in the input box.
    const { took } = await steerOmp("steals", "skip the review");
    expect(took).toMatchObject({ observed: "did-not-land" });
  }, 20_000);

  it("a terminal that DIES after the keys answers lost-sight, never an error", async () => {
    // The keys were pressed. A failure here reads as "say it again", and
    // there is nothing left to say it to.
    const { took } = await steerOmp("dies", "skip the review");
    expect(took).toMatchObject({ observed: "lost-sight", why: "gone" });
  }, 20_000);

  it("refuses a plain shell, at a reference this face can name", async () => {
    const { fleet } = twoHostFleet();
    const mcp = await servedFleet(fleet.hosts);

    const res = await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "ship it" },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({
      kind: "no-agent",
      id: `local/${ALPHA_1}`,
    });
    expect(JSON.stringify(res.content)).toContain(`local/${ALPHA_1}`);
  });

  it("writes NOTHING when it refuses", async () => {
    const { alpha, fleet } = twoHostFleet();
    const mcp = await servedFleet(fleet.hosts);

    await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "" },
    });

    expect(
      alpha.calls.filter((one) => one.startsWith("lifecycle.sendInput:")),
    ).toEqual([]);
  });
});

describe("the conductor's pieces of work", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  async function servedFleet(
    hosts: FleetHosts,
    works: FleetWorks,
  ): Promise<Client> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      works,
      memory: fakeMemory(),
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    teardown = async () => {
      await mcp.close();
      await close();
    };
    return mcp;
  }

  it("states the rules the Conductor's script leaves to the tools themselves", async () => {
    // `teaching.md` says a rule once, and a rule about one tool is said in
    // THAT tool's description, which the model reads with the tool. These are
    // the rules the script relies on finding here (its inventory ids beside
    // each), read off the face the Conductor is actually handed.
    const { fleet } = twoHostFleet();
    const mcp = await servedFleet(fleet.hosts, fakeWorks());
    const { tools } = await mcp.listTools();
    const said = (name: string): string => {
      const tool = tools.find((one) => one.name === name);
      if (tool === undefined) throw new Error(`the face serves no ${name}`);
      return `${tool.description ?? ""} ${JSON.stringify(tool.inputSchema)}`;
    };
    const rules: ReadonlyArray<readonly [string, string, RegExp]> = [
      ["R16", "work_open", /returns THAT work/],
      ["R20", "work_open", /no parentheses, no issue or PR numbers/],
      ["R21", "work_open", /DECISION/],
      ["R72", "work_open", /kolu OFFERS the harness and model questions/],
      ["R74", "work_open", /the way out when `lifecycle_create` refuses/],
      ["R75", "work_open", /kolu's own words/],
      [
        "R76",
        "work_open",
        /Use `given` for anything the human's request already said/,
      ],
      ["R24", "lifecycle_create", /open the work FIRST/],
      ["R25", "work_adopt", /BASELINE/],
      ["R27", "work_leave", /leaves in silence/],
      ["R29", "work_stop", /ONLY ways a work ends/],
      ["R60", "work_ask", /any of them settles/],
      ["R62", "work_ask", /reasoning about the choice in your PROSE/],
      ["R63", "work_ask", /`header` of two or three words/],
      ["R65", "work_ask", /Give `file`/],
      ["R50", "agent_say", /"began-working"/],
      ["R52", "agent_say", /REFUSED, never guessed/],
    ];
    for (const [rule, tool, pattern] of rules)
      expect(
        said(tool),
        `${rule} is no longer in ${tool}'s description`,
      ).toMatch(pattern);
  });

  const SETUP = [
    { key: "mode", question: "Which mode?", options: ["full", "trivial"] },
    // kolu's own four: NAMED, never offered.
    { key: "planner.harness" },
    { key: "planner.model" },
    { key: "implementor.harness" },
    { key: "implementor.model" },
    {
      key: "on-green",
      question: "On green?",
      options: ["merge", "hand-over"],
    },
  ];

  it("`work_open` states the work and answers the setup as kolu now READS it", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "work_open",
      arguments: {
        title: "a stored piece of work",
        host: "local",
        repo: "/repo",
        branch: "work",
        setup: SETUP,
      },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    // The answer is the setup READ BACK off the decisions, each answer as an
    // ARM — plus the ask the rest went out as. NOTHING WAITED for the human:
    // the call answered with `asked`, and their answers arrive as a wake.
    expect(res.structuredContent).toMatchObject({
      work: "work:1",
      setup: {
        host: "local",
        mode: { kind: "answered", value: "full" },
        onGreen: { kind: "answered", value: "merge" },
        roles: [
          {
            role: "planner",
            setup: {
              kind: "harness-and-model",
              harness: "omp",
              model: "opus",
            },
          },
          {
            role: "implementor",
            setup: {
              kind: "harness-and-model",
              harness: "omp",
              model: "sonnet",
            },
          },
        ],
      },
      ask: "ask:work:1",
      asked: true,
    });
    // THE EDGE: what reached the port is the RECORD's shape — every question
    // carries `given: {kind: "ask"}`, because this call gave no answers. The
    // tool's wire leaves `given` out; nothing below the tool sees that.
    expect(works.opened).toEqual([
      {
        title: "a stored piece of work",
        setup: SETUP.map((one) =>
          "options" in one
            ? {
                key: one.key,
                question: one.question,
                options: one.options,
                given: { kind: "ask" },
              }
            : { key: one.key, given: { kind: "ask" } },
        ),
      },
    ]);
  });

  it("a `given` answer reaches the record as the arm that says the request gave it", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "work_open",
      arguments: {
        title: "a stored piece of work",
        host: "local",
        repo: "/repo",
        branch: "work",
        setup: [
          {
            key: "mode",
            question: "Which mode?",
            options: ["full", "trivial"],
            given: "full",
          },
          { key: "planner.harness", given: "omp" },
          { key: "planner.model" },
        ],
      },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    expect(works.opened.at(0)?.setup).toEqual([
      {
        key: "mode",
        question: "Which mode?",
        options: ["full", "trivial"],
        given: { kind: "given", value: "full" },
      },
      { key: "planner.harness", given: { kind: "given", value: "omp" } },
      { key: "planner.model", given: { kind: "ask" } },
    ]);
  });

  it("the Conductor CANNOT offer a harness or a model — options for kolu's four questions are refused, and nothing opens", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    const mcp = await servedFleet(fleet.hosts, works);
    for (const key of [
      "planner.harness",
      "planner.model",
      "implementor.harness",
      "implementor.model",
    ]) {
      const res = await mcp.callTool({
        name: "work_open",
        arguments: {
          title: "a stored piece of work",
          host: "local",
          repo: "/repo",
          branch: "work",
          setup: SETUP.map((one) =>
            one.key === key
              ? { key, question: "Which one?", options: ["omp", "claude"] }
              : one,
          ),
        },
      });
      expect(res.isError, `${key}: ${JSON.stringify(res.content)}`).toBe(true);
    }
    expect(works.opened).toEqual([]);
  });

  it("a planner is STARTED BY KOLU from the work's saved harness and model, in the harness's own launch words", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const works = fakeWorks();
    works.seed("work:1");
    works.setUp("work:1", "planner", {
      harness: "omp",
      model: "anthropic/claude-fable-5-2",
      launch: MODEL_FLAG,
    });
    works.setUp("work:1", "implementor", {
      harness: "opencode",
      model: "litellm/open-large",
      launch: {
        kind: "config",
        variable: "OPENCODE_CONFIG_CONTENT",
        key: "model",
      },
    });
    const mcp = await servedFleet(fleet.hosts, works);

    const planner = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        work: "work:1",
        role: "planner",
      },
    });
    expect(planner.isError ?? false, JSON.stringify(planner.content)).toBe(
      false,
    );
    // What was typed IS the saved setup, in the flag omp's adapter names.
    expect(planner.structuredContent).toMatchObject({
      ran: "omp --model anthropic/claude-fable-5-2",
    });
    expect(
      alpha.calls.filter((one) => one.startsWith("lifecycle.sendInput")),
    ).toEqual([
      `lifecycle.sendInput:${JSON.stringify({ id: BETA_1, data: "omp --model anthropic/claude-fable-5-2\r" })}`,
    ]);
    expect(works.joinOf(`local/${BETA_1}`)).toBe("created-run");

    // A harness that takes its model in a config layer gets it there.
    const implementor = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        work: "work:1",
        role: "implementor",
      },
    });
    expect(implementor.structuredContent).toMatchObject({
      ran: `OPENCODE_CONFIG_CONTENT='{"model":"litellm/open-large"}' opencode`,
    });
  });

  it("a planner given its own `run` is refused with NOTHING created — the command has one source", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const works = fakeWorks();
    works.seed("work:1");
    works.setUp("work:1", "planner", {
      harness: "omp",
      model: "anthropic/claude-fable-5-2",
      launch: MODEL_FLAG,
    });
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        run: "omp --model anthropic/claude-fable-5-1",
        work: "work:1",
        role: "planner",
      },
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ kind: "run-is-kolus" });
    expect(
      alpha.calls.filter((one) => one.startsWith("lifecycle.create")),
    ).toEqual([]);
    expect(works.refs()).toEqual([]);
  });

  it("a planner whose saved setup kolu no longer offers is refused in kolu's words, NOTHING created", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const works = fakeWorks();
    works.seed("work:1");
    // What kolu-server answers for a planner model saved as words: the
    // answer, and why — `startOf` judged it, and the face passes it on.
    works.setUp(
      "work:1",
      "planner",
      new WorkRefusal(
        "not-offered",
        'The planner of «work:1» cannot start on its saved setup: planner.model: "fable 5.2" is not a model id — a model id is one word, with no spaces. Call `work_open` for this work again — kolu asks the human again for every answer it no longer offers. Nothing was created.',
      ),
    );
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        work: "work:1",
        role: "planner",
      },
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ kind: "not-offered" });
    expect(JSON.stringify(res.content)).toContain(
      '\\"fable 5.2\\" is not a model id',
    );
    // Nothing reached the host: no terminal, and nothing typed.
    expect(
      alpha.calls.filter(
        (one) =>
          one.startsWith("lifecycle.create") ||
          one.startsWith("lifecycle.sendInput"),
      ),
    ).toEqual([]);
  });

  it("a planner whose setup is not answered yet is refused, NOTHING created", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        work: "work:1",
        role: "planner",
      },
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ kind: "missing-setup" });
    expect(
      alpha.calls.filter((one) => one.startsWith("lifecycle.create")),
    ).toEqual([]);
  });

  it("`lifecycle_create` puts what it created INTO the work, in the role it was given", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        work: "work:1",
        role: "other",
      },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    // The FLEET reference, not padi's bare id: the members are read back by
    // tools that only accept `<host>/<id>`, so a bare id here would be a
    // member nothing on this face can name.
    expect(works.refs()).toEqual([`local/${BETA_1}`]);
    expect(works.roleOf(`local/${BETA_1}`)).toBe("other");
    // A bare shell: nothing was asked to run in it, so there is no bring-up
    // that can end without an agent.
    expect(works.joinOf(`local/${BETA_1}`)).toBe("created");
  });

  it("a create WITH a run command joins as a bring-up, not as a bare shell", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        run: "omp",
        work: "work:1",
        role: "other",
      },
    });

    // The difference the server acts on: a terminal whose command ran and
    // came back to the prompt with no agent ever seen is news, where a shell
    // nobody ran anything in is simply a shell.
    expect(works.joinOf(`local/${BETA_1}`)).toBe("created-run");
  });

  it("a create for a work that is not there is refused with NOTHING created", async () => {
    // The rule the whole model rests on: a terminal is made INTO a piece of
    // work. Discovering that the work is unknown after padi had spawned a
    // shell would leave a terminal nobody is watching and no card to find it
    // on, so the check happens before anything is routed anywhere.
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const works = fakeWorks();
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        work: "work:nope",
        role: "implementor",
      },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ kind: "unknown-work" });
    expect(JSON.stringify(res.content)).toContain("Nothing was created");
    expect(
      alpha.calls.filter((one) => one.startsWith("lifecycle.create")),
    ).toEqual([]);
    expect(works.refs()).toEqual([]);
  });

  it("a create with no role at all is refused by the schema", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        work: "work:1",
      },
    });

    expect(res.isError).toBe(true);
    expect(works.refs()).toEqual([]);
  });

  it("a create that FAILS joins nothing", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    alpha.refuseSendInput("pty is gone");
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        run: "claude",
        work: "work:1",
        role: "other",
      },
    });

    // The terminal LANDED (the refusal names it), but the call did not
    // succeed — and the join hangs off the answer, so there is no member. The
    // conductor is told what landed and can adopt it itself.
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ kind: "stopped-partway" });
    expect(works.refs()).toEqual([]);
  });

  it("a kill that LANDS tells the record the Conductor closed it; a refused one tells it nothing", async () => {
    // The defect this guards: the Conductor closed its planner and
    // implementor after a merge and was then woken — `… gone · … gone` — about
    // its own action. The face is where the kill is seen to land, so it is
    // what says so, at the fleet reference the members are keyed by.
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);
    await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `remote:box/${BETA_1}`, work: "work:1", role: "other" },
    });

    const killed = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(killed.isError ?? false, JSON.stringify(killed.content)).toBe(false);
    expect(works.closeds).toEqual([`remote:box/${BETA_1}`]);
    expect(works.refs()).toEqual([]);

    // A kill that never reached padi closed nothing, so the record must not be
    // told it did: that terminal is still there, still worth a `gone`.
    fleet.setState("remote:box", "warming");
    const refused = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(refused.isError).toBe(true);
    expect(works.closeds).toEqual([`remote:box/${BETA_1}`]);
  });

  it("`work_adopt` adds a terminal that exists, and answers the members AND what it found", async () => {
    const { beta, fleet } = twoHostFleet();
    beta.runAgent(BETA_1, "codex", "thinking");
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "work_adopt",
      arguments: {
        id: `remote:box/${BETA_1}`,
        work: "work:1",
        role: "implementor",
      },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    // The found state is the BASELINE — the conductor is told it here
    // precisely because it will never arrive as a wake.
    expect(res.structuredContent).toEqual({
      work: "work:1",
      role: "implementor",
      members: [`remote:box/${BETA_1}`],
      found: { kind: "agent", agent: "codex", bucket: "working" },
    });
    expect(works.refs()).toEqual([`remote:box/${BETA_1}`]);
    expect(works.joinOf(`remote:box/${BETA_1}`)).toBe("asked");
  });

  it("adopting into a work that is not there is refused, and reads nothing", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "work_adopt",
      arguments: {
        id: `remote:box/${BETA_1}`,
        work: "work:gone",
        role: "other",
      },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ kind: "unknown-work" });
    expect(works.refs()).toEqual([]);
  });

  it("a terminal with no agent, and one that is asleep, are each said plainly", async () => {
    const { alpha, fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const shell = await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `local/${ALPHA_1}`, work: "work:1", role: "other" },
    });
    expect(shell.structuredContent).toMatchObject({
      found: { kind: "no-agent" },
    });

    // A dormant terminal is adoptable (the human may wake it), and the answer
    // says so rather than calling it a plain shell.
    alpha.park(ALPHA_2, "parked");
    const parked = await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `local/${ALPHA_2}`, work: "work:1", role: "other" },
    });
    expect(parked.structuredContent).toMatchObject({
      found: { kind: "asleep", state: "parked" },
    });
  });

  it("adopting the same terminal twice does not duplicate it", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `local/${ALPHA_1}`, work: "work:1", role: "other" },
    });
    const res = await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `local/${ALPHA_1}`, work: "work:1", role: "other" },
    });

    // A re-adopt still answers the found state — the question "what is it
    // doing now" is worth answering every time — and the membership is
    // unmoved.
    expect(res.structuredContent).toMatchObject({
      members: [`local/${ALPHA_1}`],
      found: { kind: "no-agent" },
    });
    expect(works.refs()).toEqual([`local/${ALPHA_1}`]);
  });

  it("refuses a terminal that is not in its host's roster, instead of adopting silence", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `local/${BETA_1}`, work: "work:1", role: "other" },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({
      kind: "terminal-not-in-roster",
    });
    expect(works.refs()).toEqual([]);
  });

  it("refuses a disconnected host BY NAME, and a host nobody has", async () => {
    const { fleet } = twoHostFleet();
    fleet.setState("remote:box", "warming");
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const warming = await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `remote:box/${BETA_1}`, work: "work:1", role: "other" },
    });
    expect(warming.isError).toBe(true);
    expect(warming.structuredContent).toMatchObject({
      kind: "host-not-connected",
      host: "remote:box",
    });

    const stranger = await mcp.callTool({
      name: "work_adopt",
      arguments: {
        id: `remote:elsewhere/${BETA_1}`,
        work: "work:1",
        role: "other",
      },
    });
    expect(stranger.isError).toBe(true);
    expect(stranger.structuredContent).toMatchObject({ kind: "unknown-host" });
    expect(works.refs()).toEqual([]);
  });

  it("`work_leave` takes a member out, and says plainly when there was nothing to take", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);
    await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `local/${ALPHA_1}`, work: "work:1", role: "other" },
    });

    const left = await mcp.callTool({
      name: "work_leave",
      arguments: { id: `local/${ALPHA_1}` },
    });
    expect(left.structuredContent).toEqual({
      left: { kind: "left", work: "work:1" },
    });

    // A terminal that already died has left by itself, so letting it go again
    // says `not-a-member` — never an error a conductor has to handle.
    const again = await mcp.callTool({
      name: "work_leave",
      arguments: { id: `local/${ALPHA_1}` },
    });
    expect(again.structuredContent).toEqual({ left: { kind: "not-a-member" } });
  });

  it("letting go of a terminal that is GONE still works — the roster is not consulted", async () => {
    const { alpha, fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);
    await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `local/${ALPHA_1}`, work: "work:1", role: "other" },
    });

    alpha.remove(ALPHA_1);
    const res = await mcp.callTool({
      name: "work_leave",
      arguments: { id: `local/${ALPHA_1}` },
    });

    expect(res.isError ?? false).toBe(false);
    expect(res.structuredContent).toEqual({
      left: { kind: "left", work: "work:1" },
    });
  });

  it("`work_ask` puts questions about a work and answers AT ONCE", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "work_ask",
      arguments: {
        work: "work:1",
        questions: [
          {
            header: "Plan approval",
            question: "Approve the plan?",
            options: ["approve", "revise"],
            file: ".waterfall/plan.md",
          },
        ],
      },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    // THE ASK, and the sentence that says the turn is over. No answers: the
    // human has not seen the question yet, and the call did not wait to find
    // out — which is what keeps an MCP client's five-minute tool deadline off
    // a person reading a plan.
    const asked = res.structuredContent as { ask: string; said: string };
    expect(asked.ask).toMatch(/^ask:/);
    expect(asked.said).toContain("END YOUR TURN");
    expect(asked).not.toHaveProperty("answers");
    // ... and what reached the record: the ARMS. The tool's wire leaves out
    // what it was not told (`multiple`, `file`), and the question put on the
    // work says which of the two it is instead.
    expect(works.asks).toEqual([
      {
        work: "work:1",
        questions: [
          {
            header: { kind: "header", text: "Plan approval" },
            question: "Approve the plan?",
            options: ["approve", "revise"],
            multiple: false,
            file: { kind: "file", path: ".waterfall/plan.md" },
          },
        ],
      },
    ]);
  });

  it("a question about no file and no multiple pick says so in its own arms", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    await mcp.callTool({
      name: "work_ask",
      arguments: {
        work: "work:1",
        questions: [
          {
            header: "Failing check",
            question: "What now?",
            options: ["retry", "revert"],
            multiple: true,
          },
        ],
      },
    });

    expect(works.asks.at(0)?.questions).toEqual([
      {
        header: { kind: "header", text: "Failing check" },
        question: "What now?",
        options: ["retry", "revert"],
        multiple: true,
        file: { kind: "none" },
      },
    ]);
  });

  it("`work_note` writes one line on the timeline and nothing else", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);

    const res = await mcp.callTool({
      name: "work_note",
      arguments: { work: "work:1", text: "waiting on the human's laptop" },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    expect(works.notes).toEqual([
      { work: "work:1", text: "waiting on the human's laptop" },
    ]);
  });

  it("`works` reads the record back — the members, their hosts as the fleet stands NOW, and the last thing kolu saw", async () => {
    // The failure this resource exists for: a Conductor that had restarted
    // could move its work and never read it, so it said it was "not certain"
    // what it was running and then adopted terminals that were long gone.
    const { beta, fleet } = twoHostFleet();
    beta.runAgent(BETA_1, "codex", "thinking");
    const works = fakeWorks();
    works.seed("work:1", "a stored piece of work");
    const mcp = await servedFleet(fleet.hosts, works);
    await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `local/${ALPHA_1}`, work: "work:1", role: "planner" },
    });
    await mcp.callTool({
      name: "work_adopt",
      arguments: {
        id: `remote:box/${BETA_1}`,
        work: "work:1",
        role: "implementor",
      },
    });
    // What the server's watcher writes back between turns, and the only place
    // a name or an agent on a member comes from.
    works.sawIn(`remote:box/${BETA_1}`, "the implementor", "codex");

    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/works" })),
    ).toEqual({
      works: [
        {
          id: "work:1",
          title: "a stored piece of work",
          key: {
            kind: "branch",
            host: "local",
            repo: "/repo",
            branch: "work",
            repoBy: "git",
          },
          host: "local",
          mode: { kind: "answered", value: "full" },
          onGreen: { kind: "answered", value: "merge" },
          standing: {
            who: "agent",
            what: "agents at work",
            since: "2026-01-01",
          },
          openQuestions: [],
          members: [
            {
              ref: `local/${ALPHA_1}`,
              role: "planner",
              // Nothing has read it yet — said as `null` rather than as a
              // terminal that is called nothing.
              name: null,
              agent: null,
              joined: "asked",
              hostName: "this machine",
              hostState: "connected",
              // The Conductor drives it — nobody has taken it over.
              driver: "conductor",
            },
            {
              ref: `remote:box/${BETA_1}`,
              role: "implementor",
              name: "the implementor",
              agent: "codex",
              joined: "asked",
              hostName: "box",
              hostState: "connected",
              driver: "conductor",
            },
          ],
        },
      ],
      finished: [],
    });
  });

  it("a member whose host is NOT answering says so, and one whose host has left keeps its row", async () => {
    // Both halves matter to an agent deciding what it still has: a warming
    // host is one to wait for, and a host that is gone is one to let go of.
    // Dropping the second member would read as a work that never had it.
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);
    await mcp.callTool({
      name: "work_adopt",
      arguments: {
        id: `remote:box/${BETA_1}`,
        work: "work:1",
        role: "implementor",
      },
    });

    fleet.setState("remote:box", "warming");
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/works" })),
    ).toMatchObject({
      works: [{ members: [{ hostName: "box", hostState: "warming" }] }],
    });

    fleet.leave("remote:box");
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/works" })),
    ).toMatchObject({
      works: [
        {
          members: [
            {
              ref: `remote:box/${BETA_1}`,
              // Nothing is invented for a host this fleet no longer holds:
              // the member is still part of the work, and there is nothing to
              // reach it through.
              hostName: null,
              hostState: null,
            },
          ],
        },
      ],
    });
  });

  it("a finished work is still named, with how it ended", async () => {
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1", "the merged one");
    const mcp = await servedFleet(fleet.hosts, works);

    works.end("work:1");

    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/works" })),
    ).toMatchObject({
      works: [],
      finished: [
        {
          id: "work:1",
          title: "the merged one",
          outcome: { kind: "merged", pr: 1 },
        },
      ],
    });
  });

  it("a subscriber hears a move nobody on this face made", async () => {
    // The record changes under the conversation — an agent stops, a member
    // terminal goes away, a person answers a question in the browser — and a
    // conductor that only learned of it by calling something would act on a
    // terminal that is not there. The subscription is how it hears instead.
    const { fleet } = twoHostFleet();
    const works = fakeWorks();
    works.seed("work:1");
    const mcp = await servedFleet(fleet.hosts, works);
    await mcp.callTool({
      name: "work_adopt",
      arguments: { id: `local/${ALPHA_1}`, work: "work:1", role: "other" },
    });
    const updates: string[] = [];
    mcp.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
      updates.push(note.params.uri);
    });
    await mcp.subscribeResource({ uri: "surface://cells/works" });
    // Whatever subscribing itself announces has landed by the time a round
    // trip to the same server has: the count below is what the MOVE adds.
    await mcp.readResource({ uri: "surface://cells/works" });
    const before = updates.length;

    // The move this face did NOT make: kolu-server dropping a member that
    // went away.
    works.leave(`local/${ALPHA_1}`);

    await vi.waitFor(() => {
      expect(updates.length).toBeGreaterThan(before);
    });
    expect(updates.at(-1)).toBe("surface://cells/works");
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/works" })),
    ).toMatchObject({ works: [{ members: [] }] });
  });
});

describe("one expose map, two projections", () => {
  const resolved = () => ({
    stdio: resolveExpose(padiSurface.spec, KOLU_MCP_EXPOSE, undefined),
    fleet: resolveExpose(fleetSurface.spec, KOLU_FLEET_EXPOSE, undefined),
  });
  const names = (one: ReturnType<typeof resolveExpose>): string[] =>
    one.tools.map((tool) => tool.name).sort();

  it("both projections mint the same TERMINAL verbs", () => {
    const { stdio, fleet } = resolved();
    expect(names(stdio)).toEqual([
      // Stdio only — it reads one host's padi, and `fleetSurface` declares no
      // per-host member to hang it on.
      "diagnostics_read",
      "fs_listAll",
      "fs_readFile",
      "git_getDiff",
      "git_getStatus",
      "lifecycle_kill",
      "screen_history",
      // Stdio only — the fleet face serves no standing subscription at all.
      "watch_close",
    ]);
    expect(names(fleet)).toEqual([
      "fs_listAll",
      "fs_readFile",
      "git_getDiff",
      "git_getStatus",
      "lifecycle_kill",
      "screen_history",
    ]);
    // What may be DONE to a terminal is still one list: the only difference is
    // the subscription verb, which has no member on the fleet surface to hang
    // on.
    const mutates = (one: ReturnType<typeof resolveExpose>) =>
      Object.fromEntries(one.tools.map((tool) => [tool.name, tool.mutates]));
    for (const name of names(fleet)) {
      expect(mutates(fleet)[name]).toBe(mutates(stdio)[name]);
    }
  });

  it("the RESOURCE lists differ exactly as the module doc argues", () => {
    const { stdio, fleet } = resolved();
    expect(stdio.resources.map((r) => r.key).sort()).toEqual([
      "daemonStatus",
      "identity",
      "status",
      "terminals",
      "urgency",
    ]);
    expect(fleet.resources.map((r) => r.key).sort()).toEqual([
      "hosts",
      // The two resources the stdio face has no counterpart for: this face
      // serves one conversation's RECORD — kolu's pieces of work, and what
      // the Conductor remembers.
      "memory",
      "terminals",
      "urgency",
      "works",
    ]);
    // ... and `hosts` is a CELL, which is what makes the roster one read: a
    // collection's resource is its key SET plus a per-item template, and an
    // agent that reads a key set still knows nothing about any host in it.
    expect(fleet.resources.find((r) => r.key === "hosts")?.kind).toBe("cell");
    expect(fleet.resourceTemplates.map((t) => t.key)).toEqual(["terminals"]);
  });

  it("the served fleet face serves the conductor's set — and NOT the waits that never end", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts: fleet.hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      works: fakeWorks(),
      memory: fakeMemory(),
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    try {
      const { tools } = await mcp.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "agent_say",
        "fs_listAll",
        "fs_readFile",
        "git_getDiff",
        "git_getStatus",
        "lifecycle_create",
        "lifecycle_kill",
        "lifecycle_sendInput",
        "memory_propose",
        "screen_history",
        "screen_image",
        "screen_text",
        "wait_outputSettled",
        "work_adopt",
        "work_ask",
        "work_leave",
        "work_note",
        "work_open",
        "work_stop",
      ]);
      // The removed four, named so a re-addition is a deliberate edit to this
      // list rather than a quiet widening: each is a call with no end, and the
      // conductor's turn is a conversation a human may be trying to speak into.
      for (const gone of [
        "wait_agentState",
        "watch_open",
        "watch_next",
        "watch_close",
      ]) {
        expect(tools.map((tool) => tool.name)).not.toContain(gone);
      }
      // `kolu mcp` keeps every one of them — the reduction is this face's, not
      // the tool table's.
      expect(Object.keys(KOLU_MCP_TOOLS).sort()).toEqual([
        "agent_say",
        "lifecycle_create",
        "lifecycle_sendInput",
        "screen_image",
        "screen_text",
        "wait_agentState",
        "wait_outputSettled",
        "watch_next",
        "watch_open",
      ]);
      // The static roll the conductor's teaching script is pinned against —
      // every name in it is actually served, and nothing served is missing
      // from it. (The raw-procedure tools come from the expose map, not this
      // list, so they are subtracted rather than expected here.)
      const served = tools.map((tool) => tool.name);
      expect([...KOLU_FLEET_TOOL_NAMES].sort()).toEqual([
        "agent_say",
        "lifecycle_create",
        "lifecycle_sendInput",
        "memory_propose",
        "screen_image",
        "screen_text",
        "wait_outputSettled",
        "work_adopt",
        "work_ask",
        "work_leave",
        "work_note",
        "work_open",
        "work_stop",
      ]);
      for (const name of KOLU_FLEET_TOOL_NAMES) {
        expect(served).toContain(name);
      }
    } finally {
      await mcp.close();
      await close();
    }
  });

  it("the fleet `wait_outputSettled` REFUSES a wait longer than the cap", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts: fleet.hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      works: fakeWorks(),
      memory: fakeMemory(),
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    try {
      const res = await mcp.callTool({
        name: "wait_outputSettled",
        arguments: {
          id: `local/${ALPHA_1}`,
          idleMs: FLEET_SETTLE_CAP_MS + 1,
        },
      });
      // REFUSED, not clamped: a clamp answers "met" after three seconds to a
      // caller that believed it had waited ten minutes.
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain(
        String(FLEET_SETTLE_CAP_MS),
      );
      // The cap is advertised, so a model reads it before it tries.
      const { tools } = await mcp.listTools();
      const wait = tools.find((tool) => tool.name === "wait_outputSettled");
      expect(JSON.stringify(wait?.inputSchema)).toContain(
        String(FLEET_SETTLE_CAP_MS),
      );
    } finally {
      await mcp.close();
      await close();
    }
  });
});

describe("the Conductor's memory, on the fleet face", () => {
  const served = async (
    memory: FakeMemory,
  ): Promise<{ mcp: Client; close: () => Promise<void> }> => {
    const fleet = fakeFleet([
      {
        key: "local",
        display: "this machine",
        padi: fakePadi("local", [ALPHA_1]),
      },
    ]);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts: fleet.hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      works: fakeWorks(),
      memory,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    return {
      mcp,
      close: async () => {
        await mcp.close();
        await close();
      },
    };
  };

  it("serves the memory as a resource: the entries, the waiting titles and the room", async () => {
    const memory = fakeMemory();
    memory.set({
      entries: [
        {
          id: "m1",
          title: "Squash-merge on demo-app",
          about: "demo-app",
          body: "Always squash.",
        },
      ],
      waiting: [{ id: "p2", title: "Never merge on a Friday" }],
      room: { used: 38, of: 16_000 },
    });
    const { mcp, close } = await served(memory);
    try {
      expect(
        jsonOf(await mcp.readResource({ uri: "surface://cells/memory" })),
      ).toEqual(memory.view());
    } finally {
      await close();
    }
  });

  it("answers a proposal at once with its id, waiting on the human", async () => {
    const memory = fakeMemory();
    const { mcp, close } = await served(memory);
    try {
      const res = await mcp.callTool({
        name: "memory_propose",
        arguments: {
          kind: "add",
          title: "Run the linter before opening a pull request",
          about: "demo-app",
          body: "`just lint` must pass first.",
          why: "you said so on «Fix the login error»",
        },
      });
      expect(res.isError ?? false).toBe(false);
      expect(res.structuredContent).toMatchObject({ proposal: "p1" });
      expect(memory.proposed).toEqual([
        {
          change: {
            kind: "add",
            title: "Run the linter before opening a pull request",
            about: "demo-app",
            body: "`just lint` must pass first.",
          },
          why: "you said so on «Fix the login error»",
        },
      ]);
    } finally {
      await close();
    }
  });

  it("fails a refused proposal with the reason, and one missing what its kind needs", async () => {
    const memory = fakeMemory();
    const { mcp, close } = await served(memory);
    try {
      memory.refuseWith(
        "The human declined this on 20 Nov. It is not remembered. Do not propose it again.",
      );
      const refused = await mcp.callTool({
        name: "memory_propose",
        arguments: { kind: "forget", entry: "m3" },
      });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain(
        "refused: The human declined this on 20 Nov.",
      );
      memory.refuseWith(null);
      const misused = await mcp.callTool({
        name: "memory_propose",
        arguments: { kind: "replace", title: "No entry named" },
      });
      expect(misused.isError).toBe(true);
      expect(memory.proposed).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("the key `work_open` names, parsed at the door", () => {
  /** The key, or the refusal's detail — run the parse to its end. */
  const parse = (
    hosts: FleetHosts,
    args: Parameters<typeof parseWorkKey>[1],
  ): Promise<unknown> =>
    Effect.runPromise(
      Effect.match(parseWorkKey(hosts, args), {
        onSuccess: (key) => ({ key }),
        onFailure: (failure) => ({ refused: failure.detail }),
      }),
    );

  it("names ONE work for the root, a linked worktree and a trailing slash", async () => {
    const { fleet } = twoHostFleet();
    const ids = new Set<string>();
    for (const repo of ["/repo", "/repo/.worktrees/work", "/repo/"]) {
      const parsed = await parse(fleet.hosts, {
        title: "t",
        host: "local",
        repo,
        branch: "work",
      });
      expect(parsed, repo).toEqual({
        key: {
          kind: "branch",
          host: "local",
          repo: "/repo",
          branch: "work",
          repoBy: "git",
        },
      });
      ids.add(JSON.stringify(parsed));
    }
    expect(ids.size).toBe(1);
  });

  it("refuses a path that is no repository, and says git's reason when git will not answer", async () => {
    const { fleet } = twoHostFleet();
    expect(
      await parse(fleet.hosts, {
        title: "t",
        host: "local",
        repo: "/elsewhere",
        branch: "work",
      }),
    ).toEqual({
      refused: { kind: "not-a-repository", host: "local", repo: "/elsewhere" },
    });
    expect(
      await parse(fleet.hosts, {
        title: "t",
        host: "local",
        repo: "/broken",
        branch: "work",
      }),
    ).toMatchObject({
      refused: { kind: "git-unavailable", reason: "git hung" },
    });
  });

  it("refuses a host the fleet does not hold, or one that is not answering", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: null, state: "failed" },
    ]);
    expect(
      await parse(fleet.hosts, {
        title: "t",
        host: "remote:nowhere",
        repo: "/repo",
        branch: "work",
      }),
    ).toMatchObject({ refused: { kind: "unknown-host" } });
    expect(
      await parse(fleet.hosts, {
        title: "t",
        host: "remote:box",
        repo: "/repo",
        branch: "work",
      }),
    ).toMatchObject({ refused: { kind: "host-not-connected" } });
  });

  it("parses a watch into its host and id, and refuses one that is no ref or names no terminal", async () => {
    const { fleet } = twoHostFleet();
    expect(
      await parse(fleet.hosts, {
        title: "t",
        watch: `remote:box/${BETA_1}`,
      }),
    ).toEqual({ key: { kind: "watch", host: "remote:box", id: BETA_1 } });
    expect(
      await parse(fleet.hosts, { title: "t", watch: "no-ref" }),
    ).toMatchObject({ refused: { kind: "not-a-fleet-ref" } });
    expect(
      await parse(fleet.hosts, { title: "t", watch: `local/${BETA_1}` }),
    ).toMatchObject({ refused: { kind: "terminal-not-in-roster" } });
  });

  it("refuses a request that names no machine", async () => {
    const { fleet } = twoHostFleet();
    expect(
      await parse(fleet.hosts, { title: "t", repo: "/repo", branch: "work" }),
    ).toMatchObject({ refused: { kind: "missing-setup" } });
  });
});
