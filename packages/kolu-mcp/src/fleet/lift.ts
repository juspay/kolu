import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { PLACEMENT_REQUIRED } from "@kolu/padi-client/surface";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect, Option, Schema } from "effect";
import {
  isWaterfallRole,
  WORK_ROLES,
  type WorkRole,
  WorkRoleSchema,
} from "kolu-work";
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
import { waterfallRun } from "./start.ts";
import {
  type FleetWorks,
  workAdoptTool,
  workAskTool,
  workCheckFailure,
  workLeaveTool,
  workNoteTool,
  workStopTool,
  workOpenTool,
} from "./works.ts";

const FLEET_NOTE =
  "On this face a terminal is addressed as <host>/<id> — the host key from the `hosts` resource, a slash, and the terminal id.";

export const FLEET_SETTLE_CAP_MS = 3_000;

const cappedMs = (description: string): Schema.Number =>
  MillisecondsSchema(description).check(
    Schema.isLessThanOrEqualTo(FLEET_SETTLE_CAP_MS),
  );

const FleetPlacementSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("toplevel") }),
  Schema.Struct({
    kind: Schema.Literal("child-of"),
    parentId: FleetTerminalRefSchema,
  }),
]).annotate({ message: PLACEMENT_REQUIRED, description: PLACEMENT_REQUIRED });

interface FleetLift {
  readonly input: BespokeTool["input"];
  readonly from: { readonly ref: string } | { readonly host: true };
  readonly refs: readonly string[];
  readonly answers: readonly string[];
  readonly strip?: readonly string[];
  readonly refusals: readonly string[];
  readonly tells?: (
    works: FleetWorks,
    args: Record<string, unknown>,
    answer: unknown,
  ) => void;
  readonly prepare?: (
    works: FleetWorks,
    args: Record<string, unknown>,
  ) => Effect.Effect<Record<string, unknown>, ToolFailure>;
}

const FLEET_LIFTS: Readonly<Record<string, FleetLift>> = {
  lifecycle_create: {
    input: Schema.Struct({
      ...CreateArgsSchema.fields,
      host: FleetHostKeySchema.annotate({
        description:
          "Which host to create the terminal ON — create it where the repository lives. The `hosts` resource is the roster.",
      }),
      placement: FleetPlacementSchema,
      work: Schema.String.annotate({
        description:
          "The piece of work this terminal is for, by the id `work_open` answered with. Required: open the work FIRST (`work_open`), then create its terminals. Read the `works` resource for the ones in progress.",
      }),
      role: WorkRoleSchema.annotate({
        description:
          "What this terminal is there to do: `planner`, `implementor`, or `other` for one the human simply asked you to keep an eye on. Required — a terminal with no part in the work is one nobody can read a card about. A `planner` or `implementor` is started by KOLU from the work's setup — the harness and model the human chose — so give it no `run`: kolu types the command and answers with it as `ran`.",
      }),
    }),
    from: { host: true },
    refs: ["placement.parentId"],
    strip: ["work", "role"],
    answers: ["id"],
    refusals: ["landed.id", "id"],
    prepare: (works, args) => {
      const work = typeof args.work === "string" ? args.work : "";
      const refused = works.check(work);
      if (Option.isSome(refused))
        return Effect.fail(workCheckFailure(work, refused.value));
      const role = args.role;
      if (!isWaterfallRole(role)) return Effect.succeed(args);
      if ("run" in args)
        return Effect.fail(
          new ToolFailure(
            `kolu starts the ${role} itself, from this work's setup — the harness and model the human chose. Leave \`run\` out; the answer says what kolu ran (\`ran\`). Nothing was created.`,
            { kind: "run-is-kolus", work, role },
          ),
        );
      return Effect.map(
        waterfallRun(works, { work, role, host: String(args.host ?? "") }),
        (run) => ({ ...args, run }),
      );
    },
    tells: (works, args, answer) => {
      const ref = refAt(answer, "id");
      const work = typeof args.work === "string" ? args.work : "";
      const role = args.role;
      if (ref === undefined || !isWorkRole(role)) return;
      works.join(
        ref,
        work,
        role,
        typeof args.run === "string" ? "created-run" : "created",
      );
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
    tells: (works, args) => {
      const ref = refAt(args, "id");
      if (ref !== undefined) works.said(ref);
    },
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

function atPath(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((at, key) => {
    if (at === null || typeof at !== "object") return undefined;
    return (at as Record<string, unknown>)[key];
  }, value);
}

function refAt(value: unknown, path: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const at = atPath(value as Record<string, unknown>, path);
  return typeof at === "string" ? at : undefined;
}

const isWorkRole = (value: unknown): value is WorkRole =>
  typeof value === "string" &&
  (WORK_ROLES as ReadonlyArray<string>).includes(value);

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

interface Routed {
  readonly host: string;
  readonly padi: PadiSurfaceClient;
  readonly bare: Record<string, unknown>;
}

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
    for (const key of lift.strip ?? []) {
      const { [key]: _mine, ...rest } = bare;
      bare = rest;
    }
    for (const path of lift.refs) {
      const value = atPath(bare, path);
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

function lifted(
  hosts: FleetHosts,
  works: FleetWorks,
  tool: BespokeTool,
  lift: FleetLift,
): BespokeTool {
  return {
    ...tool,
    input: lift.input,
    description: `${tool.description ?? ""} ${FLEET_NOTE}`.trim(),
    handler: (args, _bundle, signal) => {
      const prepared =
        lift.prepare?.(works, args as Record<string, unknown>) ??
        Effect.succeed(args as Record<string, unknown>);
      return Effect.flatMap(prepared, (given) =>
        Effect.flatMap(route(hosts, lift, given), (call) =>
          Effect.mapError(
            Effect.map(
              tool.handler(call.bare, { core: call.padi }, signal),
              (answer) => {
                const lifted = requalify(answer, lift.answers, call.host);
                lift.tells?.(works, given, lifted);
                return lifted;
              },
            ),
            (error: unknown) =>
              requalifyRefusal(error, lift.refusals, call.host),
          ),
        ),
      );
    },
  };
}

const FLEET_ONLY_TOOLS = [
  "work_open",
  "work_ask",
  "work_adopt",
  "work_leave",
  "work_note",
  "work_stop",
] as const;

/** EVERY bespoke tool name the fleet face serves, as a static value.
 *
 *  kolu-server's conductor pins its teaching script against this list, so a
 *  tool the script names and this face does not serve fails a test instead of
 *  a live turn. Derived from the two sources the factory itself builds from,
 *  so it cannot drift from what is served. */
export const KOLU_FLEET_TOOL_NAMES: readonly string[] = [
  ...Object.keys(FLEET_LIFTS),
  ...FLEET_ONLY_TOOLS,
];

export function koluFleetTools(
  hosts: FleetHosts,
  works: FleetWorks,
): Record<string, BespokeTool> {
  const table: Record<string, BespokeTool> = {};
  for (const [name, lift] of Object.entries(FLEET_LIFTS)) {
    const tool = KOLU_MCP_TOOLS[name];
    if (tool === undefined) {
      throw new Error(
        `kolu-mcp fleet: the lift table names ${name}, which KOLU_MCP_TOOLS does not serve — the fleet face LIFTS the kolu face's tools and cannot invent one.`,
      );
    }
    table[name] = lifted(hosts, works, tool, lift);
  }
  table.work_open = workOpenTool(works);
  table.work_ask = workAskTool(works);
  table.work_adopt = workAdoptTool(hosts, works);
  table.work_leave = workLeaveTool(works);
  table.work_note = workNoteTool(works);
  table.work_stop = workStopTool(works);
  return table;
}
