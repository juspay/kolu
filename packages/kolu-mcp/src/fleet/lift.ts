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
 * The two WATCH tools are not in the table, because they are not mechanical:
 * one subscription spans every host and its cursor belongs to the fleet. They
 * are built here over `./watch.ts`, which owns that merge.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { PLACEMENT_REQUIRED } from "@kolu/padi-client/surface";
import { waitOutcomeJson } from "@kolu/surface/wait";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";
import { CreateArgsSchema } from "../create.ts";
import { ScreenImageArgsSchema } from "../screenImage.ts";
import { ScreenTextArgsSchema } from "../screenText.ts";
import { SendInputArgsSchema } from "../sendInput.ts";
import { KOLU_MCP_TOOLS } from "../tools.ts";
import {
  WaitAgentStateArgsSchema,
  WaitOutputSettledArgsSchema,
} from "../wait.ts";
import { WatchNextArgsSchema } from "../watchNext.ts";
import {
  type ParsedWatchOpen,
  resolveWatchOpenInput,
  type WatchOpenArgs,
  WatchOpenArgsSchema,
} from "../watchOpen.ts";
import { type FleetHosts, requireHost, requireTerminal } from "./hosts.ts";
import { fleetTerminalRef, splitFleetTerminalRef } from "./ref.ts";
import { FleetHostKeySchema, FleetTerminalRefSchema } from "./refSchema.ts";
import {
  type FleetWatchGap,
  type FleetWatchMet,
  type FleetWatchRegistry,
  fleetWatchNext,
  fleetWatchOpen,
} from "./watch.ts";

/** What every lifted description gains. ONE sentence, appended rather than
 *  woven in: the per-host blurbs are written and pinned where they are, and a
 *  fleet-shaped rewrite of each would be the same fork one level down, in
 *  prose. */
const FLEET_NOTE =
  "On this face a terminal is addressed as <host>/<id> — the host key from the `hosts` resource, a slash, and the terminal id.";

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
   *  terminal reference"), leaving an orphan nothing can address. */
  readonly refusals: readonly string[];
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
    refusals: ["landed.id"],
  },
  lifecycle_sendInput: {
    input: Schema.Struct({
      ...SendInputArgsSchema.fields,
      id: FleetTerminalRefSchema,
    }),
    from: { ref: "id" },
    refs: [],
    answers: [],
    refusals: [],
  },
  screen_text: {
    input: Schema.Struct({
      ...ScreenTextArgsSchema.fields,
      id: FleetTerminalRefSchema,
    }),
    from: { ref: "id" },
    refs: [],
    answers: [],
    refusals: [],
  },
  screen_image: {
    input: Schema.Struct({
      ...ScreenImageArgsSchema.fields,
      id: FleetTerminalRefSchema,
    }),
    from: { ref: "id" },
    refs: [],
    answers: [],
    refusals: [],
  },
  wait_outputSettled: {
    input: Schema.Struct({
      ...WaitOutputSettledArgsSchema.fields,
      id: FleetTerminalRefSchema,
    }),
    from: { ref: "id" },
    refs: [],
    answers: ["id"],
    refusals: [],
  },
  wait_agentState: {
    input: Schema.Struct({
      ...WaitAgentStateArgsSchema.fields,
      id: FleetTerminalRefSchema,
    }),
    from: { ref: "id" },
    refs: [],
    answers: ["id"],
    refusals: [],
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

/** Step 3 — put the host back on every id a SUCCESSFUL answer carries. */
function requalify(
  answer: unknown,
  keys: readonly string[],
  host: string,
): unknown {
  if (keys.length === 0 || answer === null || typeof answer !== "object") {
    return answer;
  }
  let out = answer as Record<string, unknown>;
  for (const key of keys) {
    const value = out[key];
    if (typeof value === "string") {
      out = { ...out, [key]: fleetTerminalRef(host, value as TerminalId) };
    }
  }
  return out;
}

/** Step 3's other half — the ids a REFUSAL carries.
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
  if (paths.length === 0 || !(error instanceof ToolFailure)) return error;
  let detail: Record<string, unknown> = error.detail;
  let message = error.message;
  for (const path of paths) {
    const value = atPath(detail, path);
    if (typeof value !== "string") continue;
    const ref = fleetTerminalRef(host, value);
    detail = withPath(detail, path, ref);
    message = message.replaceAll(value, ref);
  }
  return detail === error.detail ? error : new ToolFailure(message, detail);
}

/** One per-host tool, over the fleet. */
function lifted(
  hosts: FleetHosts,
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
              (answer) => requalify(answer, lift.answers, call.host),
            ),
            (error: unknown) =>
              requalifyRefusal(error, lift.refusals, call.host),
          ),
      ),
  };
}

/** Group fleet references by the host that owns them. */
function byHost(
  refs: readonly string[] | undefined,
): Effect.Effect<Map<string, TerminalId[]> | undefined, ToolFailure> {
  if (refs === undefined) return Effect.succeed(undefined);
  const grouped = new Map<string, TerminalId[]>();
  for (const ref of refs) {
    const split = splitFleetTerminalRef(ref);
    if (split === null) {
      return Effect.fail(
        new ToolFailure(
          `${JSON.stringify(ref)} is not a fleet terminal reference (<host>/<id>).`,
          { kind: "not-a-fleet-ref", ref },
        ),
      );
    }
    grouped.set(split.host, [...(grouped.get(split.host) ?? []), split.id]);
  }
  // An explicit EMPTY list stays an empty GROUPING rather than collapsing to
  // "no ids given": `ids: []` is a scope refusal the per-host resolver has its
  // own words for, and turning it into "watch the whole fleet" would answer a
  // caller's mistake with the widest possible subscription.
  return Effect.succeed(grouped);
}

/** `watch_open`, over the fleet.
 *
 *  `ignoreSelf` is deliberately ABSENT. Per host it means "mute the terminal
 *  this MCP server runs inside", which is true and useful for an agent working
 *  in a terminal. The fleet face runs inside kolu-server and its caller is the
 *  orchestrator — a child of kolu-server, in no terminal at all — so there is
 *  no self to mute, and resolving `KAVAL_TERMINAL_ID` here would mute whichever
 *  terminal kolu-server happened to be launched from: a lane nobody asked to go
 *  blind to. `ignoreIds` says it precisely. */
function fleetWatchOpenTool(
  hosts: FleetHosts,
  registry: FleetWatchRegistry,
): BespokeTool {
  const { ignoreSelf: _noSelf, ...open } = WatchOpenArgsSchema.fields;
  return {
    input: Schema.Struct({
      ...open,
      ids: Schema.optionalKey(
        Schema.Array(FleetTerminalRefSchema).annotate({
          description:
            "Watch only these terminals, as <host>/<id>. Omit to watch the WHOLE FLEET — every terminal on every host, including hosts that connect later. A list you forget to update goes blind to a machine nobody added.",
        }),
      ),
      ignoreIds: Schema.optionalKey(
        Schema.Array(FleetTerminalRefSchema).annotate({
          description:
            "Mute these terminals, as <host>/<id>. Fail-open: a stale reference costs nothing.",
        }),
      ),
    }),
    mutates: true,
    title: "Open a fleet watch",
    description:
      `${KOLU_MCP_TOOLS.watch_open?.description ?? ""} ${FLEET_NOTE} One name covers every host: a host that connects later joins this subscription on its own, and a host that LEAVES the fleet reports each terminal it was carrying as "gone" before it goes. A host that is merely down or refusing is neither legged nor mourned — it is listed in \`gaps\`, retried on every watch_next, and drains what it missed when it answers.`.trim(),
    handler: (args, _bundle, _signal) =>
      Effect.suspend(() => {
        const { ids, ignoreIds, ...base } = args as Omit<
          WatchOpenArgs,
          "ids" | "ignoreIds" | "ignoreSelf"
        > & {
          readonly ids?: readonly string[];
          readonly ignoreIds?: readonly string[];
        };
        return Effect.flatMap(byHost(ids), (watched) =>
          Effect.flatMap(byHost(ignoreIds), (muted) => {
            // Each leg is resolved by the per-host face's OWN pure half, so the
            // nag grammar, the scope refusals and the input assembly are the
            // ones `kolu mcp` applies — the fleet decides only which hosts get
            // a leg. `live` is empty and the env is not read: `ignoreSelf` is
            // not a field here, so no roster is needed.
            const resolved = (host: string): ParsedWatchOpen =>
              resolveWatchOpenInput(
                {
                  ...base,
                  ...(watched === undefined
                    ? {}
                    : { ids: watched.get(host) ?? [] }),
                  ...(muted === undefined
                    ? {}
                    : { ignoreIds: muted.get(host) ?? [] }),
                } as WatchOpenArgs,
                [],
                {},
              );
            // An `ids: []` names no terminal on any host, so no leg would be
            // opened at all and the subscription would report success while
            // watching nothing. The per-host resolver owns that refusal's
            // words; ask it rather than writing a second pair.
            if (watched !== undefined && watched.size === 0) {
              const refusal = resolved("");
              if (refusal.kind === "error") {
                return Effect.fail(
                  new ToolFailure(refusal.message, refusal.detail),
                );
              }
            }
            return Effect.map(
              fleetWatchOpen(hosts, registry, {
                name: base.name,
                scope:
                  watched === undefined
                    ? { kind: "all" }
                    : { kind: "ids", byHost: watched },
                opened: (host) => {
                  const parsed = resolved(host);
                  if (parsed.kind === "error") {
                    throw new ToolFailure(parsed.message, parsed.detail);
                  }
                  return parsed.value;
                },
              }),
              withGaps,
            );
          }),
        );
      }),
  };
}

/** A watch answer's blind spots, on the wire — present only when there ARE
 *  any. An empty `gaps: []` on every frame is a field a reader learns to skip,
 *  which is exactly the wrong habit for the one field that says "this batch is
 *  missing a machine". */
function withGaps<T extends { readonly gaps: readonly FleetWatchGap[] }>(
  answer: T,
): Record<string, unknown> {
  const { gaps, ...rest } = answer;
  return gaps.length === 0 ? { ...rest } : { ...rest, gaps };
}

/** `watch_next`, over the fleet — the merged drain. The cursor an agent echoes
 *  back is the FLEET's `ackAfter`, never a host's own seq. */
function fleetWatchNextTool(
  hosts: FleetHosts,
  registry: FleetWatchRegistry,
): BespokeTool {
  return {
    input: WatchNextArgsSchema,
    mutates: false,
    title: "Wait for the next terminal event",
    description:
      `${KOLU_MCP_TOOLS.watch_next?.description ?? ""} ${FLEET_NOTE} Events from every host arrive in ONE ordered batch under a fleet-wide seq, and a host that leaves the fleet reports each terminal it was carrying as "gone". A host that merely stopped answering is NOT gone: it is listed in \`gaps\`, and its events arrive when it reconnects.`.trim(),
    handler: (args, _bundle, signal) => {
      const { name, after, timeoutMs } = args as {
        readonly name: string;
        readonly after?: number;
        readonly timeoutMs?: number;
      };
      return Effect.map(
        fleetWatchNext(hosts, registry, { name, after, timeoutMs, signal }),
        // The subscription NAME rides the envelope's id slot, exactly as the
        // per-host drain does — for a standing subscription that IS "what was
        // this wait about".
        ({ outcome, gaps }) =>
          withGaps({
            ...waitOutcomeJson<FleetWatchMet>(name, outcome, (met) => ({
              met,
            })),
            gaps,
          }),
      );
    },
  };
}

/** The fleet face's bespoke table. A FACTORY, not a const: every tool here is
 *  closed over the one fleet it serves (the host port and that face's watch
 *  registry), where the per-host table could be a module-level value because
 *  the adapter hands each call its client. Two faces in one process are two
 *  fleets, and a module-level registry would let one close the other's watch. */
export function koluFleetTools(
  hosts: FleetHosts,
  registry: FleetWatchRegistry,
): Record<string, BespokeTool> {
  const table: Record<string, BespokeTool> = {};
  for (const [name, lift] of Object.entries(FLEET_LIFTS)) {
    const tool = KOLU_MCP_TOOLS[name];
    if (tool === undefined) {
      throw new Error(
        `kolu-mcp fleet: the lift table names ${name}, which KOLU_MCP_TOOLS does not serve — the fleet face LIFTS the kolu face's tools and cannot invent one.`,
      );
    }
    table[name] = lifted(hosts, tool, lift);
  }
  table.watch_open = fleetWatchOpenTool(hosts, registry);
  table.watch_next = fleetWatchNextTool(hosts, registry);
  return table;
}
