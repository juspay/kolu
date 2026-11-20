import {
  FsGitReadErrorSchema,
  GitBaseReadErrorSchema,
  PadiActiveTerminalSchema,
  PadiParkedTerminalSchema,
  PadiScreenHistoryInputSchema,
  PadiScreenHistoryOutputSchema,
  PadiSleepingTerminalSchema,
  type PadiUrgencySchema,
  PtyHostIdentitySchema,
  TerminalGateErrorSchema,
  TerminalInfoSchema,
  TerminalNotFound,
} from "@kolu/padi-client/surface";
import { defineSurface } from "@kolu/surface/define";
import {
  FsFileInputSchema,
  FsReadFileTextOutputSchema,
} from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";
import {
  FsListAllInputSchema,
  FsListAllOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
} from "kolu-git/schemas";
import {
  OnGreenSchema,
  WorkKeySchema,
  WorkModeSchema,
  OutcomeSchema,
  WorkRoleSchema,
} from "kolu-work";
import { FleetHostKeySchema, FleetTerminalRefSchema } from "./refSchema.ts";
import { FLEET_WATCH_JOINS } from "./watchJoin.ts";

const FleetRefs = Schema.Array(FleetTerminalRefSchema);

export const FleetUrgencySchema = Schema.Struct({
  awaitingIds: FleetRefs,
  finishedIds: FleetRefs,
  workingIds: FleetRefs,
  lingerIds: FleetRefs,
} satisfies Record<
  Exclude<keyof typeof PadiUrgencySchema.fields, "settled">,
  typeof FleetRefs
>);
export type FleetUrgency = typeof FleetUrgencySchema.Type;

export const EMPTY_FLEET_URGENCY: FleetUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
};

export const FleetHostStateSchema = Schema.Literals([
  "warming",
  "connected",
  "failed",
]);
export type FleetHostState = typeof FleetHostStateSchema.Type;

export const FleetHostSchema = Schema.Struct({
  host: FleetHostKeySchema,
  display: Schema.String,
  state: FleetHostStateSchema,
  commit: Schema.NullOr(Schema.String),
  surfaceVersion: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.Number),
  expectedKaval: Schema.optionalKey(PtyHostIdentitySchema),
});
export type FleetHost = typeof FleetHostSchema.Type;

const FLEET_IDENTITY_FIELDS = {
  id: FleetTerminalRefSchema,
  parentId: Schema.optionalKey(FleetTerminalRefSchema),
  host: FleetHostKeySchema,
};

export const FleetTerminalSchema = Schema.Union([
  Schema.Struct({
    ...PadiActiveTerminalSchema.fields,
    ...FLEET_IDENTITY_FIELDS,
  }),
  Schema.Struct({
    ...PadiSleepingTerminalSchema.fields,
    ...FLEET_IDENTITY_FIELDS,
  }),
  Schema.Struct({
    ...PadiParkedTerminalSchema.fields,
    ...FLEET_IDENTITY_FIELDS,
  }),
]);
export type FleetTerminal = typeof FleetTerminalSchema.Type;

export const FleetWatchJoinSchema = Schema.Literals([...FLEET_WATCH_JOINS]);

export const FleetWorkMemberSchema = Schema.Struct({
  ref: Schema.String.annotate({
    description:
      "The terminal, as <host>/<id> — the reference every tool on this face takes.",
  }),
  role: WorkRoleSchema,
  name: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.String),
  joined: FleetWatchJoinSchema,
  hostName: Schema.NullOr(Schema.String),
  hostState: Schema.NullOr(FleetHostStateSchema),
  driver: Schema.Literals(["conductor", "you", "nobody"]).annotate({
    description:
      "Who is typing into it: `conductor` (yours to drive), `you` (the person took it over — do not send it input until it is handed back), or `nobody` (a watch is the person's own terminal, and a work with no mode decided runs nothing).",
  }),
});
export type FleetWorkMember = typeof FleetWorkMemberSchema.Type;

export const FleetWorkStandingSchema = Schema.Struct({
  who: Schema.Literals(["agent", "you", "ci", "done"]),
  what: Schema.String,
  since: Schema.String,
});

const FleetSetupAnswerSchema = <S extends Schema.Top>(value: S) =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("unanswered") }),
    Schema.Struct({ kind: Schema.Literal("answered"), value }),
  ]);

export const FleetWorkSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  key: WorkKeySchema,
  host: Schema.String,
  mode: FleetSetupAnswerSchema(WorkModeSchema),
  onGreen: FleetSetupAnswerSchema(OnGreenSchema),
  standing: FleetWorkStandingSchema,
  members: Schema.Array(FleetWorkMemberSchema),
  openQuestions: Schema.Array(Schema.String),
});
export type FleetWork = typeof FleetWorkSchema.Type;

export const FleetFinishedWorkSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  outcome: OutcomeSchema,
  endedAt: Schema.String,
});

export const FleetWorksSchema = Schema.Struct({
  works: Schema.Array(FleetWorkSchema),
  finished: Schema.Array(FleetFinishedWorkSchema),
});
export type FleetWorksView = typeof FleetWorksSchema.Type;

export const EMPTY_FLEET_WORKS: FleetWorksView = { works: [], finished: [] };

export const FleetScreenHistoryInputSchema = Schema.Struct({
  ...PadiScreenHistoryInputSchema.fields,
  id: FleetTerminalRefSchema,
});

export const FleetTerminalIdInputSchema = Schema.Struct({
  id: FleetTerminalRefSchema,
});
export const FleetTerminalInfoSchema = Schema.Struct({
  ...TerminalInfoSchema.fields,
  id: FleetTerminalRefSchema,
});

const onHost = <F extends Schema.Struct.Fields>(
  fields: F,
): Schema.Struct<F & { host: typeof FleetHostKeySchema }> =>
  Schema.Struct({ ...fields, host: FleetHostKeySchema });

export const fleetSurface = defineSurface({
  cells: {
    urgency: {
      schema: FleetUrgencySchema,
      default: EMPTY_FLEET_URGENCY,
      verbs: ["get"],
    },
    hosts: {
      schema: Schema.Array(FleetHostSchema),
      default: [],
      verbs: ["get"],
    },
    works: {
      schema: FleetWorksSchema,
      default: EMPTY_FLEET_WORKS,
      verbs: ["get"],
    },
  },
  collections: {
    terminals: {
      keySchema: FleetTerminalRefSchema,
      schema: FleetTerminalSchema,
      verbs: ["keys", "get"],
    },
  },
  procedures: {
    screen: {
      history: {
        input: FleetScreenHistoryInputSchema,
        output: PadiScreenHistoryOutputSchema,
        error: TerminalGateErrorSchema,
      },
    },
    lifecycle: {
      kill: {
        input: FleetTerminalIdInputSchema,
        output: FleetTerminalInfoSchema,
        error: TerminalNotFound,
      },
    },
    git: {
      getStatus: {
        input: onHost(GitStatusInputSchema.fields),
        output: GitStatusOutputSchema,
        error: GitBaseReadErrorSchema,
      },
      getDiff: {
        input: onHost(GitDiffInputSchema.fields),
        output: GitDiffOutputSchema,
        error: GitBaseReadErrorSchema,
      },
    },
    fs: {
      listAll: {
        input: onHost(FsListAllInputSchema.fields),
        output: FsListAllOutputSchema,
        error: FsGitReadErrorSchema,
      },
      readFile: {
        input: onHost(FsFileInputSchema.fields),
        output: FsReadFileTextOutputSchema,
        error: FsGitReadErrorSchema,
      },
    },
  },
});

export type FleetSurfaceSpec = (typeof fleetSurface)["spec"];
