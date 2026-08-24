/**
 * `surfaceCommands` — the surface projected as argv.
 *
 * The MCP adapter projects a surface as tools and resources; this projects the
 * same surface as commands. Both read ONE `expose` map by one grammar
 * (`classifyExpose`), take ONE verb table (`SurfaceVerb`), and compute ONE name
 * per procedure (`toolName`) — so `git_commit` the MCP tool and `git_commit` the
 * CLI verb are one name for one function, and the two faces cannot drift.
 *
 * ## It returns a VALUE, and does not run a program
 *
 * `surfaceCommands(opts)` is a pure function to an array of `Command`s. The host
 * binary mounts them beside its own (`Command.withSubcommands`) and owns the run
 * edge — `Command.run`, the exit-code teardown, the process. Which faces a
 * binary mounts is the binary's volatility, not this adapter's, and a
 * `runSurfaceCli` would take that decision away while adding nothing: the host
 * already has `Command.run`.
 *
 * For the same reason the CLI LIBRARY is assumed rather than abstracted.
 * `effect/unstable/cli` ships inside the `effect` the workspace already pins, so
 * the parser costs no new dependency; its flags are `Flag`s, its usage errors
 * are its own, and its handlers are Effects — which is what makes a Ctrl-C reach
 * an in-flight call for free, rather than through a signal handler this package
 * would otherwise have to install.
 *
 * ## WHERE the endpoint flags live is the HOST's decision
 *
 * Declare them in `endpoint.flags` and they are merged into every generated
 * command's own config, so `surface capture "…" --socket /run/x.sock` parses.
 * Declare them on your own parent instead (`Command.withSharedFlags`, which is
 * what `kolu-cli` does so `kolu --host pu1 create` and `kolu create --host pu1`
 * both parse), OMIT `flags` here, and read them back in `resolve` — this face
 * then adds none and nothing collides. Both are the host's own argv grammar,
 * which is why this seam expresses both rather than picking one: a projection
 * that hard-coded where the flags sit would make one binary's verbs answer to a
 * different grammar than its native ones.
 *
 * ## What is projected
 *
 * | spec member | argv |
 * | --- | --- |
 * | procedure `ns.verb` exposed `"tool"` | `<toolName(ns,verb)> [--field …] [--input '{…}' \| -] [--json]` |
 * | a bespoke `SurfaceVerb` | `<name> …`, by the same rule over its `input` |
 * | cell exposed `"resource"` | `get <member> [--follow]` |
 * | stream / event exposed `"resource"` | `get <member> [input] [--follow]` |
 * | collection exposed `"resource"` | `get <member> <key> [--follow]` · `keys <member> [--follow]` · `watch <member>` |
 * | always | `list` — this face's `tools/list`, answered from the projection rather than from a server |
 *
 * `--follow` turns a one-shot read into the subscription itself, one ndjson line
 * per frame, until the stream ends or the fiber is interrupted. Without it a
 * read takes the opening SNAPSHOT frame and stops — which is what every
 * snapshot-then-deltas member opens with, and `Stream.runHead`'s interruption IS
 * the unsubscribe. `watch` has no one-shot reading, so it takes no `--follow`.
 * A host whose transport cannot push declares `endpoint.streaming: false`, and
 * then neither exists at all — see {@link EndpointSeam.streaming}.
 *
 * ## Two flags, two directions, one name each
 *
 * `--input` carries the whole INPUT as JSON where the field flags would
 * (`./flags.ts`); `--json` asks for the whole ANSWER as JSON where a renderer
 * would have summarised it ({@link JSON_FLAG}). The flag is the only thing that
 * decides the answer's shape — what stdout is attached to decides nothing.
 *
 * ## Two gates, as with MCP
 *
 * The SERVING face's `FaceExposure` decides what the server answers; this
 * `ExposeMap` decides what the CLI offers. Same arrangement `serveSurfaceAsMcp`
 * has with `restrictHandlers`, and the same reason: a client's table is
 * ergonomics, never security.
 */

import type {
  OwnedSurfaceConnection,
  SurfaceClientCallable,
} from "@kolu/surface/client";
import type {
  CollectionSpec,
  Surface,
  SurfaceSpec,
  WireSchemaAny,
} from "@kolu/surface/define";
import {
  collectionHasDeltas,
  resolveCollectionVerbs,
} from "@kolu/surface/define";
import { messageOf } from "@kolu/surface/errors";
import {
  classifyExpose,
  type ExposeEntry,
  type ExposeMap,
  exposureMutates,
} from "@kolu/surface/expose";
import {
  firstFrameOfCollectionItem,
  firstFrameOrThrow,
  ITEM_READ_DEADLINE_MS,
} from "@kolu/surface/first-frame";
import {
  admitsNoArgument,
  decodeTextValue,
  type SurfaceVerb,
  toolName,
} from "@kolu/surface/verbs";
import type { Stdio } from "effect";
import { Cause, Effect, Option, Result, Schema, Stream } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { match, P } from "ts-pattern";
import {
  classify,
  type SurfaceCliFailure,
  unreachable,
  unresolvable,
  usage,
} from "./exit";
import {
  flagsOf,
  INPUT_FLAG,
  type InputProjection,
  SurfaceCliBuildError,
} from "./flags";
import {
  type HelpFlag,
  type HelpRow,
  helpText,
  type SurfaceCliHelp,
} from "./help";
import { data, frames, present, readStdin } from "./io";

/** A live connection this face owns for the length of ONE command.
 *
 *  The framework's {@link OwnedSurfaceConnection} under this face's name, not a
 *  third spelling of it: "a client plus the release the face is responsible for"
 *  is one shape, and the MCP face's `PusherConnection` is the same one at a
 *  different span. One shape is what lets a host write ONE factory that feeds
 *  both faces — which is exactly what the shared verb table and the shared
 *  expose map exist to make possible.
 *
 *  `dispose` is REQUIRED, not optional: a CLI dials, does one thing and exits,
 *  and the one failure that costs a user something is a socket left open under a
 *  shell loop. An in-process host with nothing to release passes `() => {}` —
 *  which is a decision it makes out loud rather than an absence this face has to
 *  guess the meaning of. `onClose` is on the base and unused here: a CLI never
 *  redials, so it has nothing to do with a transport announcing its close. */
export type SurfaceCliConnection = OwnedSurfaceConnection;

/** CLI-only ergonomics for one verb, keyed by the verb's name.
 *
 *  Deliberately an open map BESIDE the verb table rather than fields on
 *  `SurfaceVerb`: the verb record is a value both faces take verbatim, and a
 *  `positional` on it would be a CLI concern the MCP face has to ignore. Two
 *  concerns, two values, one join — by name. */
export interface VerbAnnotation {
  /** Input FIELDS to bind to argv positions, in order — `capture "a thought"`
   *  rather than `capture --title "a thought"`. Refused at build if it names a
   *  field the input does not declare, or one that cannot be a position. */
  readonly positional?: readonly string[];
  /** Render the verb's output as text FOR A HUMAN — one line a person can act
   *  on, in place of the answer's JSON.
   *
   *  Applied unless the caller passed `--json`, and that is the WHOLE rule: it
   *  used to depend on whether stdout was a terminal, so the same command
   *  answered differently under `| tee` than in front of a person, and neither
   *  shape could be asked for. See {@link JSON_FLAG}. */
  readonly render?: (output: unknown) => string;
}

export interface SurfaceCliOptions<
  S extends SurfaceSpec,
  F extends FlagRecord = FlagRecord,
  R = never,
> {
  readonly surface: Surface<S>;
  /** Default-deny allowlist — the SAME map shape `serveSurfaceAsMcp` and the
   *  wire faces take (`@kolu/surface/expose`). */
  readonly expose: ExposeMap<S>;
  /** Hand-authored verbs — the SAME record handed to `serveSurfaceAsMcp` as
   *  `tools`, so the two faces offer one table under one set of names. */
  readonly verbs?: Record<string, SurfaceVerb>;
  /** The transport seam: app-owned, framework-blind. */
  readonly endpoint: EndpointSeam<F, R>;
  /** CLI-only ergonomics, by verb name. */
  readonly annotate?: Record<string, VerbAnnotation>;
  /** The WORDING of the help page — a purpose line, the verbs grouped by what
   *  they do, an example each. Passing it does two things: {@link surfaceHelp}
   *  can build the page, and the projected commands stop appearing in the
   *  parent's own alphabetical SUBCOMMANDS block, because the page has already
   *  listed them (see `surfaceCommands`). Omit it and nothing changes — the
   *  renderer's flat listing is what a host gets today. */
  readonly help?: SurfaceCliHelp;
  /** The BINARY's identity — its `name`, which fronts every diagnostic this
   *  face writes, because a user reads `olai: no surface at …` and never the
   *  package's name. Required, not defaulted to something that would be wrong.
   *
   *  A `version` sat here too and nothing ever read it: the run edge takes the
   *  version (`Command.run(root, { version })`) and this face has no line to put
   *  one in. A public option nothing reads is a promise to a consumer that the
   *  code never keeps, so it is gone rather than documented. */
  readonly info: { readonly name: string };
}

/** A host's flag table, and the values a parse of it produces — the LIBRARY's
 *  own pair, under local names because this file spells them on nearly every
 *  signature.
 *
 *  `Command.make` derives a handler's parameter from its config with exactly
 *  `Config.Infer`, and `Command.withSharedFlags` derives the shared half the
 *  same way. The hand-rolled pair here — `Record<string, Flag.Flag<any>>` and a
 *  mapped type over `Flag<infer A>` — rejected NESTED flag configs
 *  (`{ endpoint: { socket, url } }`), which is an ordinary `Command.make`
 *  idiom: a host whose endpoint flags are grouped could not use
 *  {@link EndpointSeam} at all, and `resolve`'s parameter silently diverged
 *  from what the parser hands a handler. Since `resolve`'s whole safety story is
 *  "renaming a flag is a compile error here", it is derived from the type the
 *  parser derives from. */
type FlagRecord = Command.Command.FlagConfig;
type FlagValues<F extends FlagRecord> = Command.Command.Config.Infer<F>;

/** Where to dial, and how — the one seam this adapter is blind behind.
 *
 *  ONE step, not two, and the shape is the point: `resolve` reads the flags once
 *  and answers with the endpoint's NAME beside the thunk that opens it. The name
 *  is needed exactly when the dial FAILS — when there is no connection left to
 *  ask — and a separate `describe(values)` beside a `connect(values)` is two
 *  readings of one decision that nothing holds together: an app whose resolution
 *  order is `--socket` → `$APP_SOCKET` → a dev file → the runtime socket would
 *  have to walk it twice and could name one endpoint while dialling another.
 *
 *  The app owns the resolution, because that order is its policy and nothing
 *  here could guess it. Generic over its OWN flag record so the two halves are
 *  one type: `resolve`'s parameter is DERIVED from `flags`, so renaming a flag
 *  is a compile error here rather than an `undefined` the app dials as the
 *  string `"undefined"`. Inference from the `endpoint: { flags, resolve }`
 *  literal supplies `F` at every call site — no host writes it, and `R` — what
 *  `resolve` needs to run — is inferred the same way and travels out on the
 *  commands, so a host that reads its own parent context is asked for it at ITS
 *  run edge rather than here. */
export interface EndpointSeam<F extends FlagRecord = FlagRecord, R = never> {
  /** Flags every generated command carries — `--socket`, `--url`, `--host`.
   *
   *  OMIT it (or pass `{}`) when the host declares them on its OWN parent with
   *  `Command.withSharedFlags` and reads them back in `resolve`: this face then
   *  adds none, and nothing collides. Where the flags live is the host's
   *  decision about its own argv grammar, not this projection's. */
  readonly flags?: F;
  /** Read the flags, decide WHERE, and hand back both halves of the answer.
   *
   *  An EFFECT, for two reasons that are the same reason: a host whose flags sit
   *  on the PARENT reads them out of the parent's context (`kolu-cli`'s
   *  `Effect.flatMap(koluRoot, endpointOf)`), and a host whose resolution order
   *  can come up empty ("no `$APP_SOCKET`, no runtime dir, nothing to dial")
   *  needs somewhere to SAY so. A host with everything in `values` and nothing
   *  to refuse writes `Effect.succeed({ … })`.
   *
   *  A failure — or a throw — is exit 3, the same arm as a failed dial: there is
   *  no surface to reach. It is caught here rather than left as a defect on the
   *  runtime's default, because a path out of the process that never reaches the
   *  matrix is a matrix that is not true of the binary. */
  readonly resolve: (
    values: FlagValues<F>,
  ) => Effect.Effect<ResolvedEndpoint, unknown, R>;
  /** Can this transport carry a SUBSCRIPTION at all? Default `true`, which is
   *  every duplex link the framework ships (a socket, a websocket, a direct
   *  in-process client).
   *
   *  `false` says the far side answers questions and pushes nothing, and the
   *  projection then does not mount `watch` and does not declare `--follow` on
   *  `get` or `keys`. That is the whole of it, and it is a BUILD-time fact
   *  rather than a runtime refusal on purpose: a flag that parses and then
   *  always fails is a flag whose `--help` is untrue, and `--help` is the only
   *  place a caller finds out what a face can do. A one-shot read still works —
   *  every reader here takes the opening snapshot frame and interrupts the rest,
   *  so a link that answers once answers all of them.
   *
   *  The live consumer is a request/response door: olai's `olai surface` speaks
   *  MCP over HTTP to the same `/mcp` a bridged agent uses, and that endpoint
   *  answers one POST with one frame and pushes nothing (it says so itself, with
   *  a 405 on the SSE half). Mounting `watch` over it would offer a
   *  subscription that ends after its first frame — which reads as a stream that
   *  went quiet rather than as a door that has none. */
  readonly streaming?: boolean;
}

/** One resolved endpoint: what to call it, and how to open it.
 *
 *  `where` is what the user typed or what the app fell back to, in the app's own
 *  words — the fact a failed dial can act on. `open` rejecting is the honest
 *  answer for "nothing is serving there", and the rejection's own words are
 *  carried into the exit-3 diagnostic beside `where`. */
export interface ResolvedEndpoint {
  readonly where: string;
  readonly open: () => Promise<SurfaceCliConnection> | SurfaceCliConnection;
}

/** The commands this face mounts that are NOT verbs. Declared once, because the
 *  readers of the fact must agree: the builders below mint them, and the
 *  verb-name collision check refuses a bespoke verb that would shadow one.
 *
 *  EXPORTED because there is a third reader this function cannot be — the HOST.
 *  `surfaceCommands` does not own the parent it is mounted under, so a host verb
 *  of the same name is invisible here and answered by whichever the parser meets
 *  first, which is precisely the failure the in-package check exists to prevent
 *  one layer down. A host either asserts its own subcommand names against this,
 *  or mounts the projection under a parent of its own (`olai surface …`), which
 *  is the arrangement to prefer — it takes no names at all. */
export const READER_NAMES = ["get", "keys", "watch", "list"] as const;

/** A runtime-assembled command. The tree is built from a spec walk, so its type
 *  parameters carry nothing a caller could trust — the host mounts the values
 *  and `Command.run` types the whole.
 *
 *  The REQUIREMENT channel is a PARAMETER, not a constant: a host whose
 *  `resolve` reads its own parent context (`CommandContext<"kolu">`) produces
 *  handlers requiring it, and a channel pinned to what this face needs would
 *  refuse the very idiom the seam exists to allow. It defaults to `Stdio.Stdio`
 *  — what this face itself needs — so a host that resolves from `values` alone
 *  reads exactly what it read before. */
export type ProjectedCommand<R = Stdio.Stdio> = Command.Command<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: the parsed-input type of a runtime-built config.
  any,
  // biome-ignore lint/suspicious/noExplicitAny: the parent-context type the host decides.
  any,
  unknown,
  R
>;

/** The name of the OUTPUT flag — "give me the whole JSON answer, not the
 *  summary".
 *
 *  It is `--json` because that is what a person reaches for, and it could only
 *  be `--json` once the whole-INPUT escape hatch stopped being (`./flags.ts`'s
 *  {@link INPUT_FLAG}, which carries the argument for the rename). One name, one
 *  meaning, across every command this face mounts.
 *
 *  IT IS THE ONLY THING THAT DECIDES, and that is the change it carries. A
 *  renderer used to apply on a terminal and not through a pipe — `present`
 *  asked `stdoutIsTerminal` — which made the output shape a fact about what the
 *  process happened to be attached to: `capture … | tee` and `capture …` printed
 *  different things, a script's output changed under `script(1)`, and there was
 *  no way to ask for either one on purpose. Now the flag decides and nothing
 *  else does (human, 2026-08-23). What stdout being a terminal still decides is
 *  INDENTATION and nothing more — how a JSON answer is spaced, never which
 *  answer it is. */
export const JSON_FLAG = "json";

/** `--json`, spelled once for every command that has a summary to replace. */
const jsonFlag = Flag.boolean(JSON_FLAG).pipe(
  Flag.withDescription(
    "print the full JSON answer instead of the one-line summary",
  ),
  Flag.withDefault(false),
);

/** Every command this face mounts, in the order a `--help` should list them:
 *  the verbs (alphabetical), then the readers, then `list`. */
export function surfaceCommands<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
): ReadonlyArray<ProjectedCommand<Stdio.Stdio | R>> {
  const entries = classifyExpose(opts.surface.spec, opts.expose, "surface-cli");
  // Each table derived ONCE from the entries and handed to both its readers.
  // `list` is this face's authoritative answer to "what can I address", and an
  // authoritative answer computed separately from the thing it describes is one
  // edit away from describing something else.
  const verbs = callableVerbs(opts, entries);
  const readable = readables(entries);
  const mounted = [
    ...verbs.map((verb) => verbCommand(opts, verb)),
    ...readerCommands(opts, readable),
    listCommand(opts, verbs, readable),
  ];
  // A host that wrote a help page has ALREADY listed its verbs, in groups, with
  // an example each ({@link surfaceHelp}). Leaving them in the parent's own
  // SUBCOMMANDS block as well prints the same set twice on one page — once
  // organised and once alphabetically — and the flat copy is the one that reads
  // like the truth because the renderer wrote it. So the page is the listing, or
  // the renderer's is; never both. Each command is still reachable and still
  // answers `<verb> --help` with its own flags: `unlisted` hides a subcommand
  // from the PARENT's listing and from completions, and nothing else.
  return opts.help === undefined ? mounted : mounted.map(hide);
}

/** `Command.unlisted`, with the projection's loose types carried across it. */
const hide = <R>(command: ProjectedCommand<R>): ProjectedCommand<R> =>
  Command.unlisted(command) as ProjectedCommand<R>;

/**
 * The parent command's DESCRIPTION — the help page a person reads.
 *
 * Pure over the same options `surfaceCommands` takes, and derived from the same
 * two tables, so the page cannot describe a verb the projection does not mount:
 * a group naming a name nothing answers to is refused at BUILD, where the author
 * is, rather than shipping a help page that lies. The layout is `./help.ts`; the
 * wording is the host's ({@link SurfaceCliHelp}).
 *
 * A SECOND CALL rather than a second return value from `surfaceCommands`,
 * because the two land in different places: the commands are mounted with
 * `Command.withSubcommands` and this is piped through `Command.withDescription`.
 * Handing back a pair would make every host that wants no help page destructure
 * one.
 */
export function surfaceHelp<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R> & { readonly help: SurfaceCliHelp },
): string {
  const entries = classifyExpose(opts.surface.spec, opts.expose, "surface-cli");
  const verbs = callableVerbs(opts, entries);
  const readable = readables(entries);
  const rows = new Map<string, HelpRow>();
  const prefix = `${opts.info.name} ${opts.help.command}`;
  const exampleFor = (name: string): string | undefined => {
    const said = opts.help.examples?.[name];
    return said === undefined ? undefined : `${prefix} ${said}`;
  };
  for (const verb of verbs) {
    rows.set(verb.name, {
      name: verb.name,
      usage: verbUsage(verb),
      description: summary(verb),
      example: exampleFor(verb.name),
    });
  }
  for (const reader of readerRows(opts, readable)) {
    rows.set(reader.name, { ...reader, example: exampleFor(reader.name) });
  }

  const named = new Map<string, string>();
  const groups = opts.help.groups.map((group) => {
    const missing = group.verbs.filter((name) => !rows.has(name));
    if (missing.length > 0) {
      throw new SurfaceCliBuildError(
        `surface-cli: the help group "${group.title}" names ${missing.map((n) => `"${n}"`).join(", ")}, which this surface mounts no command for — this face offers ${[...rows.keys()].map((n) => `"${n}"`).join(", ")}.`,
      );
    }
    for (const name of group.verbs) {
      const prior = named.get(name);
      if (prior !== undefined) {
        throw new SurfaceCliBuildError(
          `surface-cli: the help groups "${prior}" and "${group.title}" both name "${name}" — a command belongs in one group.`,
        );
      }
      named.set(name, group.title);
    }
    return {
      title: group.title,
      rows: group.verbs.flatMap((name) => {
        const row = rows.get(name);
        return row === undefined ? [] : [row];
      }),
    };
  });
  // Anything the projection mounts and no group claimed. NOT dropped and not a
  // build error: a verb added to the table is a command with no code written for
  // it, so making the help refuse until somebody files it would put that cost
  // back — while a silent omission is a command nobody discovers. It gets a
  // group, visibly, and the author moves it when they get to it.
  const rest = [...rows.values()].filter((row) => !named.has(row.name));

  return helpText({
    purpose: opts.help.purpose,
    usage: `${prefix} <verb> [flags]`,
    groups:
      rest.length === 0 ? groups : [...groups, { title: "Other", rows: rest }],
    flags: [...(opts.help.flags ?? []), ...OWN_FLAGS],
    answer: opts.help.answer,
  });
}

/** The two flags this FACE puts on its commands, worded by the face that owns
 *  them — the host words its own endpoint flags, which is why they are a field
 *  on {@link SurfaceCliHelp} and these are not. */
const OWN_FLAGS: ReadonlyArray<HelpFlag> = [
  {
    spelling: `--${JSON_FLAG}`,
    description: "print the full JSON answer instead of the one-line summary",
  },
  {
    spelling: `--${INPUT_FLAG} <json>`,
    description:
      "the whole input as one JSON object (`-` reads it from stdin), instead of the field flags",
  },
];

/**
 * ONE LINE about a verb, for a page that has one line per verb.
 *
 * NOT its `description`, and that is the whole of this function. A description
 * is written for an AGENT — it is the prose a tool listing carries, and an app
 * that has thought about its agents has descriptions that run to paragraphs,
 * because that is what an agent reads before choosing a tool. Printing one of
 * those per row does not make a help page; it makes a wall, and the page this
 * module exists to replace was more readable.
 *
 * So the summary is the verb's `title` — MCP's own display name, the short
 * phrase a host shows in a tool list, which is exactly this shape of thing and
 * is already written. A verb with no title falls back to its description's
 * FIRST SENTENCE, and one with neither to a plain line naming it. The read-only
 * marker rides along either way, because that is a fact about the verb rather
 * than about the wording.
 *
 * A host that wants different words on the page writes a different `title`, and
 * both faces get it. There is deliberately no per-verb override in
 * {@link SurfaceCliHelp}: a second place to word a verb is a second place for it
 * to go stale, which is the argument this package makes everywhere else.
 */
function summary(verb: CallableVerb): string {
  const said = verb.title ?? sentence(verb.description) ?? `Call ${verb.name}.`;
  return verb.mutates ? said : `${said} (read-only)`;
}

/** The first sentence of a description, or nothing for a description that has
 *  none. Cut at the first sentence end followed by a space, or at the first
 *  blank line — and given up on entirely past a length no help row should carry,
 *  because a "sentence" that long is prose that was never one. */
function sentence(said: string | undefined): string | undefined {
  if (said === undefined || said === "") return undefined;
  const paragraph = said.split("\n")[0] ?? said;
  const stop = paragraph.search(/[.!?](\s|$)/u);
  const first = stop === -1 ? paragraph : paragraph.slice(0, stop + 1);
  return first.length > SUMMARY_LIMIT
    ? `${first.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`
    : first;
}

/** How long a summary may be before it is cut. Not a wrapping width — the row
 *  is one line by construction — but the point past which a "first sentence" is
 *  no longer a summary of anything. */
const SUMMARY_LIMIT = 96;

/** How a verb is typed: its name, its positions, and whether anything else can
 *  follow. The verb's OWN `--help` lists the flags with their types — a summary
 *  page that reproduced them would be the flat dump this page exists not to be. */
function verbUsage(verb: CallableVerb): string {
  const positions = (verb.annotation.positional ?? []).map(
    (field) => `<${field}>`,
  );
  const fields = Object.keys(verb.projection.config).filter(
    (name) =>
      name !== INPUT_FLAG && !(verb.annotation.positional ?? []).includes(name),
  );
  return [
    verb.name,
    ...positions,
    ...(fields.length > 0 ? ["[flags]"] : []),
  ].join(" ");
}

/** The reader commands as help rows — the SAME set {@link readerCommands}
 *  mounts, decided by the same two questions (is anything readable, can the
 *  endpoint push), so the page cannot offer a `watch` the projection withheld. */
function readerRows<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  table: Map<string, Readable>,
): ReadonlyArray<Omit<HelpRow, "example">> {
  const rows: Array<Omit<HelpRow, "example">> = [
    {
      name: "list",
      usage: "list",
      description: "List every verb and readable member this face offers.",
    },
  ];
  if (table.size === 0) return rows;
  const streams = opts.endpoint.streaming !== false;
  const collections = [...table.values()].filter(
    (r) => r.kind === "collection",
  );
  rows.unshift({
    name: "get",
    usage: streams ? "get <member> [key] [--follow]" : "get <member> [key]",
    description: streams
      ? "Read one exposed member — its current value, or (with --follow) its live subscription as ndjson."
      : "Read one exposed member's current value.",
  });
  for (const reader of COLLECTION_READERS) {
    if (reader.always && !streams) continue;
    if (collections.filter(reader.eligible).length === 0) continue;
    rows.splice(rows.length - 1, 0, {
      name: reader.name,
      usage:
        reader.always || !streams
          ? `${reader.name} <collection>`
          : `${reader.name} <collection> [--follow]`,
      description: streams
        ? reader.description
        : (reader.oneShot ?? reader.description),
    });
  }
  return rows;
}

// ── The verb half ────────────────────────────────────────────────────────

/** One callable verb, resolved: where it came from, what it takes, how it runs.
 *  Procedures and bespoke verbs differ in exactly two places — the dispatch, and
 *  whether the argument arrives encoded or decoded — so they are ONE shape with
 *  the dispatch as a field and the reading DERIVED from `source`, rather than
 *  two parallel builders. */
interface CallableVerb {
  readonly name: string;
  readonly source: "procedure" | "bespoke";
  readonly mutates: boolean;
  readonly description?: string;
  readonly title?: string;
  readonly schema: WireSchemaAny | undefined;
  readonly projection: InputProjection;
  readonly annotation: VerbAnnotation;
  readonly call: (
    client: SurfaceClientCallable,
    input: unknown,
  ) => Effect.Effect<unknown, unknown>;
}

function callableVerbs<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  entries: readonly ExposeEntry[],
): CallableVerb[] {
  const annotate = opts.annotate ?? {};
  const out: CallableVerb[] = [];

  for (const entry of entries) {
    if (entry.kind !== "procedure") continue;
    const name = toolName(entry.ns, entry.verb);
    const annotation = annotate[name] ?? {};
    const schema = entry.spec.input;
    out.push({
      name,
      source: "procedure",
      // The conservative default the whole stack shares, read through the
      // framework's one derivation rather than re-spelled here: an exposure that
      // does not explicitly say `mutates: false` is mutating, and a SAFETY
      // default spelled once per face is one that can be relaxed on one face.
      mutates: exposureMutates(entry.exposure),
      schema,
      projection: build(name, () =>
        flagsOf(schema, { positional: annotation.positional }),
      ),
      annotation,
      call: (client, input) => {
        const proc = client.surface[entry.ns]?.[entry.verb];
        if (proc === undefined) {
          return Effect.fail(
            new Error(
              `the served surface has no procedure "${entry.ns}.${entry.verb}"`,
            ),
          );
        }
        // A no-input procedure declares `Schema.Void`, so it is called with
        // `undefined` rather than with an empty object.
        return proc(schema === undefined ? undefined : input);
      },
    });
  }

  for (const [name, verb] of Object.entries(opts.verbs ?? {})) {
    const annotation = annotate[name] ?? {};
    const schema = verb.input as WireSchemaAny | undefined;
    out.push({
      name,
      source: "bespoke",
      mutates: verb.mutates ?? true,
      description: verb.description,
      title: verb.title,
      schema,
      projection: build(name, () =>
        flagsOf(schema, { positional: annotation.positional }),
      ),
      annotation,
      // A bespoke handler is `(args, client, signal) => Effect`, exactly as on
      // the MCP face. No transport signal exists on an argv face — cancellation
      // here IS fiber interruption, and a handler that composes surface members
      // inherits it directly, while one that LIFTS a Promise-shaped waiter
      // (the `wait_*` / `watch_next` family) mints the equivalent AbortSignal
      // inside its own two-arg `tryPromise`. Either way the handler owns what
      // an interrupt aborts.
      call: (client, args) => verb.handler(args, client, undefined),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  // Seeded with the READER commands, because they share one namespace with the
  // verbs: a bespoke verb called `get` would be mounted beside the reader of the
  // same name and the parser would answer with whichever it met first. The two
  // verb-vs-verb collisions were already refused here; this is the third, and it
  // was the invisible one.
  const seen = new Map<string, string>(
    READER_NAMES.map((name) => [name, "a reader command"]),
  );
  for (const verb of out) {
    const prior = seen.get(verb.name);
    if (prior !== undefined) {
      throw new SurfaceCliBuildError(
        `surface-cli: the name "${verb.name}" is produced by both ${prior} and ${verb.source} — rename one.`,
      );
    }
    seen.set(verb.name, verb.source);
  }
  // Every annotation must name a VERB that exists — asked of the set that
  // answers that question, not of `seen`, which answers "is this name taken?"
  // and includes the reader commands. `annotate` is only ever looked up by verb
  // name, so `{ get: { render } }` passed the old check and did nothing: exactly
  // the silence this block exists to prevent, and the same class of silence
  // `positional` naming no field is already refused for.
  const verbNames = new Set(out.map((verb) => verb.name));
  const stray = Object.keys(annotate).filter((name) => !verbNames.has(name));
  if (stray.length > 0) {
    throw new SurfaceCliBuildError(
      `surface-cli: "annotate" names ${stray.map((n) => `"${n}"`).join(", ")}, which no verb answers to — this surface offers ${out.map((v) => `"${v.name}"`).join(", ") || "no verbs"}.`,
    );
  }
  return out;
}

/** Run a build step, naming the verb whose projection refused. A build-time
 *  refusal reaches an author with no CLI to read it off, so it must say which
 *  verb it is about. */
function build<T>(name: string, f: () => T): T {
  try {
    return f();
  } catch (err) {
    if (err instanceof SurfaceCliBuildError) {
      throw new SurfaceCliBuildError(
        `surface-cli: verb "${name}": ${err.message}`,
      );
    }
    throw err;
  }
}

function verbCommand<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  verb: CallableVerb,
): ProjectedCommand<Stdio.Stdio | R> {
  return Command.make(
    verb.name,
    mergeConfig(opts, verb.name, verb.projection.config, true),
    (values: Record<string, unknown>) => runVerb(opts, verb, values),
  ).pipe(Command.withDescription(blurb(verb))) as ProjectedCommand<
    Stdio.Stdio | R
  >;
}

/** A verb's `--help` line: its own description, or a plain sentence naming it,
 *  with the read-only marker where it belongs. Spelled ONCE — the fallback used
 *  to appear in both arms of one ternary, with only the suffix differing. */
function blurb(verb: CallableVerb): string {
  const said = verb.description ?? `Call ${verb.name}.`;
  return verb.mutates ? said : `${said} (read-only)`;
}

/** Merge the endpoint flags into a command's own config, refusing a collision.
 *
 *  A host that declares them on its own parent instead passes none, and this is
 *  the identity — the seam's whole point being that where they live is the
 *  host's call.
 *
 *  A bare spread would let one silently overwrite the other — the later key
 *  wins, and a field the user can see on the sibling MCP face simply stops
 *  parsing here. So the collision is named at build, where an author can fix it.
 *  (Effect CLI independently refuses two params sharing a flag NAME; this covers
 *  the record KEY, which is the half a spread eats.) */
function mergeConfig<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  name: string,
  own: Command.Command.Config,
  /** Does this command have a SUMMARY that `--json` could replace? Verbs do
   *  (a `render` annotation) and so does `list` (its aligned table); a reader
   *  does not — it writes the data frame and nothing else — so it takes no
   *  `--json`, rather than one whose help line would promise a switch between
   *  two things it does not have. */
  summarised = false,
): Command.Command.Config {
  const endpoint = opts.endpoint.flags ?? {};
  const added: Command.Command.Config = summarised
    ? { ...endpoint, [JSON_FLAG]: jsonFlag }
    : endpoint;
  const clash = Object.keys(added).filter((key) => Object.hasOwn(own, key));
  if (clash.length > 0) {
    throw new SurfaceCliBuildError(
      `surface-cli: "${name}" declares ${clash.map((c) => `"${c}"`).join(", ")}, which the endpoint flags or --${JSON_FLAG} also declare. Rename the endpoint flag, or the input field.`,
    );
  }
  return { ...own, ...added };
}

function runVerb<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  verb: CallableVerb,
  values: Record<string, unknown>,
): Effect.Effect<void, unknown, Stdio.Stdio | R> {
  return Effect.gen(function* () {
    // Stdin is DESCRIBED here and read only by the one path that wants it
    // (`--input -`), inside `assemble` — not off fd 0 synchronously, and not on a
    // pre-flight question this caller could forget to ask. A verb that did not
    // ask never touches the descriptor, so nothing hangs waiting on a terminal
    // nobody typed into.
    // `readStdin` fails with a VALUE — it does not know the binary's name. This
    // is where the name is, so this is where the sentence is written: one
    // constructor and one prefix, like every other usage arm. (It read
    // `could not read stdin …` with nothing in front of it, the only line in the
    // face without the binary's name on it.)
    const assembled = yield* Effect.catchTag(
      verb.projection.assemble(values, readStdin),
      "StdinUnreadable",
      (unreadable) =>
        Effect.fail(
          usage(
            opts.info.name,
            `could not read stdin for --${INPUT_FLAG} -: ${unreadable.why}`,
          ),
        ),
    );
    if (!assembled.ok) {
      return yield* Effect.fail(usage(opts.info.name, assembled.because));
    }

    // Decode ONCE, here, so a typo is a LOCAL usage error from the same taxonomy
    // the server would have used rather than a round trip that fails on the far
    // side. The ENCODED value travels on regardless — a procedure's client ref
    // decodes what it is given, and only a bespoke handler wants the decoded one.
    const encoded = assembled.input;
    let decoded: unknown = encoded;
    if (verb.schema !== undefined) {
      // `Result`, not `Option`: the whole point of decoding HERE is that a typo
      // is a local usage error "from the same taxonomy the server would have
      // used", and the taxonomy is IN the parse failure — which field, which
      // check. Discarding it left the user reading back the blob they had just
      // typed, with nothing said about what was wrong with it.
      const result = Schema.decodeUnknownResult(verb.schema)(encoded);
      if (Result.isFailure(result)) {
        return yield* Effect.fail(
          usage(
            opts.info.name,
            `${verb.name}: this input does not match what the verb declares — ${messageOf(result.failure)}`,
          ),
        );
      }
      decoded = result.success;
    }

    const output = yield* withConnection(opts, values, (client) =>
      // WHICH reading this verb's dispatch wants, off the one field that already
      // says: a procedure's client ref decodes what it is handed, so it takes
      // the ENCODED value, while a bespoke handler's `args` ARE the decoded one.
      verb.call(client, verb.source === "bespoke" ? decoded : encoded),
    );
    // The author's renderer, unless `--json` asked for the answer whole —
    // `io.ts` owns that branch, and NOTHING here asks what stdout is attached
    // to (see {@link JSON_FLAG}).
    yield* present(output, verb.annotation.render, values[JSON_FLAG] === true);
  });
}

// ── The reader half ──────────────────────────────────────────────────────

/** An exposed primitive, resolved to what a reader needs in order to address
 *  it: which member verb to call, and what the `[arg]` position decodes against.
 *
 *  A SUM and not a flat product, because validity here is per kind and the flat
 *  shape admitted states the domain forbids — a cell with a key schema, a stream
 *  that answers `listable`. Every consumer narrows on `kind` and the compiler
 *  hands it exactly the fields that kind has: the two `as WireSchemaAny` casts
 *  that used to launder away an optionality the domain never had are gone, and
 *  `listable` cannot be asked of a stream at all. The schema also stops being one
 *  name for two things (a collection's KEY, a stream's INPUT), which is why its
 *  doc comment had to spell out both. */
type Readable =
  | { readonly kind: "cell"; readonly name: string }
  | {
      readonly kind: "collection";
      readonly name: string;
      /** What the `<key>` position decodes against. */
      readonly keySchema: WireSchemaAny;
      /** Does it declare `deltas`, so `watch` can address it? */
      readonly watchable: boolean;
      /** Does it declare `keys`? Read off the member's own verbs, not assumed:
       *  `keys` is a DEFAULT collection verb and a spec may drop it, and a
       *  bounded item read handed a membership stream that does not exist fails
       *  a read of an item that is right there. */
      readonly listable: boolean;
    }
  | {
      readonly kind: "stream" | "event";
      readonly name: string;
      /** What the `[input]` position decodes against. */
      readonly inputSchema: WireSchemaAny;
    };

function readables(entries: readonly ExposeEntry[]): Map<string, Readable> {
  const table = new Map<string, Readable>();
  for (const entry of entries) {
    // Matched exhaustively on the entry's kind, in the SAME spelling the MCP
    // face's walk of the same union uses (`expose.ts`): a fifth `ExposeEntry`
    // kind stops this compiling and gets a decision HERE, rather than being
    // quietly mounted as a stream by a trailing `else`. Two faces reading one
    // union by one grammar is the whole reason the union is shared.
    const readable = match(entry)
      .with({ kind: "procedure" }, () => undefined)
      .with(
        { kind: "cell" },
        ({ key }): Readable => ({ kind: "cell", name: key }),
      )
      .with({ kind: "collection" }, ({ key, spec }): Readable => {
        const collection = spec as CollectionSpec<unknown, unknown, unknown>;
        return {
          kind: "collection",
          name: key,
          keySchema: collection.keySchema,
          watchable: collectionHasDeltas(collection),
          listable: resolveCollectionVerbs(collection).includes("keys"),
        };
      })
      .with(
        { kind: P.union("stream", "event") },
        ({ kind, key, spec }): Readable => ({
          kind,
          name: key,
          inputSchema: spec.inputSchema,
        }),
      )
      .exhaustive();
    if (readable !== undefined) table.set(readable.name, readable);
  }
  return table;
}

/** `--follow`, spelled once: the same flag on `get` and on `keys`, because it
 *  means the same thing on both and two declarations is two places to reword it. */
const followFlag = Flag.boolean("follow").pipe(
  Flag.withAlias("f"),
  Flag.withDescription(
    "keep the subscription open and write one ndjson line per frame, until the stream ends or Ctrl-C",
  ),
  Flag.withDefault(false),
);

/** The `<member>` position, listing what it can name — a `--help` that says
 *  which members exist is the difference between a discoverable face and one you
 *  have to read the source of. */
const memberArgument = (label: string, names: readonly string[]) =>
  Argument.string(label).pipe(
    Argument.withDescription(
      `one of: ${[...names].sort().join(", ") || "(none exposed)"}`,
    ),
  );

/** `keys` and `watch` — ONE reader with four constants swapped, rather than two
 *  functions and two command literals that differed only by a name, a sentence,
 *  and whether `--follow` is read or forced.
 *
 *  `eligible` is asked in two places that must agree: it picks the members the
 *  `<collection>` argument LISTS in `--help`, and it is the same question
 *  {@link resolveMember} asks of the whole table when the argument is resolved.
 *  Written twice, a command could offer a member it then refuses. */
interface CollectionReader {
  readonly name: "keys" | "watch";
  readonly eligible: (
    collection: Extract<Readable, { kind: "collection" }>,
  ) => boolean;
  /** What a refusal calls the set this reader can address. */
  readonly wanted: string;
  /** The member verb to open. */
  readonly verb: string;
  /** Does it ALWAYS stream? `watch` IS the subscription — there is no one-shot
   *  reading of a delta stream — so it takes no `--follow` and forces it, while
   *  `keys` has a current key set to answer with and reads the flag. */
  readonly always: boolean;
  readonly description: string;
  /** The same sentence where the door pushes nothing, so `--follow` is not
   *  declared and must not be named. Absent on a reader that is not mounted
   *  there at all — `watch` IS the subscription, and there is no one-shot
   *  wording for it to have. */
  readonly oneShot?: string;
}

const COLLECTION_READERS: readonly CollectionReader[] = [
  {
    name: "keys",
    eligible: (collection) => collection.listable,
    wanted: "collection with a key set",
    verb: "keys",
    always: false,
    description:
      "List a collection's current key set — with --follow, every key set as it changes.",
    oneShot: "List a collection's current key set.",
  },
  {
    name: "watch",
    eligible: (collection) => collection.watchable,
    wanted: "watchable collection",
    verb: "deltas",
    always: true,
    description:
      "Follow a collection: the whole set as one snapshot frame, then one ndjson line per batch of changes.",
  },
];

function readerCommands<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  table: Map<string, Readable>,
): Array<ProjectedCommand<Stdio.Stdio | R>> {
  if (table.size === 0) return [];
  // Whether the far side can push AT ALL — the one fact that decides which
  // readers exist. Absent means yes, because every link the framework ships is
  // duplex; see {@link EndpointSeam.streaming}.
  const streams = opts.endpoint.streaming !== false;
  const collections = [...table.values()].filter(
    (r) => r.kind === "collection",
  );
  const commands: Array<ProjectedCommand<Stdio.Stdio | R>> = [];

  commands.push(
    Command.make(
      "get",
      mergeConfig(opts, "get", {
        member: memberArgument("member", [...table.keys()]),
        arg: Argument.string("arg").pipe(
          Argument.withDescription(
            "a collection's key, or a stream's or event's input",
          ),
          Argument.optional,
          Argument.map(Option.getOrUndefined),
        ),
        ...(streams ? { follow: followFlag } : {}),
      }),
      (values: Record<string, unknown>) => runGet(opts, table, values),
    ).pipe(
      Command.withDescription(
        streams
          ? "Read one exposed member — its current value, or (with --follow) its live subscription as ndjson."
          : "Read one exposed member's current value.",
      ),
    ) as ProjectedCommand<Stdio.Stdio | R>,
  );

  // Mounted only where the surface has something for them to address: a `keys`
  // over no listable collection is a command whose every invocation is a usage
  // error.
  for (const reader of COLLECTION_READERS) {
    // A reader that IS a subscription has nothing to offer a door that pushes
    // nothing, so it is not mounted at all — the same rule, one line up, as the
    // `--follow` flag it would have forced.
    if (reader.always && !streams) continue;
    const eligible = collections.filter(reader.eligible);
    if (eligible.length === 0) continue;
    commands.push(
      Command.make(
        reader.name,
        mergeConfig(opts, reader.name, {
          member: memberArgument(
            "collection",
            eligible.map((c) => c.name),
          ),
          ...(reader.always || !streams ? {} : { follow: followFlag }),
        }),
        (values: Record<string, unknown>) =>
          runCollectionRead(opts, table, values, reader),
      ).pipe(
        Command.withDescription(
          streams ? reader.description : (reader.oneShot ?? reader.description),
        ),
      ) as ProjectedCommand<Stdio.Stdio | R>,
    );
  }

  return commands;
}

/** Resolve the `<member>` argument, or say what IS addressable.
 *
 *  A name that reaches no member is a usage error, never an empty answer: an
 *  empty answer for a typo is the silent degradation this repo treats as a
 *  defect. */
function resolveMember<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  table: Map<string, Readable>,
  values: Record<string, unknown>,
  want?: (readable: Readable) => boolean,
  wanted = "member",
): Effect.Effect<Readable, SurfaceCliFailure> {
  const name = String(values.member);
  const eligible = [...table.values()].filter(
    (r) => want === undefined || want(r),
  );
  const found = table.get(name);
  if (found === undefined || !eligible.includes(found)) {
    return Effect.fail(
      usage(
        opts.info.name,
        `"${name}" names no exposed ${wanted} — this surface exposes ${
          eligible
            .map((r) => r.name)
            .sort()
            .join(", ") || "none"
        }.`,
      ),
    );
  }
  return Effect.succeed(found);
}

function runGet<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  table: Map<string, Readable>,
  values: Record<string, unknown>,
): Effect.Effect<void, unknown, Stdio.Stdio | R> {
  return Effect.gen(function* () {
    const member = yield* resolveMember(opts, table, values);
    const follow = values.follow === true;
    const raw = values.arg as string | undefined;

    // THE one exception to the shared tail below: a collection `get` for a key
    // that is not a member yet is a held-open subscription that yields nothing
    // (juspay/kolu#1681), so a one-shot read of one must be BOUNDED rather than
    // opened like every other member.
    if (member.kind === "collection" && !follow) {
      const key = yield* collectionKey(opts, member, raw);
      return yield* withConnection(opts, values, (client, where) =>
        readCollectionItem(opts.info.name, where, client, member, key),
      );
    }

    // Every other read is the same three lines with a different `get` argument,
    // so the arms decide only WHAT to call it with and the tail is shared.
    const input = yield* getArgument(opts, member, raw, follow);
    return yield* withConnection(opts, values, (client) =>
      readStream(
        memberStream(client, member.name, "get", input),
        follow,
        member.name,
      ),
    );
  });
}

/** What one member's `get` is called with — or the refusal, when the `[arg]`
 *  position does not suit the member's kind.
 *
 *  Arms and not a `{arity, message}` table: each is a DIFFERENT sentence about a
 *  different mistake, and a table would hold the same four facts spelled
 *  sideways, one column of which is the sentence anyway. */
function getArgument<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  member: Readable,
  raw: string | undefined,
  follow: boolean,
): Effect.Effect<unknown, SurfaceCliFailure> {
  return (
    match(member)
      .with({ kind: "cell" }, (cell) =>
        raw === undefined
          ? Effect.succeed(undefined)
          : Effect.fail(
              usage(
                opts.info.name,
                `"${cell.name}" is a cell — it holds one value and takes no argument.`,
              ),
            ),
      )
      // Reached only under `--follow` — the bounded one-shot read above took the
      // other reading — but the KEY is the same key, decoded by the same rule.
      .with({ kind: "collection" }, (collection) =>
        Effect.map(collectionKey(opts, collection, raw), (key) => ({ key })),
      )
      // An EVENT has no current value — it is occurrences over time, and its
      // handler yields nothing until one happens. A one-shot read of it
      // therefore waits forever, silently, which is the worst answer a command
      // can give; so it is refused HERE, in this face's own words, rather than
      // hanging. Guarded on the FLAG, so the arm below still answers the same
      // member under `--follow`.
      .with(
        { kind: "event" },
        (_event) => !follow,
        (event) =>
          Effect.fail(
            usage(
              opts.info.name,
              `"${event.name}" is an event — it has occurrences, not a current value, so there is nothing to read once. Use --follow to watch for them.`,
            ),
          ),
      )
      // A stream, or a followed event. Its input rides the same `[arg]`
      // position, decoded against the member's OWN schema — the argv twin of the
      // collection key, through the one text-to-schema rule both faces share.
      .with({ kind: P.union("stream", "event") }, (io) =>
        streamInput(opts, io.name, io.inputSchema, raw),
      )
      .exhaustive()
  );
}

/** The `<key>` position, landed in the collection's declared key type — the
 *  DECODED reading, because a collection payload is built from decoded keys
 *  (`client.ts`), which is the other half of the same landed token the stream
 *  arm takes encoded. */
function collectionKey<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  member: Extract<Readable, { kind: "collection" }>,
  raw: string | undefined,
): Effect.Effect<unknown, SurfaceCliFailure> {
  if (raw === undefined) {
    return Effect.fail(
      usage(
        opts.info.name,
        `"${member.name}" is a collection — name the key to read, or use \`keys ${member.name}\` for the key set.`,
      ),
    );
  }
  const landed = decodeTextValue(member.keySchema, raw);
  return Option.isNone(landed)
    ? Effect.fail(
        usage(
          opts.info.name,
          `"${raw}" is not a key of "${member.name}" — it does not match the collection's declared key type.`,
        ),
      )
    : Effect.succeed(landed.value.decoded);
}

/** What to call a stream's or event's `get` with: the decoded `[arg]`, or the
 *  no-argument value when the member's own schema admits one.
 *
 *  The admission test is the schema's, not a guess — and it is the FRAMEWORK's
 *  {@link admitsNoArgument}, the same predicate `serveSurfaceAsMcp` asks before
 *  publishing a static resource, because "is this member addressable with no
 *  argument" answered twice is a way for the two faces to disagree about which
 *  members exist. Each face keeps its own policy for a `false`: a boot refusal
 *  there, this usage error here. */
function streamInput<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  member: string,
  schema: WireSchemaAny,
  raw: string | undefined,
): Effect.Effect<unknown, SurfaceCliFailure> {
  if (raw === undefined) {
    return admitsNoArgument(schema)
      ? Effect.succeed(undefined)
      : Effect.fail(
          usage(
            opts.info.name,
            `"${member}" needs an input — give it as the argument after the member name.`,
          ),
        );
  }
  const landed = decodeTextValue(schema, raw);
  // The ENCODED reading, never the raw token: a member's client ref decodes what
  // it is handed, eagerly and synchronously, so a stream whose input is a number
  // handed the string "42" throws at the call site — a DEFECT, outside every arm
  // of the exit contract. `decodeTextValue` already knows which reading landed;
  // this takes it rather than assuming the token was its own encoding.
  return Option.isSome(landed)
    ? Effect.succeed(landed.value.encoded)
    : Effect.fail(
        usage(
          opts.info.name,
          `"${raw}" does not match the input "${member}" declares.`,
        ),
      );
}

/** `keys` and `watch`, which are one read: resolve the `<collection>` against
 *  this reader's own eligibility, open its member verb, write what comes back. */
function runCollectionRead<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  table: Map<string, Readable>,
  values: Record<string, unknown>,
  reader: CollectionReader,
): Effect.Effect<void, unknown, Stdio.Stdio | R> {
  return Effect.gen(function* () {
    const member = yield* resolveMember(
      opts,
      table,
      values,
      (r) => r.kind === "collection" && reader.eligible(r),
      reader.wanted,
    );
    yield* withConnection(opts, values, (client) =>
      readStream(
        memberStream(client, member.name, reader.verb, undefined),
        reader.always || values.follow === true,
        member.name,
      ),
    );
  });
}

/** Address one member verb on the live client. */
function memberStream(
  client: SurfaceClientCallable,
  member: string,
  verb: string,
  input: unknown,
): Stream.Stream<unknown, unknown> {
  const proc = client.surface[member]?.[verb];
  if (proc === undefined) {
    return Stream.fail(
      new Error(`the served surface has no "${member}.${verb}"`),
    );
  }
  return proc(input) as Stream.Stream<unknown, unknown>;
}

/** One-shot the opening snapshot frame, or follow every frame as ndjson.
 *
 *  The one-shot arm is `Stream.runHead` underneath, which takes the head and
 *  INTERRUPTS the rest — and interruption IS the unsubscribe, so the read tears
 *  its own subscription down with no signal to thread. The follow arm ends the
 *  same way: interrupting the fiber runs the stream's finalizers. */
function readStream(
  stream: Stream.Stream<unknown, unknown>,
  follow: boolean,
  member: string,
): Effect.Effect<void, unknown, Stdio.Stdio> {
  // ONE sink for the whole subscription, not one per line — `io.ts` owns that,
  // and owns the hang-up rule that goes with it.
  if (follow) return frames(stream);
  // NOTHING is caught here, and that is the fix this arm carries. An empty open
  // IS a dropped link — every snapshot-then-deltas member opens with its current
  // value — but `firstFrameOrThrow` already says so with a tag, and `classify`
  // reads that tag itself. This arm used to catch the whole failure channel and
  // re-word it, so a member's DECLARED refusal came back as "no surface at …" on
  // exit 3, the code that tells a driver to try a different socket, while the
  // same refusal under `--follow` reported correctly: one member, two answers,
  // decided by a flag. Both arms now hand the failure over untouched.
  return Effect.flatMap(
    firstFrameOrThrow(stream, noSnapshot(member)),
    (value) => data(value),
  );
}

/** What a one-shot reader tells the framework an EMPTY OPEN is. One sentence for
 *  both readers below rather than two literals a reword could separate; what it
 *  MEANS — the endpoint going away mid-read, exit 3 — is `classify`'s, off the
 *  `NoSnapshotFrame` tag `firstFrameOrThrow` raises with it. */
const noSnapshot = (member: string): string =>
  `"${member}" opened and closed without a snapshot frame`;

/** The bounded one-shot read of a collection ITEM.
 *
 *  A collection `get` for a key that is not a member yet is a held-open
 *  subscription that yields nothing (juspay/kolu#1681), so a bare first-frame
 *  read would HANG on a missing key. `firstFrameOfCollectionItem` races the item
 *  against membership and a deadline; the two absences are reported apart,
 *  because "it is not there" and "I could not tell in time" are different
 *  answers and only the first is evidence.
 *
 *  So they land on DIFFERENT arms of the exit contract, and that is the whole
 *  point of reading them apart:
 *
 *    - `"absent"` is a fact about the ITEM. Membership answered, and the answer
 *      is "not a member" — a successful read whose value is an absence, so it is
 *      a stdout frame at exit 0 like any other answer.
 *    - `"deadline"` is a fact about the READ. Nothing answered inside the
 *      budget: a collection that declares no `keys` verb has no membership
 *      signal at all and is bounded by the timer alone, and a present item whose
 *      snapshot is slow reaches it too. Reporting "I could not find out" on the
 *      code that means "the verb did what it was asked" is the silent
 *      degradation this repo treats as a defect — a reaper that branches on the
 *      payload sees an absence, and one that branches on the code sees a
 *      success. It is exit 3, naming the member, the key and the budget: the
 *      endpoint did not answer, which is the same shape of fact a dead socket
 *      is, and the one arm that tells a driver the request is worth another
 *      endpoint or another try. */
function readCollectionItem(
  binary: string,
  where: string,
  client: SurfaceClientCallable,
  member: Extract<Readable, { kind: "collection" }>,
  key: unknown,
): Effect.Effect<void, unknown, Stdio.Stdio> {
  // Nothing is caught here either: a PRESENT item that opened and said nothing
  // is the link going away, and the framework's reader raises it with the tag
  // `classify` reads. The item and membership streams carry their own error
  // channels, and a declared refusal on either is the far side answering — which
  // is exactly what re-wording this whole channel used to lose.
  return Effect.flatMap(
    firstFrameOfCollectionItem(
      memberStream(client, member.name, "get", { key }),
      // `null`, not a stream that will fail: a collection may legitimately
      // declare no `keys` verb, and the framework's reader takes the ABSENCE of
      // a membership signal as a case (it falls back to the deadline alone)
      // rather than as an error. Handing it a stream that fails instead turned a
      // read of an item that is right there into a failure.
      member.listable
        ? memberStream(client, member.name, "keys", undefined)
        : null,
      key,
      noSnapshot(member.name),
      ITEM_READ_DEADLINE_MS,
    ),
    (found) => {
      if (found.present) return data(found.value);
      if (found.reason === "deadline") {
        return Effect.fail(
          unreachable(
            binary,
            where,
            `"${member.name}" did not answer for key ${JSON.stringify(key)} within ${ITEM_READ_DEADLINE_MS}ms — the read did not complete, so whether the item is there is still unknown`,
          ),
        );
      }
      return data({ member: member.name, key, present: false, why: "absent" });
    },
  );
}

// ── `list` ───────────────────────────────────────────────────────────────

/** What `list` answers: every verb with the input it takes, and every readable
 *  member with its kind. The face's own `tools/list`, answered off the SAME
 *  advertised document the flag table was built from — one walk of one schema,
 *  so the table cannot describe a verb the commands do not.
 *
 *  `input` is that document in the reading THIS face takes, which is not always
 *  the MCP face's: a scalar / array / union input travels the wire under one
 *  property, and MCP publishes that WRAPPER (`{properties:{value:…}}`). Argv
 *  binds the bare value to a `<value>` positional and has no `--value` flag at
 *  all — so publishing the wrapper here would make this face's authoritative
 *  "what can I address" describe the one shape it refuses, for exactly the verbs
 *  whose command line is simplest. */
interface ListTable {
  readonly verbs: ReadonlyArray<{
    readonly name: string;
    readonly source: string;
    readonly mutates: boolean;
    readonly title?: string;
    readonly description?: string;
    readonly input: Record<string, unknown>;
  }>;
  readonly resources: ReadonlyArray<{
    readonly name: string;
    readonly kind: string;
  }>;
}

/** The table `list` writes, built WHEN `list` RUNS.
 *
 *  Not at build time, which is where it was: every invocation of every verb paid
 *  for a table almost none of them read, and the only converter call it needed
 *  had already happened — `flagsOf` runs the same bridge over the same schema to
 *  make the flags, moments earlier. So the walk ran twice per verb (56× on olai,
 *  0.023 ms each) and once more than any run of the binary can use. */
function listTable(
  verbs: readonly CallableVerb[],
  readable: Map<string, Readable>,
): ListTable {
  return {
    verbs: verbs.map((verb) => {
      const advertised = verb.projection.advertised;
      return {
        name: verb.name,
        source: verb.source,
        mutates: verb.mutates,
        ...(verb.title === undefined ? {} : { title: verb.title }),
        ...(verb.description === undefined
          ? {}
          : { description: verb.description }),
        input: advertised.wrapped ? advertised.inner : advertised.schema,
      };
    }),
    resources: [...readable.values()].map((member) => ({
      name: member.name,
      kind: member.kind,
    })),
  };
}

function listCommand<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  verbs: readonly CallableVerb[],
  readable: Map<string, Readable>,
): ProjectedCommand<Stdio.Stdio | R> {
  return Command.make(
    "list",
    // The endpoint flags ride `list` too, even though it dials nothing: every
    // other command takes them, and a script that loops over the verbs must not
    // break on the one that would refuse them. What it answers is THIS face's
    // projection, which is the same table whatever endpoint you point at — the
    // help line says so, so the flag is accepted rather than quietly promising
    // something it does not do.
    //
    // And it takes `--json`, which it once had and lost. It lost it because the
    // name meant the whole INPUT on every verb and an OUTPUT FORMAT here — two
    // meanings across one mounted set, so the second was withdrawn rather than
    // left to be guessed at. The input hatch is `--input` now (`./flags.ts`),
    // which gives the name back to the answer: `--json` is one thing on `list`,
    // on every verb with a renderer, and on any command this face grows.
    mergeConfig(opts, "list", {}, true),
    // A THUNK OVER THE PARSED VALUES, so the table is built by the one command
    // that writes it and the flag it was asked with reaches the same `present`
    // every verb goes through — the aligned table by default, the JSON when
    // `--json` says so, and no question anywhere about what stdout is.
    (values: Record<string, unknown>) =>
      present(
        listTable(verbs, readable),
        alignedTable,
        values[JSON_FLAG] === true,
      ),
  ).pipe(
    Command.withDescription(
      "List what this surface offers — every verb and every readable member. This face's tools/list, answered from the projection itself, so it dials nothing.",
    ),
  ) as ProjectedCommand<Stdio.Stdio | R>;
}

/** The table as a human reads it: one line per verb and per readable member,
 *  names padded to a common width. A plain renderer, so it is the same kind of
 *  thing a verb's `annotate.render` is. */
function alignedTable(value: unknown): string {
  const table = value as ListTable;
  const width = Math.max(
    0,
    ...table.verbs.map((verb) => verb.name.length),
    ...table.resources.map((resource) => resource.name.length),
  );
  return [
    ...table.verbs.map((verb) =>
      `${verb.name.padEnd(width)}  ${verb.mutates ? "writes" : "reads "}  ${verb.description ?? ""}`.trimEnd(),
    ),
    ...table.resources.map((resource) =>
      `${resource.name.padEnd(width)}  ${resource.kind}`.trimEnd(),
    ),
  ].join("\n");
}

// ── The connection, for the length of one command ────────────────────────

/** A teardown that must not have a last word. A socket close that rejects
 *  has nothing to add to a command that already has — or just lost — its
 *  answer, and an escaping rejection is either a DEFECT that replaces the
 *  verdict (the release arm) or an unhandled promise rejection mid-Ctrl-C
 *  (the arrive-late arm of the interruptible acquire). One concept, one
 *  spelling; the socket is going away with the process either way. */
const disposeQuietly = async (c: { dispose(): void | Promise<void> }) => {
  // The (synchronous) call is DEFERRED under `.then`: a `dispose` that THROWS
  // before returning must read exactly like one that rejects — the `.catch`
  // owns both, never the caller's framing.
  await Promise.resolve()
    .then(() => c.dispose())
    .catch(() => {});
};

/** Dial, run, release — in that order, whatever happens in the middle.
 *
 *  `acquireRelease` is what makes the release survive an INTERRUPTION: a Ctrl-C
 *  during `--follow` interrupts the fiber, the stream's own finalizers
 *  unsubscribe, and this closes the socket on the way out. A `try/finally`
 *  around a promise would not — there is no promise left to unwind.
 *
 *  A failed dial is exit 3 and names WHERE, because that is the fact a user can
 *  act on. So is a failed RESOLUTION, one step earlier: the seam is an Effect,
 *  and a host whose order came up empty ("no `$APP_SOCKET`, nothing to dial")
 *  fails it — or throws out of it, which under a generator body would be a
 *  DEFECT no `Effect.catch` sees, exiting on the runtime's default and colliding
 *  with exit 1, the code the matrix reserves for "the verb refused". Both are
 *  caught here, so no path out of this process misses the matrix. */
function withConnection<S extends SurfaceSpec, F extends FlagRecord, R, A>(
  opts: SurfaceCliOptions<S, F, R>,
  values: Record<string, unknown>,
  /** Whatever the command does with the live client. Its failure travels to
   *  `classify` untouched — including one that is about the ENDPOINT rather than
   *  about the verb (a member that opened and closed with no snapshot frame),
   *  because the classifier owns the arms and is the only thing here that knows
   *  `where`.
   *
   *  `where` is handed OVER as well, for the one read that has to word an
   *  endpoint arm itself rather than let the classifier derive it: a bounded
   *  item read that ran out of time knows the member, the key and the budget,
   *  and no failure it could raise instead would carry those three facts to a
   *  classifier that never saw them (see {@link readCollectionItem}). It is the
   *  same string this function dials with, so the diagnostic names what the user
   *  pointed at. */
  use: (
    client: SurfaceClientCallable,
    where: string,
  ) => Effect.Effect<A, unknown, Stdio.Stdio>,
): Effect.Effect<A, unknown, Stdio.Stdio | R> {
  const resolved = Effect.catchCause(
    Effect.suspend(() => opts.endpoint.resolve(values as FlagValues<F>)),
    (cause) =>
      // An INTERRUPT passes through untouched. `catchCause` catches failures,
      // defects AND interruptions, and `resolve` is an Effect precisely so a host
      // can do real work in it (stat a socket, read a runtime dir) — so a Ctrl-C
      // during that work landed here and was re-worded as "no endpoint to dial",
      // exit 3, instead of the 130 the matrix publishes. 130 is Effect's own
      // teardown reading an interrupts-only cause; the way to keep it is to hand
      // that cause straight back.
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.fail(
            unresolvable(opts.info.name, messageOf(Cause.squash(cause))),
          ),
  );
  return Effect.flatMap(resolved, ({ where, open }) =>
    Effect.scoped(
      Effect.flatMap(
        Effect.acquireRelease(
          // `interruptible: true`: the acquire must DIE ON a consumer's
          // Ctrl-C — a host whose `open` is an ssh provision can sit in it for
          // minutes, and a masked `tryPromise` would hold the interrupt for
          // the whole dial (the matrix promises 130 at the speed the user
          // typed it). The trade: delivery and finalizer-registration stop
          // being one masked atom, so the arriving half of an INTERRUPTED
          // `open` is disposed by hand, here — on `signal.aborted`, because an
          // interrupted acquire is short-circuited BEFORE its `release` is
          // registered, never after.
          // "Dispose quietly" is ONE concept, spelled HERE once: a teardown
          // that fails has nothing to add to a command that already has (or
          // just lost) its answer, and an escaping rejection is either a
          // DEFECT that replaces the verdict (in the release arm, where the
          // command succeeded) or an unhandled rejection mid-Ctrl-C (in the
          // arrive-late arm). The socket is going away with the process either
          // way.
          //
          // The check's bound is honest, not absolute: `signal.aborted` does
          // not close the microseconds-wide race where the interrupt lands
          // BETWEEN this deferred check running and `acquireRelease` registering
          // the finalizer — a connection could escape both arms for that gap.
          // This is a ONE-SHOT command-line binary: the interrupt finds the
          // process already in its exit path (130), the kernel reaps whatever
          // the gap could ever leak within the process's remaining microseconds,
          // and no host of this library runs longer than one command.
          // Threading the signal into the seam's `open` itself is refused
          // instead — it would smuggle Effect's interruption semantics into
          // every host's dial — so the residual cost is a gap bounded at one
          // OS FD for the process's remaining microseconds, bought to keep
          // `open`'s shape channel-agnostic.
          Effect.tryPromise({
            try: (signal) =>
              Promise.resolve(open()).then(async (connection) => {
                if (signal.aborted) await disposeQuietly(connection);
                return connection;
              }),
            catch: (cause) =>
              unreachable(opts.info.name, where, messageOf(cause)),
          }),
          (connection) =>
            Effect.ignore(
              Effect.tryPromise({
                try: async () => await disposeQuietly(connection),
                catch: (cause) => cause,
              }),
            ),
          { interruptible: true },
        ),
        (connection) =>
          Effect.catch(use(connection.client, where), (error) =>
            Effect.fail(classify(opts.info.name, where, error)),
          ),
      ),
    ),
  );
}
