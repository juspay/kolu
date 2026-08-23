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
 * | procedure `ns.verb` exposed `"tool"` | `<toolName(ns,verb)> [--field …] [--json '{…}' \| -]` |
 * | a bespoke `SurfaceVerb` | `<name> …`, by the same rule over its `input` |
 * | cell exposed `"resource"` | `get <member> [--follow]` |
 * | stream / event exposed `"resource"` | `get <member> [input] [--follow]` |
 * | collection exposed `"resource"` | `get <member> <key> [--follow]` · `keys <member> [--follow]` · `watch <member>` |
 * | always | `list` — this face's `tools/list`. It takes **no `--json` of its own**: the aligned table on a terminal, JSON through a pipe, exactly like a verb with a renderer — so `--json` means ONE thing across the whole mounted set, the input |
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
import {
  classify,
  type SurfaceCliFailure,
  unreachable,
  unresolvable,
  usage,
} from "./exit";
import {
  flagsOf,
  type InputProjection,
  JSON_FLAG,
  SurfaceCliBuildError,
} from "./flags";
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
  /** Render the verb's output as text FOR A HUMAN. Applied only when stdout is a
   *  terminal; a pipe always receives JSON, so a script never has to remember a
   *  flag to get parseable output and `--json` on a verb keeps its one meaning
   *  (the whole input). */
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
  return [
    ...verbs.map((verb) => verbCommand(opts, verb)),
    ...readerCommands(opts, readable),
    listCommand(opts, verbs, readable),
  ];
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
      // the MCP face. There is no signal to hand it: cancellation here IS fiber
      // interruption, and a handler that composes surface members inherits it.
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
    mergeConfig(opts, verb.name, verb.projection.config),
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
): Command.Command.Config {
  const endpoint = opts.endpoint.flags ?? {};
  const clash = Object.keys(endpoint).filter((key) => Object.hasOwn(own, key));
  if (clash.length > 0) {
    throw new SurfaceCliBuildError(
      `surface-cli: "${name}" declares ${clash.map((c) => `"${c}"`).join(", ")}, which the endpoint flags also declare. Rename the endpoint flag, or the input field.`,
    );
  }
  return { ...own, ...endpoint };
}

function runVerb<S extends SurfaceSpec, F extends FlagRecord, R>(
  opts: SurfaceCliOptions<S, F, R>,
  verb: CallableVerb,
  values: Record<string, unknown>,
): Effect.Effect<void, unknown, Stdio.Stdio | R> {
  return Effect.gen(function* () {
    // Stdin is DESCRIBED here and read only by the one path that wants it
    // (`--json -`), inside `assemble` — not off fd 0 synchronously, and not on a
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
            `could not read stdin for --${JSON_FLAG} -: ${unreadable.why}`,
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
    // The author's renderer on a terminal, the JSON data through a pipe —
    // `io.ts` owns that branch, so this file never asks what stdout is.
    yield* present(output, verb.annotation.render);
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
    switch (entry.kind) {
      case "procedure":
        break;
      case "cell":
        table.set(entry.key, { kind: "cell", name: entry.key });
        break;
      case "collection": {
        const spec = entry.spec as CollectionSpec<unknown, unknown, unknown>;
        table.set(entry.key, {
          kind: "collection",
          name: entry.key,
          keySchema: spec.keySchema,
          watchable: collectionHasDeltas(spec),
          listable: resolveCollectionVerbs(spec).includes("keys"),
        });
        break;
      }
      case "stream":
      case "event":
        table.set(entry.key, {
          kind: entry.kind,
          name: entry.key,
          inputSchema: entry.spec.inputSchema,
        });
        break;
      default:
        // Exhaustiveness fence — the same one the MCP face's walk has, in the
        // spelling this package can afford (no `ts-pattern` dependency): a fifth
        // `ExposeEntry` kind stops this compiling and gets a decision HERE,
        // rather than being quietly mounted as a stream by a trailing `else`.
        entry satisfies never;
    }
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
        follow: followFlag,
      }),
      (values: Record<string, unknown>) => runGet(opts, table, values),
    ).pipe(
      Command.withDescription(
        "Read one exposed member — its current value, or (with --follow) its live subscription as ndjson.",
      ),
    ) as ProjectedCommand<Stdio.Stdio | R>,
  );

  // Mounted only where the surface has something for them to address: a `keys`
  // over no listable collection is a command whose every invocation is a usage
  // error.
  for (const reader of COLLECTION_READERS) {
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
          ...(reader.always ? {} : { follow: followFlag }),
        }),
        (values: Record<string, unknown>) =>
          runCollectionRead(opts, table, values, reader),
      ).pipe(Command.withDescription(reader.description)) as ProjectedCommand<
        Stdio.Stdio | R
      >,
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
  if (member.kind === "cell") {
    return raw === undefined
      ? Effect.succeed(undefined)
      : Effect.fail(
          usage(
            opts.info.name,
            `"${member.name}" is a cell — it holds one value and takes no argument.`,
          ),
        );
  }

  // Reached only under `--follow` — the bounded one-shot read above took the
  // other reading — but the KEY is the same key, decoded by the same rule.
  if (member.kind === "collection") {
    return Effect.map(collectionKey(opts, member, raw), (key) => ({ key }));
  }

  // An EVENT has no current value — it is occurrences over time, and its
  // handler yields nothing until one happens. A one-shot read of it therefore
  // waits forever, silently, which is the worst answer a command can give; so
  // it is refused HERE, in this face's own words, rather than hanging.
  if (member.kind === "event" && !follow) {
    return Effect.fail(
      usage(
        opts.info.name,
        `"${member.name}" is an event — it has occurrences, not a current value, so there is nothing to read once. Use --follow to watch for them.`,
      ),
    );
  }

  // A stream or an event. Its input rides the same `[arg]` position, decoded
  // against the member's OWN schema — the argv twin of the collection key,
  // through the one text-to-schema rule both faces share. No cast: the two arms
  // above narrowed `kind`, so this one HAS an `inputSchema`.
  return streamInput(opts, member.name, member.inputSchema, raw);
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
        input: advertised.inner ?? advertised.schema,
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
    // And it takes NO `--json` of its own. It had one — a switch forcing the
    // data frame — which made `--json` mean two things across one mounted set:
    // the whole INPUT on every verb, an OUTPUT FORMAT here. `list` needs no
    // second mechanism, because it already has the one every verb with a
    // renderer has: text for a human on a terminal, JSON through a pipe. So
    // `list | jq` is JSON without a flag to remember, `list` on a terminal is
    // the aligned table, and a human who wants the JSON in front of them pipes
    // it — the same price a verb's renderer already charges, now charged once.
    mergeConfig(opts, "list", {}),
    // A THUNK, so the table is built by the one command that writes it.
    () => runList(listTable(verbs, readable)),
  ).pipe(
    Command.withDescription(
      "List what this surface offers — every verb and every readable member. This face's tools/list, answered from the projection itself, so it dials nothing.",
    ),
  ) as ProjectedCommand<Stdio.Stdio | R>;
}

/** `list` answers with exactly the discipline every verb does: the aligned table
 *  for a human on a terminal, the JSON through a pipe — the ONE branch, in
 *  `io.ts`, rather than a second mechanism this command reinvents or a flag that
 *  would be a second meaning for a name a verb already spends. */
function runList(table: ListTable): Effect.Effect<void, never, Stdio.Stdio> {
  return present(table, alignedTable);
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
          Effect.tryPromise({
            try: async () => await open(),
            catch: (cause) =>
              unreachable(opts.info.name, where, messageOf(cause)),
          }),
          // IGNORED, deliberately: a teardown that fails has nothing to add to a
          // command that already has its answer, and `Effect.promise` would turn
          // a rejected `dispose` into a DEFECT that replaces the verdict — a
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
          Effect.catch(use(connection.client, where), (error) =>
            Effect.fail(classify(opts.info.name, where, error)),
          ),
      ),
    ),
  );
}
