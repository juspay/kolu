/**
 * The bespoke tools, LIFTED — not forked.
 *
 * `KOLU_MCP_TOOLS` is the kolu face's verb table: the worktree-capable create,
 * the named-key send, the tail-mode read, the themed screenshot, the two
 * composite waits. Each handler takes a padi client for ONE host and knows
 * nothing about a fleet, and that is exactly right — the composition it
 * performs (worktree → create → sendInput; the submit discipline; the wait's
 * conjunct) is per-host work. A second fleet-shaped copy of those compositions
 * would be two tables that have to agree forever about what `lifecycle_create`
 * does, and they would stop agreeing the first time one of them was fixed.
 *
 * So the fleet face WRAPS each one. The wrapper does three things and nothing
 * else:
 *
 *   1. **Route** — read the host out of the args: either a fleet reference
 *      (`id`), or an explicit `host` for the verb that addresses no terminal
 *      yet (`lifecycle_create` makes one).
 *   2. **Bare** — hand the per-host handler the ids it expects, so it is given
 *      exactly what `kolu mcp` would have given it.
 *   3. **Re-qualify** — put the host back onto every id in the answer, so an id
 *      a caller reads back is one it can call again.
 *
 * {@link FLEET_LIFTS} is that grammar as a TABLE, beside the tools rather than
 * scattered through six wrappers: the whole id vocabulary of this face is one
 * screen, and a tool that grows an id-bearing field is a one-row diff. A field
 * missing from the table does not fail at the wrapper — it reaches padi as
 * `local/3f1c…` and comes back as a terminal that does not exist, which is
 * precisely the failure a table of the id fields exists to make visible.
 *
 * **The fleet face is a SUBSET, and that is the point.** The stdio `kolu mcp`
 * face serves every verb it ever did; the table below is what the CONDUCTOR
 * gets, and three things are deliberately absent from it:
 * `wait_agentState`, `watch_open`/`watch_next` — every one of them a wait with
 * no end. The conductor's whole discipline is to say what it watches and END
 * its turn, and a tool that blocks is how a script drifts back into holding a
 * conversation open for twenty minutes while a human's words sit queued behind
 * it. `wait_outputSettled` survives because the settle between typing and
 * Enter is genuinely needed — hard-capped at {@link FLEET_SETTLE_CAP_MS}, as a
 * schema check so the REFUSAL teaches the cap rather than a silent clamp
 * pretending the call was honoured.
 *
 * In their place the fleet face adds the two tools that move the watch list
 * (`./watchList.ts`), and `lifecycle_create` watches what it creates: the
 * conductor does not have to ask for news about a worker it just started, and
 * a create whose watch the agent forgot is a worker nobody is listening to.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { PLACEMENT_REQUIRED } from "@kolu/padi-client/surface";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect, Schema } from "effect";
import { CreateArgsSchema } from "../create.ts";
import { AgentSayArgsSchema } from "../say.ts";
import { ScreenImageArgsSchema } from "../screenImage.ts";
import { ScreenTextArgsSchema } from "../screenText.ts";
import { SendInputArgsSchema } from "../sendInput.ts";
import { KOLU_MCP_TOOLS } from "../tools.ts";
import { MillisecondsSchema, WaitOutputSettledArgsSchema } from "../wait.ts";
import { type FleetHosts, requireHost, requireTerminal } from "./hosts.ts";
import { fleetTerminalRef, splitFleetTerminalRef } from "./ref.ts";
import { FleetHostKeySchema, FleetTerminalRefSchema } from "./refSchema.ts";
import {
  type FleetWatchJoin,
  type FleetWatchList,
  unwatchTerminalTool,
  watchTerminalTool,
} from "./watchList.ts";

/** What every lifted description gains. ONE sentence, appended rather than
 *  woven in: the per-host blurbs are written and pinned where they are, and a
 *  fleet-shaped rewrite of each would be the same fork one level down, in
 *  prose. */
const FLEET_NOTE =
  "On this face a terminal is addressed as <host>/<id> — the host key from the `hosts` resource, a slash, and the terminal id.";

/** The hard ceiling on the one wait this face still serves, in milliseconds.
 *
 *  Three seconds, because of what the wait is FOR: a TUI's paste debounce
 *  between typing text and pressing Enter, which is tens of milliseconds of
 *  redraw. Anything longer is somebody waiting on an AGENT — the exact move
 *  this face exists to make impossible, since the conductor's turn is a
 *  conversation a human may be trying to speak into. A worker's news arrives
 *  by WAKE now, not by a wait held open here. */
export const FLEET_SETTLE_CAP_MS = 3_000;

/** The cap, as the decoder's own rule: the shared positive-integer
 *  milliseconds field with {@link FLEET_SETTLE_CAP_MS} as a second check, so an
 *  over-long value is REFUSED with the bound in the message before any
 *  subscription opens. Both millisecond fields of `wait_outputSettled` are
 *  spelled with it below. */
const cappedMs = (description: string): Schema.Number =>
  MillisecondsSchema(description).check(
    Schema.isLessThanOrEqualTo(FLEET_SETTLE_CAP_MS),
  );

/** padi's placement sum, with the parent at a fleet reference. The arms and the
 *  refusal sentence are padi's own; only the id type moves, which is the whole
 *  of what this face changes. */
const FleetPlacementSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("toplevel") }),
  Schema.Struct({
    kind: Schema.Literal("child-of"),
    parentId: FleetTerminalRefSchema,
  }),
]).annotate({ message: PLACEMENT_REQUIRED, description: PLACEMENT_REQUIRED });

/** One lifted tool's whole id grammar: the input an agent is advertised, where
 *  the HOST comes from, which other arguments carry a reference, which answer
 *  keys carry a bare id — and which keys of a REFUSAL do.
 *
 *  `from` is the routing rule: `{ ref }` names an argument holding a fleet
 *  reference (bared on the way in), `{ host: true }` the explicit `host` key
 *  (removed on the way in — padi has never heard of it). Every path in `refs`
 *  is refused when it names a host other than the one the call routes to: a
 *  split inside a terminal on another machine is not something a canvas can
 *  paint, and silently creating it top-level is the flattening padi's required
 *  placement exists to prevent. */
interface FleetLift {
  readonly input: BespokeTool["input"];
  readonly from: { readonly ref: string } | { readonly host: true };
  readonly refs: readonly string[];
  readonly answers: readonly string[];
  /** Dotted paths into a {@link ToolFailure}'s detail that name a terminal the
   *  call CREATED before it stopped. A refusal is the one answer whose ids
   *  matter most — `stopped-partway` exists so an agent can kill what landed —
   *  and a bare id there is refused by the very tool it names ("not a fleet
   *  terminal reference"), leaving an orphan nothing can address. The same
   *  applies to a refusal that names the terminal it was ABOUT — the
   *  asleep refusal's `id` (`asleep.ts`): "Terminal t-7 is asleep" tells an
   *  agent on this face to wake an id no tool here accepts, so that path is
   *  listed too and the prose is rewritten beside it. */
  readonly refusals: readonly string[];
  /** An ANSWER path whose fleet reference is added to the conductor's watch
   *  list once the call succeeds, and HOW that terminal joined (read off the
   *  call's own arguments — a create with a `run` command is a different kind
   *  of entry from a bare shell, because only the first can fail by never
   *  growing an agent). Only `lifecycle_create` has one, and it is stated as a
   *  row of this table rather than buried in that tool's wrapper because it is
   *  the same kind of fact as the others here: where in an answer a terminal
   *  reference lives. */
  readonly watches?: {
    readonly answer: string;
    readonly joined: (args: Record<string, unknown>) => FleetWatchJoin;
  };
  /** An ARGUMENT path naming the terminal this call SPOKE to. Only
   *  `agent_say` has one: once its keys have landed, the conductor has acted
   *  on whatever that terminal was doing, so the news held about it is stale
   *  and the list is told (`said`). Read off the arguments rather than the
   *  answer because that is where `agent_say` carries its reference — and the
   *  pre-route arguments still hold the FLEET spelling, which is what the list
   *  is keyed by. */
  readonly says?: string;
}

/** THE id grammar of the fleet face, in one place. Each input is the per-host
 *  tool's OWN field set with the id-bearing fields re-typed — spread, never
 *  restated, so a field added to a tool arrives here and a field renamed there
 *  stops this compiling. */
const FLEET_LIFTS: Readonly<Record<string, FleetLift>> = {
  lifecycle_create: {
    input: Schema.Struct({
      ...CreateArgsSchema.fields,
      host: FleetHostKeySchema.annotate({
        description:
          "Which host to create the terminal ON — create it where the repository lives. The `hosts` resource is the roster.",
      }),
      placement: FleetPlacementSchema,
    }),
    from: { host: true },
    refs: ["placement.parentId"],
    answers: ["id"],
    refusals: ["landed.id", "id"],
    watches: {
      answer: "id",
      // A `run` command is the difference between "a shell I opened" and "a
      // bring-up I started": only the second can end with the command gone and
      // no agent ever there, which is the one thing the Conductor must hear
      // about rather than wait on for ever.
      joined: (args) =>
        typeof args.run === "string" ? "created-run" : "created",
    },
  },
  agent_say: {
    input: Schema.Struct({
      ...AgentSayArgsSchema.fields,
      id: FleetTerminalRefSchema,
    }),
    from: { ref: "id" },
    refs: [],
    answers: [],
    refusals: ["id"],
    says: "id",
  },
  lifecycle_sendInput: {
    input: Schema.Struct({
      ...SendInputArgsSchema.fields,
      id: FleetTerminalRefSchema,
    }),
    from: { ref: "id" },
    refs: [],
    answers: [],
    refusals: ["id"],
  },
  screen_text: {
    input: Schema.Struct({
      ...ScreenTextArgsSchema.fields,
      id: FleetTerminalRefSchema,
    }),
    from: { ref: "id" },
    refs: [],
    answers: [],
    refusals: ["id"],
  },
  screen_image: {
    input: Schema.Struct({
      ...ScreenImageArgsSchema.fields,
      id: FleetTerminalRefSchema,
    }),
    from: { ref: "id" },
    refs: [],
    answers: [],
    refusals: ["id"],
  },
  wait_outputSettled: {
    // The ONE wait the conductor keeps, and it is re-typed rather than spread
    // whole: both millisecond fields are capped at {@link FLEET_SETTLE_CAP_MS}
    // by a SCHEMA check, so an over-long value is refused with the bound in the
    // message and the cap is in the tool's advertised description. A clamp
    // would have answered "met" after three seconds to a caller that believed
    // it had waited ten minutes — the same lie as a blocking tool, told
    // quietly.
    input: Schema.Struct({
      ...WaitOutputSettledArgsSchema.fields,
      id: FleetTerminalRefSchema,
      idleMs: cappedMs(
        `Resolve once no output has arrived for this many milliseconds — the settle between typing and submitting (e.g. 800). At most ${FLEET_SETTLE_CAP_MS} on this face.`,
      ),
      timeoutMs: Schema.optionalKey(
        cappedMs(
          `Give up after this many milliseconds (result: "timeout"). At most ${FLEET_SETTLE_CAP_MS} on this face, and that is also the default ceiling: this tool is the short settle before a keystroke, never a way to wait on an agent.`,
        ),
      ),
    }),
    from: { ref: "id" },
    refs: [],
    answers: ["id"],
    refusals: ["id"],
  },
};

/** Read a dotted path. Two levels is the whole grammar
 *  (`placement.parentId`), and the walk is shared with {@link withPath} so the
 *  reader and the writer cannot disagree about where a field is. */
function atPath(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((at, key) => {
    if (at === null || typeof at !== "object") return undefined;
    return (at as Record<string, unknown>)[key];
  }, value);
}

/** The same object with one dotted path replaced — copying each level it
 *  rewrites, so the caller's args are never mutated under it. */
function withPath(
  value: Record<string, unknown>,
  path: string,
  next: string,
): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  if (head === undefined) return value;
  if (rest.length === 0) return { ...value, [head]: next };
  const inner = value[head];
  if (inner === null || typeof inner !== "object") return value;
  return {
    ...value,
    [head]: withPath(inner as Record<string, unknown>, rest.join("."), next),
  };
}

/** One routed call: which host answers it, and the args as the per-host handler
 *  expects to receive them. */
interface Routed {
  readonly host: string;
  readonly padi: PadiSurfaceClient;
  readonly bare: Record<string, unknown>;
}

/** Steps 1 and 2 — the host, and the args bared of every reference. */
function route(
  hosts: FleetHosts,
  lift: FleetLift,
  args: Record<string, unknown>,
): Effect.Effect<Routed, ToolFailure> {
  const from = lift.from;
  const routed: Effect.Effect<Routed, ToolFailure> =
    "host" in from
      ? Effect.map(requireHost(hosts, String(args.host ?? "")), (padi) => {
          const { host: named, ...bare } = args;
          return { host: String(named ?? ""), padi, bare };
        })
      : Effect.map(
          requireTerminal(hosts, String(atPath(args, from.ref) ?? "")),
          ({ host, id, padi }) => ({
            host,
            padi,
            bare: withPath(args, from.ref, id),
          }),
        );
  return Effect.flatMap(routed, (call): Effect.Effect<Routed, ToolFailure> => {
    let bare = call.bare;
    for (const path of lift.refs) {
      const value = atPath(bare, path);
      // Absent is fine — a `toplevel` placement has no parent. Present and not
      // a string is the decoder's business, not this one's.
      if (typeof value !== "string") continue;
      const split = splitFleetTerminalRef(value);
      if (split === null) {
        return Effect.fail(
          new ToolFailure(
            `${path} must be a fleet terminal reference (<host>/<id>), not ${JSON.stringify(value)}.`,
            { kind: "not-a-fleet-ref", field: path, ref: value },
          ),
        );
      }
      if (split.host !== call.host) {
        return Effect.fail(
          new ToolFailure(
            `${path} names a terminal on ${JSON.stringify(split.host)}, but this call runs on ${JSON.stringify(call.host)}. A terminal is split inside a parent on its OWN host — create it on ${JSON.stringify(split.host)}, or name a parent that lives on ${JSON.stringify(call.host)}.`,
            {
              kind: "cross-host-reference",
              field: path,
              host: call.host,
              named: split.host,
            },
          ),
        );
      }
      bare = withPath(bare, path, split.id);
    }
    return Effect.succeed({ ...call, bare });
  });
}

/** Step 3 — the host, put back on every id at these paths. ONE walk for a
 *  successful answer and a refusal's detail alike: a flat `out[key]` beside a
 *  dotted rewrite is two path grammars for one job, and the first nested id in
 *  an ANSWER would silently go unlifted. */
function requalify(
  value: unknown,
  paths: readonly string[],
  host: string,
): unknown {
  if (paths.length === 0 || value === null || typeof value !== "object") {
    return value;
  }
  let out = value as Record<string, unknown>;
  for (const path of paths) {
    const bare = atPath(out, path);
    if (typeof bare === "string") {
      out = withPath(out, path, fleetTerminalRef(host, bare));
    }
  }
  return out;
}

/** Step 3 over a REFUSAL — the same rewrite, plus the prose beside it.
 *
 *  A tool that stops partway has created something real and names it so the
 *  agent can act on it (`stopped-partway`'s `landed.id` — "lifecycle_kill ends
 *  it"). On this face that id is addressed as `<host>/<id>`, so leaving the
 *  bare one in the refusal hands the agent the one reference `lifecycle_kill`
 *  refuses — an orphan terminal nothing can name. The PROSE is rewritten
 *  beside the data because the sentence is what the model reads.
 *
 *  Only a {@link ToolFailure} is touched: it is the one failure whose shape the
 *  raiser declared, and rewriting fields of an arbitrary thrown value would be
 *  guessing. */
function requalifyRefusal(
  error: unknown,
  paths: readonly string[],
  host: string,
): unknown {
  if (!(error instanceof ToolFailure)) return error;
  const detail = requalify(error.detail, paths, host) as Record<
    string,
    unknown
  >;
  if (detail === error.detail) return error;
  const message = paths.reduce((text, path) => {
    const bare = atPath(error.detail, path);
    return typeof bare === "string"
      ? text.replaceAll(bare, fleetTerminalRef(host, bare))
      : text;
  }, error.message);
  return new ToolFailure(message, detail);
}

/** One per-host tool, over the fleet. */
function lifted(
  hosts: FleetHosts,
  watchList: FleetWatchList,
  tool: BespokeTool,
  lift: FleetLift,
): BespokeTool {
  return {
    ...tool,
    input: lift.input,
    description: `${tool.description ?? ""} ${FLEET_NOTE}`.trim(),
    handler: (args, _bundle, signal) =>
      Effect.flatMap(
        route(hosts, lift, args as Record<string, unknown>),
        (call) =>
          Effect.mapError(
            Effect.map(
              // The per-host handler is handed the ROOTED BUNDLE shape it reads
              // its client out of (`padiOf`): padi as the core, no siblings —
              // the same degenerate bundle `kolu mcp` dials, so the handler
              // cannot tell which face invoked it.
              tool.handler(call.bare, { core: call.padi }, signal),
              (answer) => {
                const lifted = requalify(answer, lift.answers, call.host);
                // AFTER the re-qualification, so the watch list holds the
                // reference the agent was given back — a bare id there would be
                // a watch on a terminal no other tool on this face can name.
                if (
                  lift.watches !== undefined &&
                  lifted !== null &&
                  typeof lifted === "object"
                ) {
                  const ref = atPath(
                    lifted as Record<string, unknown>,
                    lift.watches.answer,
                  );
                  if (typeof ref === "string") {
                    watchList.watch(
                      ref,
                      lift.watches.joined(args as Record<string, unknown>),
                    );
                  }
                }
                // The keys landed, so the conductor has now acted on whatever
                // that terminal was doing. The list is told at the FLEET
                // reference the call named; a terminal that is not watched is
                // the list's own business to ignore.
                if (lift.says !== undefined) {
                  const ref = atPath(
                    args as Record<string, unknown>,
                    lift.says,
                  );
                  if (typeof ref === "string") watchList.said(ref);
                }
                return lifted;
              },
            ),
            (error: unknown) =>
              requalifyRefusal(error, lift.refusals, call.host),
          ),
      ),
  };
}

/** The two fleet-ONLY tool names — the ones that are not a lift of anything the
 *  stdio face serves, because the watch list they move is the conductor's and
 *  exists nowhere else. Named beside the lift table so
 *  {@link KOLU_FLEET_TOOL_NAMES} can be read without building a face. */
const FLEET_ONLY_TOOLS = ["watch_terminal", "unwatch_terminal"] as const;

/** EVERY bespoke tool name the fleet face serves, as a static value.
 *
 *  `koluFleetTools` is a factory (it closes over one fleet's host port and
 *  watch list), so there is no built table to read at module scope — and a
 *  consumer that needs only the NAMES should not have to mint a face to learn
 *  them. kolu-server's conductor pins its teaching script against this list, so
 *  a tool the script names and this face does not serve fails a test instead of
 *  a live turn. Derived from the two sources the factory itself builds from, so
 *  it cannot drift from what is served. */
export const KOLU_FLEET_TOOL_NAMES: readonly string[] = [
  ...Object.keys(FLEET_LIFTS),
  ...FLEET_ONLY_TOOLS,
];

/** The fleet face's bespoke table. A FACTORY, not a const: every tool here is
 *  closed over the one fleet it serves — the host port, and the conductor's
 *  watch list — where the per-host table could be a module-level value because
 *  the adapter hands each call its client. Two faces in one process are two
 *  fleets, and a module-level watch list would let one conversation's watch
 *  decide another conversation's wakes. */
export function koluFleetTools(
  hosts: FleetHosts,
  watchList: FleetWatchList,
): Record<string, BespokeTool> {
  const table: Record<string, BespokeTool> = {};
  for (const [name, lift] of Object.entries(FLEET_LIFTS)) {
    const tool = KOLU_MCP_TOOLS[name];
    if (tool === undefined) {
      throw new Error(
        `kolu-mcp fleet: the lift table names ${name}, which KOLU_MCP_TOOLS does not serve — the fleet face LIFTS the kolu face's tools and cannot invent one.`,
      );
    }
    table[name] = lifted(hosts, watchList, tool, lift);
  }
  table.watch_terminal = watchTerminalTool(hosts, watchList);
  table.unwatch_terminal = unwatchTerminalTool(watchList);
  return table;
}
