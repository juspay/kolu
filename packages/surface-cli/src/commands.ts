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
 * ## The endpoint flags ride each VERB, not the parent
 *
 * `endpoint.flags` are merged into every generated command's own config, so
 * `surface capture "…" --socket /run/x.sock` parses. They deliberately do NOT go
 * on the parent as shared flags: this function does not own the parent (the host
 * makes it), and a host that added them there as well would collide outright —
 * Effect CLI refuses a parent/child flag of the same name with `DuplicateOption`.
 * One home, and it is the one this function can guarantee.
 *
 * ## What is projected
 *
 * | spec member | argv |
 * | --- | --- |
 * | procedure `ns.verb` exposed `"tool"` | `<toolName(ns,verb)> [--field …] [--json '{…}' \| -]` |
 * | a bespoke `SurfaceVerb` | `<name> …`, by the same rule over its `input` |
 * | cell exposed `"resource"` | `get <member> [--follow]` |
 * | stream / event exposed `"resource"` | `get <member> [input] [--follow]` |
 * | collection exposed `"resource"` | `get <member> <key> [--follow]` · `keys <member> [--follow]` · `watch <member>` |
 * | always | `list [--json]` — this face's `tools/list` |
 *
 * `--follow` turns a one-shot read into the subscription itself, one ndjson line
 * per frame, until the stream ends or the fiber is interrupted. Without it a
 * read takes the opening SNAPSHOT frame and stops — which is what every
 * snapshot-then-deltas member opens with, and `Stream.runHead`'s interruption IS
 * the unsubscribe. `watch` has no one-shot reading, so it takes no `--follow`.
 *
 * ## Two gates, as with MCP
 *
 * The SERVING face's `FaceExposure` decides what the server answers; this
 * `ExposeMap` decides what the CLI offers. Same arrangement `serveSurfaceAsMcp`
 * has with `restrictHandlers`, and the same reason: a client's table is
 * ergonomics, never security.
 */

import { isTransportError } from "@kolu/surface/client";
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
import { isDeadTransportError } from "@kolu/surface/errors";
import {
  classifyExpose,
  type ExposeEntry,
  type ExposeMap,
} from "@kolu/surface/expose";
import {
  firstFrameOfCollectionItem,
  firstFrameOrThrow,
  ITEM_READ_DEADLINE_MS,
} from "@kolu/surface/first-frame";
import {
  decodeTextValue,
  type SurfaceClientCallable,
  type SurfaceVerb,
  toInputSchema,
  toolName,
} from "@kolu/surface/verbs";
import { Effect, Option, Schema, Stdio, Stream } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
  EXIT,
  messageOf,
  refused,
  SurfaceCliFailure,
  unreachable,
  usage,
} from "./exit";
import { flagsOf, type InputProjection, SurfaceCliBuildError } from "./flags";
import { data, frame, json, out } from "./render";

/** A live connection this face owns for the length of ONE command.
 *
 *  `dispose` is REQUIRED, not optional: a CLI dials, does one thing and exits,
 *  and the one failure that costs a user something is a socket left open under a
 *  shell loop. An in-process host with nothing to release passes `() => {}` —
 *  which is a decision it makes out loud rather than an absence this face has to
 *  guess the meaning of. */
export interface SurfaceCliConnection {
  readonly client: SurfaceClientCallable;
  dispose: () => void | Promise<void>;
}

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
  /** Render the verb's output as text FOR A HUMAN. Applied only when stdout is a
   *  terminal; a pipe always receives JSON, so a script never has to remember a
   *  flag to get parseable output and `--json` on a verb keeps its one meaning
   *  (the whole input). */
  readonly render?: (output: unknown) => string;
}

export interface SurfaceCliOptions<S extends SurfaceSpec> {
  readonly surface: Surface<S>;
  /** Default-deny allowlist — the SAME map shape `serveSurfaceAsMcp` and the
   *  wire faces take (`@kolu/surface/expose`). */
  readonly expose: ExposeMap<S>;
  /** Hand-authored verbs — the SAME record handed to `serveSurfaceAsMcp` as
   *  `tools`, so the two faces offer one table under one set of names. */
  readonly verbs?: Record<string, SurfaceVerb>;
  /** The transport seam: app-owned, framework-blind. */
  readonly endpoint: EndpointSeam;
  /** CLI-only ergonomics, by verb name. */
  readonly annotate?: Record<string, VerbAnnotation>;
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
 *  here could guess it. */
export interface EndpointSeam {
  /** Flags every generated command carries — `--socket`, `--url`, `--host`. */
  // biome-ignore lint/suspicious/noExplicitAny: the host's flag types are the host's.
  readonly flags: Record<string, Flag.Flag<any>>;
  /** Read the flags, decide WHERE, and hand back both halves of the answer. */
  // biome-ignore lint/suspicious/noExplicitAny: the host's flag types are the host's.
  readonly resolve: (values: any) => ResolvedEndpoint;
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

/** The commands this face mounts that are NOT verbs. Declared once, because two
 *  readers of the fact exist and they must agree: the builders below mint them,
 *  and the verb-name collision check refuses a bespoke verb that would shadow
 *  one. */
const READER_NAMES = ["get", "keys", "watch", "list"] as const;

/** A runtime-assembled command. The tree is built from a spec walk, so its type
 *  parameters carry nothing a caller could trust — the host mounts the values
 *  and `Command.run` types the whole. */
export type ProjectedCommand = Command.Command<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: the parsed-input type of a runtime-built config.
  any,
  // biome-ignore lint/suspicious/noExplicitAny: the parent-context type the host decides.
  any,
  unknown,
  Stdio.Stdio
>;

/** Every command this face mounts, in the order a `--help` should list them:
 *  the verbs (alphabetical), then the readers, then `list`. */
export function surfaceCommands<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
): ReadonlyArray<ProjectedCommand> {
  const entries = classifyExpose(opts.surface.spec, opts.expose, "surface-cli");
  const verbs = callableVerbs(opts, entries);
  return [
    ...verbs.map((verb) => verbCommand(opts, verb)),
    ...readerCommands(opts, entries),
    listCommand(opts, verbs, entries),
  ];
}

// ── The verb half ────────────────────────────────────────────────────────

/** One callable verb, resolved: where it came from, what it takes, how it runs.
 *  Procedures and bespoke verbs differ in exactly two places — the dispatch, and
 *  whether the argument arrives encoded or decoded — so they are ONE shape with
 *  those two as fields rather than two parallel builders. */
interface CallableVerb {
  readonly name: string;
  readonly source: "procedure" | "bespoke";
  readonly mutates: boolean;
  readonly description?: string;
  readonly title?: string;
  readonly schema: WireSchemaAny | undefined;
  readonly projection: InputProjection;
  readonly annotation: VerbAnnotation;
  /** Place the call. Takes BOTH readings of the input, because a procedure's
   *  client ref decodes what it is handed while a bespoke handler wants the
   *  decoded args — and the CLI has both by then. */
  readonly call: (
    client: SurfaceClientCallable,
    encoded: unknown,
    decoded: unknown,
  ) => Effect.Effect<unknown, unknown>;
}

function callableVerbs<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
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
      // The conservative default the whole stack shares: an exposure that does
      // not explicitly say `mutates: false` is treated as mutating.
      mutates:
        typeof entry.exposure === "object"
          ? (entry.exposure.tool.mutates ?? true)
          : true,
      schema,
      projection: build(name, () =>
        flagsOf(schema, { positional: annotation.positional }),
      ),
      annotation,
      call: (client, encoded) => {
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
        return proc(schema === undefined ? undefined : encoded);
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
      // the MCP face. There is no signal to hand it: cancellation here IS fiber
      // interruption, and a handler that composes surface members inherits it.
      call: (client, _encoded, decoded) =>
        verb.handler(decoded, client, undefined),
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
  // Every annotation must name a verb that exists. A key that names nothing is
  // ergonomics its author asked for and silently did not get — the same class of
  // silence `positional` naming no field is already refused for.
  const stray = Object.keys(annotate).filter((name) => !seen.has(name));
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

function verbCommand<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  verb: CallableVerb,
): ProjectedCommand {
  return Command.make(
    verb.name,
    mergeConfig(opts, verb.name, verb.projection.config),
    (values: Record<string, unknown>) => runVerb(opts, verb, values),
  ).pipe(
    Command.withDescription(
      verb.mutates
        ? (verb.description ?? `Call ${verb.name}.`)
        : `${verb.description ?? `Call ${verb.name}.`} (read-only)`,
    ),
  ) as ProjectedCommand;
}

/** Merge the endpoint flags into a command's own config, refusing a collision.
 *
 *  A bare spread would let one silently overwrite the other — the later key
 *  wins, and a field the user can see on the sibling MCP face simply stops
 *  parsing here. So the collision is named at build, where an author can fix it.
 *  (Effect CLI independently refuses two params sharing a flag NAME; this covers
 *  the record KEY, which is the half a spread eats.) */
function mergeConfig<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  name: string,
  own: Command.Command.Config,
): Command.Command.Config {
  const clash = Object.keys(opts.endpoint.flags).filter((key) =>
    Object.hasOwn(own, key),
  );
  if (clash.length > 0) {
    throw new SurfaceCliBuildError(
      `surface-cli: "${name}" declares ${clash.map((c) => `"${c}"`).join(", ")}, which the endpoint flags also declare. Rename the endpoint flag, or the input field.`,
    );
  }
  return { ...own, ...opts.endpoint.flags };
}

function runVerb<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  verb: CallableVerb,
  values: Record<string, unknown>,
): Effect.Effect<void, unknown, Stdio.Stdio> {
  return Effect.gen(function* () {
    // Stdin is read ONLY for the command that asked for it (`--json -`), and
    // through the `Stdio` service every handler already requires — not off fd 0
    // synchronously inside what is otherwise a pure assembly. A verb that did
    // not ask never touches the descriptor, so nothing hangs waiting on a
    // terminal nobody typed into.
    const stdin = verb.projection.wantsStdin(values)
      ? yield* readStdin
      : undefined;
    const assembled = verb.projection.assemble(values, stdin);
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
      const result = Schema.decodeUnknownOption(verb.schema)(encoded);
      if (Option.isNone(result)) {
        return yield* Effect.fail(
          usage(
            opts.info.name,
            `${verb.name}: this input does not match what the verb declares — ${json(encoded, false)}`,
          ),
        );
      }
      decoded = result.value;
    }

    const output = yield* withConnection(opts, values, (client) =>
      verb.call(client, encoded, decoded),
    );
    yield* writeOutput(verb, output);
  });
}

/** Write a verb's answer: the author's renderer on a terminal, JSON otherwise.
 *
 *  A pipe ALWAYS gets JSON, which is why there is no flag to force it: a script
 *  never has to remember one, and `--json` on a verb keeps its single meaning
 *  (the whole input). A human on a TTY who wants the JSON pipes it. */
function writeOutput(
  verb: CallableVerb,
  output: unknown,
): Effect.Effect<void, never, Stdio.Stdio> {
  return Effect.gen(function* () {
    const render = verb.annotation.render;
    if (render === undefined) return yield* data(output);
    const tty = yield* (yield* Stdio.Stdio).stdoutIsTerminal;
    if (!tty) return yield* data(output);
    const text = render(output);
    yield* out(text.endsWith("\n") ? text : `${text}\n`);
  });
}

// ── The reader half ──────────────────────────────────────────────────────

/** An exposed primitive, resolved to what a reader needs in order to address
 *  it: which member verb to call, and what the `[arg]` position decodes against. */
interface Readable {
  readonly name: string;
  readonly kind: "cell" | "collection" | "stream" | "event";
  /** A collection's key schema, or a stream's/event's input schema — the one the
   *  `[arg]` position lands in. A cell has neither and takes no argument. */
  readonly argSchema?: WireSchemaAny;
  /** Does the collection declare `deltas`, so `watch` can address it? */
  readonly watchable: boolean;
  /** Does the collection declare `keys`? Read off the member's own verbs, not
   *  assumed: `keys` is a DEFAULT collection verb and a spec may drop it, and a
   *  bounded item read handed a membership stream that does not exist fails a
   *  read of an item that is right there. */
  readonly listable: boolean;
}

function readables(entries: readonly ExposeEntry[]): Map<string, Readable> {
  const table = new Map<string, Readable>();
  for (const entry of entries) {
    if (entry.kind === "procedure") continue;
    if (entry.kind === "collection") {
      const spec = entry.spec as CollectionSpec<unknown, unknown, unknown>;
      const verbs = resolveCollectionVerbs(spec);
      table.set(entry.key, {
        name: entry.key,
        kind: "collection",
        argSchema: spec.keySchema,
        watchable: collectionHasDeltas(spec),
        listable: verbs.includes("keys"),
      });
      continue;
    }
    table.set(entry.key, {
      name: entry.key,
      kind: entry.kind,
      argSchema:
        entry.kind === "cell"
          ? undefined
          : (entry.spec as { inputSchema: WireSchemaAny }).inputSchema,
      watchable: false,
      listable: false,
    });
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

function readerCommands<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  entries: readonly ExposeEntry[],
): ProjectedCommand[] {
  const table = readables(entries);
  if (table.size === 0) return [];
  const collections = [...table.values()].filter(
    (r) => r.kind === "collection",
  );
  const commands: ProjectedCommand[] = [];

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
        follow: followFlag,
      }),
      (values: Record<string, unknown>) => runGet(opts, table, values),
    ).pipe(
      Command.withDescription(
        "Read one exposed member — its current value, or (with --follow) its live subscription as ndjson.",
      ),
    ) as ProjectedCommand,
  );

  const listable = collections.filter((c) => c.listable);
  if (listable.length > 0) {
    commands.push(
      Command.make(
        "keys",
        mergeConfig(opts, "keys", {
          member: memberArgument(
            "collection",
            listable.map((c) => c.name),
          ),
          follow: followFlag,
        }),
        (values: Record<string, unknown>) => runKeys(opts, table, values),
      ).pipe(
        Command.withDescription(
          "List a collection's current key set — with --follow, every key set as it changes.",
        ),
      ) as ProjectedCommand,
    );
  }

  const watchable = collections.filter((c) => c.watchable);
  if (watchable.length > 0) {
    commands.push(
      Command.make(
        "watch",
        mergeConfig(opts, "watch", {
          member: memberArgument(
            "collection",
            watchable.map((c) => c.name),
          ),
        }),
        (values: Record<string, unknown>) => runWatch(opts, table, values),
      ).pipe(
        Command.withDescription(
          "Follow a collection: the whole set as one snapshot frame, then one ndjson line per batch of changes.",
        ),
      ) as ProjectedCommand,
    );
  }

  return commands;
}

/** Resolve the `<member>` argument, or say what IS addressable.
 *
 *  A name that reaches no member is a usage error, never an empty answer: an
 *  empty answer for a typo is the silent degradation this repo treats as a
 *  defect. */
function resolveMember<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
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

function runGet<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  table: Map<string, Readable>,
  values: Record<string, unknown>,
): Effect.Effect<void, unknown, Stdio.Stdio> {
  return Effect.gen(function* () {
    const member = yield* resolveMember(opts, table, values);
    const follow = values.follow === true;
    const raw = values.arg as string | undefined;

    if (member.kind === "cell") {
      if (raw !== undefined) {
        return yield* Effect.fail(
          usage(
            opts.info.name,
            `"${member.name}" is a cell — it holds one value and takes no argument.`,
          ),
        );
      }
      return yield* withConnection(opts, values, (client, dropped) =>
        readStream(
          memberStream(client, member.name, "get", undefined),
          follow,
          member.name,
          dropped,
        ),
      );
    }

    if (member.kind === "collection") {
      if (raw === undefined) {
        return yield* Effect.fail(
          usage(
            opts.info.name,
            `"${member.name}" is a collection — name the key to read, or use \`keys ${member.name}\` for the key set.`,
          ),
        );
      }
      const landed = decodeTextValue(member.argSchema as WireSchemaAny, raw);
      if (Option.isNone(landed)) {
        return yield* Effect.fail(
          usage(
            opts.info.name,
            `"${raw}" is not a key of "${member.name}" — it does not match the collection's declared key type.`,
          ),
        );
      }
      // A collection payload is built from DECODED keys (`client.ts`) — the
      // other half of the same landed token the stream arm takes encoded.
      const key = landed.value.decoded;
      return yield* withConnection(opts, values, (client, dropped) =>
        follow
          ? readStream(
              memberStream(client, member.name, "get", { key }),
              true,
              member.name,
              dropped,
            )
          : readCollectionItem(client, member, key, dropped),
      );
    }

    // An EVENT has no current value — it is occurrences over time, and its
    // handler yields nothing until one happens. A one-shot read of it therefore
    // waits forever, silently, which is the worst answer a command can give; so
    // it is refused HERE, in this face's own words, rather than hanging.
    if (member.kind === "event" && !follow) {
      return yield* Effect.fail(
        usage(
          opts.info.name,
          `"${member.name}" is an event — it has occurrences, not a current value, so there is nothing to read once. Use --follow to watch for them.`,
        ),
      );
    }

    // A stream or an event. Its input rides the same `[arg]` position, decoded
    // against the member's OWN schema — the argv twin of the collection key,
    // through the one text-to-schema rule both faces share.
    const schema = member.argSchema as WireSchemaAny;
    const input = yield* streamInput(opts, member.name, schema, raw);
    return yield* withConnection(opts, values, (client, dropped) =>
      readStream(
        memberStream(client, member.name, "get", input),
        follow,
        member.name,
        dropped,
      ),
    );
  });
}

/** What to call a stream's or event's `get` with: the decoded `[arg]`, or the
 *  no-argument value when the member's own schema admits one.
 *
 *  The admission test is the schema's, not a guess: `Schema.Void` (what a member
 *  with no declared input mints) decodes `undefined` and a struct does not — the
 *  same question `serveSurfaceAsMcp` asks before publishing a static resource. */
function streamInput<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  member: string,
  schema: WireSchemaAny,
  raw: string | undefined,
): Effect.Effect<unknown, SurfaceCliFailure> {
  if (raw === undefined) {
    return Option.isSome(Schema.decodeUnknownOption(schema)(undefined))
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

function runKeys<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  table: Map<string, Readable>,
  values: Record<string, unknown>,
): Effect.Effect<void, unknown, Stdio.Stdio> {
  return Effect.gen(function* () {
    const member = yield* resolveMember(
      opts,
      table,
      values,
      (r) => r.kind === "collection" && r.listable,
      "collection with a key set",
    );
    yield* withConnection(opts, values, (client, dropped) =>
      readStream(
        memberStream(client, member.name, "keys", undefined),
        values.follow === true,
        member.name,
        dropped,
      ),
    );
  });
}

function runWatch<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  table: Map<string, Readable>,
  values: Record<string, unknown>,
): Effect.Effect<void, unknown, Stdio.Stdio> {
  return Effect.gen(function* () {
    const member = yield* resolveMember(
      opts,
      table,
      values,
      (r) => r.kind === "collection" && r.watchable,
      "watchable collection",
    );
    // `watch` IS the subscription — there is no one-shot reading of a delta
    // stream, so it takes no `--follow` and always streams.
    yield* withConnection(opts, values, (client, dropped) =>
      readStream(
        memberStream(client, member.name, "deltas", undefined),
        true,
        member.name,
        dropped,
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
  dropped: (detail: string) => SurfaceCliFailure,
): Effect.Effect<void, unknown, Stdio.Stdio> {
  if (follow) return Stream.runForEach(stream, (value) => frame(value));
  return Effect.flatMap(
    // An empty open is a DROPPED LINK, not a refusal: every snapshot-then-deltas
    // member opens with its current value, so a member that opened and closed
    // saying nothing is the endpoint going away mid-read. `firstFrameOrThrow`
    // says so with a bare `Error`, which `classify` would otherwise read as the
    // verb's own answer and report as exit 1 — the one code that means the far
    // side spoke. It is worded as this face's exit-3 arm instead, beside the
    // failed dial it is the same event as.
    Effect.catch(
      firstFrameOrThrow(
        stream,
        `"${member}" opened and closed without a snapshot frame`,
      ),
      (error) => Effect.fail(dropped(messageOf(error))),
    ),
    (value) => data(value),
  );
}

/** The bounded one-shot read of a collection ITEM.
 *
 *  A collection `get` for a key that is not a member yet is a held-open
 *  subscription that yields nothing (juspay/kolu#1681), so a bare first-frame
 *  read would HANG on a missing key. `firstFrameOfCollectionItem` races the item
 *  against membership and a deadline; the two absences are reported apart,
 *  because "it is not there" and "I could not tell in time" are different
 *  answers and only the first is evidence. */
function readCollectionItem(
  client: SurfaceClientCallable,
  member: Readable,
  key: unknown,
  dropped: (detail: string) => SurfaceCliFailure,
): Effect.Effect<void, unknown, Stdio.Stdio> {
  return Effect.flatMap(
    Effect.catch(
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
        `"${member.name}" opened and closed without a snapshot frame`,
        ITEM_READ_DEADLINE_MS,
      ),
      // A PRESENT item that opened and said nothing is the link going away, the
      // same event as a failed dial — exit 3, not the verb's own refusal.
      (error) => Effect.fail(dropped(messageOf(error))),
    ),
    (found) =>
      found.present
        ? data(found.value)
        : data({ member: member.name, key, present: false, why: found.reason }),
  );
}

// ── `list` ───────────────────────────────────────────────────────────────

/** What `list` answers: every verb with the input it takes, and every readable
 *  member with its kind. The face's own `tools/list`, and it carries the SAME
 *  advertised input document the MCP face publishes — one description of one
 *  verb, whichever face you ask. */
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

function listCommand<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  verbs: readonly CallableVerb[],
  entries: readonly ExposeEntry[],
): ProjectedCommand {
  const table: ListTable = {
    verbs: verbs.map((verb) => ({
      name: verb.name,
      source: verb.source,
      mutates: verb.mutates,
      ...(verb.title === undefined ? {} : { title: verb.title }),
      ...(verb.description === undefined
        ? {}
        : { description: verb.description }),
      input: toInputSchema(verb.schema),
    })),
    resources: [...readables(entries).values()].map((readable) => ({
      name: readable.name,
      kind: readable.kind,
    })),
  };
  return Command.make(
    "list",
    // The endpoint flags ride `list` too, even though it dials nothing: every
    // other command takes them, and a script that loops over the verbs must not
    // break on the one that would refuse them. What it answers is THIS face's
    // projection, which is the same table whatever endpoint you point at — the
    // help line says so, so the flag is accepted rather than quietly promising
    // something it does not do.
    mergeConfig(opts, "list", {
      json: Flag.boolean("json").pipe(
        Flag.withDescription("emit the table as JSON instead of aligned text"),
        Flag.withDefault(false),
      ),
    }),
    (values: Record<string, unknown>) => runList(table, values.json === true),
  ).pipe(
    Command.withDescription(
      "List what this surface offers — every verb and every readable member. This face's tools/list, answered from the projection itself, so it dials nothing.",
    ),
  ) as ProjectedCommand;
}

function runList(
  table: ListTable,
  asJson: boolean,
): Effect.Effect<void, never, Stdio.Stdio> {
  return Effect.gen(function* () {
    if (asJson) return yield* data(table);
    // Text is for a HUMAN, so a pipe gets the JSON: `list | jq` must not have to
    // remember the flag, for the same reason a verb's answer is JSON in a pipe.
    const tty = yield* (yield* Stdio.Stdio).stdoutIsTerminal;
    if (!tty) return yield* data(table);
    const width = Math.max(
      0,
      ...table.verbs.map((verb) => verb.name.length),
      ...table.resources.map((resource) => resource.name.length),
    );
    const lines = [
      ...table.verbs.map((verb) =>
        `${verb.name.padEnd(width)}  ${verb.mutates ? "writes" : "reads "}  ${verb.description ?? ""}`.trimEnd(),
      ),
      ...table.resources.map((resource) =>
        `${resource.name.padEnd(width)}  ${resource.kind}`.trimEnd(),
      ),
    ];
    yield* out(`${lines.join("\n")}\n`);
  });
}

// ── The connection, for the length of one command ────────────────────────

/** Dial, run, release — in that order, whatever happens in the middle.
 *
 *  `acquireRelease` is what makes the release survive an INTERRUPTION: a Ctrl-C
 *  during `--follow` interrupts the fiber, the stream's own finalizers
 *  unsubscribe, and this closes the socket on the way out. A `try/finally`
 *  around a promise would not — there is no promise left to unwind.
 *
 *  A failed dial is exit 3 and names WHERE, because that is the fact a user can
 *  act on. */
function withConnection<S extends SurfaceSpec, A>(
  opts: SurfaceCliOptions<S>,
  values: Record<string, unknown>,
  use: (
    client: SurfaceClientCallable,
    /** This endpoint's exit-3 arm, pre-named — for a failure the USE discovers
     *  that is nonetheless about the endpoint (a read whose link dropped
     *  mid-snapshot), which only this function knows `where` for. */
    dropped: (detail: string) => SurfaceCliFailure,
  ) => Effect.Effect<A, unknown, Stdio.Stdio>,
): Effect.Effect<A, unknown, Stdio.Stdio> {
  const { where, open } = opts.endpoint.resolve(values);
  return Effect.scoped(
    Effect.flatMap(
      Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => await open(),
          catch: (cause) =>
            unreachable(opts.info.name, where, messageOf(cause)),
        }),
        // IGNORED, deliberately: a teardown that fails has nothing to add to a
        // command that already has its answer, and `Effect.promise` would turn a
        // rejected `dispose` into a DEFECT that replaces the verdict — a
        // successful capture reported as a crash because a socket close raced
        // the process. The socket is going away with the process either way.
        (connection) =>
          Effect.ignore(
            Effect.tryPromise({
              try: async () => await connection.dispose(),
              catch: (cause) => cause,
            }),
          ),
      ),
      (connection) =>
        Effect.catch(
          use(connection.client, (detail) =>
            unreachable(opts.info.name, where, detail),
          ),
          (error) => Effect.fail(classify(opts, where, error)),
        ),
    ),
  );
}

/** Which arm of the exit contract a failure lands on.
 *
 *  A failure this face already worded keeps its own verdict. A TRANSPORT failure
 *  is exit 3 — the endpoint stopped answering, which is not the verb's answer.
 *  Everything else is the verb's DECLARED error and rides out as exit 1, as
 *  JSON, because a refusal is data the caller acts on. */
function classify<S extends SurfaceSpec>(
  opts: SurfaceCliOptions<S>,
  where: string,
  error: unknown,
): unknown {
  if (isOwnFailure(error)) return error;
  if (isTransportError(error) || isDeadTransportError(error)) {
    return unreachable(opts.info.name, where, messageOf(error));
  }
  return refused(payloadOf(error));
}

/** Is this a failure this face already worded and gave a code to? Matched on the
 *  tag rather than by `instanceof`, so a value that crossed a module boundary is
 *  still recognised as its own verdict rather than re-classified as a refusal. */
function isOwnFailure(value: unknown): value is SurfaceCliFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly _tag?: unknown })._tag === "SurfaceCliFailure"
  );
}

/** A refusal's machine-readable body.
 *
 *  A tagged error is already data — carry it whole, so `_tag` and every field the
 *  raiser attached reach the caller. `message` is added only when the value does
 *  not carry one, because a `Data.TaggedError`'s own message is `""` and the
 *  sentence worth reading is in `_tag`. Anything JSON cannot render falls back to
 *  that one sentence rather than failing the write. */
function payloadOf(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    const own = { ...(error as Record<string, unknown>) };
    const tag = (error as { readonly _tag?: unknown })._tag;
    const body = {
      ...(typeof tag === "string" ? { _tag: tag } : {}),
      ...own,
      ...(typeof own.message === "string" && own.message !== ""
        ? {}
        : { message: messageOf(error) }),
    };
    try {
      JSON.stringify(body);
      return body;
    } catch {
      // A cycle, a BigInt, a throwing getter: the shape cannot travel, but the
      // sentence can — and a refusal that printed nothing would be worse.
    }
  }
  return { message: messageOf(error) };
}

/** The whole of stdin, as text — what `--json -` means.
 *
 *  Read through the `Stdio` service rather than off fd 0, for the reason
 *  `render.ts` writes through it: `Command.run` already requires it, so a
 *  handler that reads its own stdin stays inside the Effect that bounds it (a
 *  Ctrl-C mid-read interrupts the read) and a test can hand it a stream instead
 *  of a global descriptor.
 *
 *  A read that FAILS is not an empty payload. Collapsing the two reported "that
 *  is not JSON" for a descriptor that was never readable — blaming a payload
 *  nobody supplied — so the failure keeps its own words. */
const readStdin: Effect.Effect<string, SurfaceCliFailure, Stdio.Stdio> =
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    return yield* Effect.catch(
      Stream.decodeText(stdio.stdin).pipe(Stream.mkString),
      (cause) =>
        Effect.fail(
          new SurfaceCliFailure({
            stderr: `could not read stdin for --json -: ${messageOf(cause)}\n`,
            code: EXIT.usage,
          }),
        ),
    );
  });
