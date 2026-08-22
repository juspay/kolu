/**
 * The ARGV GRAMMAR — one verb's declared input, projected onto flags,
 * positionals, and the `--json` escape hatch.
 *
 * The projection is driven by the verb's **advertised input schema**
 * (`inputSchema`, `@kolu/surface/verbs`), not by a second walk of the Effect
 * AST. That is the whole reason the bridge moved down: the MCP face advertises
 * the same document to a host's tool list, so a field that is a `--flag` here is
 * the same field with the same type there, and neither face can drift from the
 * other's idea of what the verb takes. It is also already normalised —
 * dereferenced, opened, numeric-collapsed, top-level object enforced — which is
 * exactly the shape a flag table wants.
 *
 * What comes out is the ENCODED input, never the decoded one. The advertised
 * document describes the encoded side, `Flag.integer` hands back the number a
 * `Schema.Int` encodes to, and a surface procedure's own client ref decodes what
 * it is given. So the CLI assembles encoded, VALIDATES by decoding once (so a
 * typo is a local usage error from the same taxonomy the server would have
 * used), and forwards the encoded value — a bespoke verb, whose handler takes
 * the decoded args, gets the decoded one instead. One assembly, two
 * destinations.
 *
 * ## The rules, one per JSON-Schema shape
 *
 * | property | argv |
 * | --- | --- |
 * | `string` | `--name <text>` (an `enum` becomes a choice, so `--help` lists the values) |
 * | `integer` / `number` | `--name <n>` |
 * | `boolean` | `--name` / `--no-name` — a TRISTATE, so "I did not say" and "I said false" stay different states |
 * | array of scalars | `--name <v>` repeated |
 * | `Record<string, string>` (an open object with no properties) | `--name k=v` repeated |
 * | anything deeper | `--name '<json>'` — the field's own JSON, parsed and validated by the verb's schema |
 * | a non-object input (`wrapped`) | the bare `<value>` positional |
 *
 * ## Every param is OPTIONAL to the PARSER, and that is load-bearing
 *
 * `--json` carries the WHOLE input as an alternative to the field flags. A
 * required field projected as a parser-required param makes that unspellable:
 * Effect CLI refuses the command before {@link InputProjection.assemble} — the
 * only code that can see `--json` was given — ever runs, so the escape hatch is
 * a dead branch on every verb that declares a required field, which is most of
 * them. So requiredness is enforced ONE layer up, where both inputs are in view:
 * `assemble` names a missing required field itself, in this face's own words and
 * on this face's own exit code, and only when `--json` is absent.
 *
 * What that costs, and what is done about it: the LIBRARY can no longer render
 * "Missing required flag: --pid", and `--help` can no longer mark the param
 * required from its own shape. Both are paid back in the same place they were
 * spent — the refusal is worded here (naming the verb, the field, and the
 * `--json` alternative), and a required field's help line says `(required)`.
 *
 * A property carrying a `default` is likewise NOT given to the parser as a
 * default: `Flag.withDefault` makes a field the caller never typed
 * indistinguishable from one they did, which turned "`--json` cannot be combined
 * with the field flags" into a refusal citing a flag nobody passed. The default
 * is applied HERE, in the non-`--json` branch, and shown in the help line.
 *
 * ## Names are NOT transformed
 *
 * The flag is the field, spelled the same: `--filePath`, not `--file-path`. A
 * transformation would be a second name for one thing — the user would have to
 * know both to read a `--json` payload beside a flag — and it is not reversible
 * for every field name. A field whose name cannot be a flag at all is refused
 * at BUILD time, naming the field, rather than producing a command nobody can
 * type.
 */

import type { WireSchemaAny } from "@kolu/surface/define";
import { inputSchema } from "@kolu/surface/verbs";
import { Effect, Option } from "effect";
import { Argument, Flag } from "effect/unstable/cli";

/** A JSON-Schema node, walked structurally. */
type JsonSchema = Record<string, unknown>;

/** Anything `Command.make`'s config record accepts at a key. */
// biome-ignore lint/suspicious/noExplicitAny: a runtime-built config is loose by construction — see `surfaceCommands`.
type Param = Flag.Flag<any> | Argument.Argument<any>;

/** The name of the whole-input escape hatch. A verb whose input declares a
 *  field spelled the same is refused at build (see {@link projectInput}) rather
 *  than shipping a command with two meanings for one flag. */
export const JSON_FLAG = "json";

/** One assembly's answer: the verb's ENCODED input, or the sentence to refuse
 *  with. A SENTENCE and never a thrown value, because every way this can go
 *  wrong is a usage error the caller turns into exit 2, and the caller is the
 *  one that knows the binary's name to put in front of it. */
export type Assembled =
  | { ok: true; input: unknown }
  | { ok: false; because: string };

/** What a verb's input projects to: the config `Command.make` takes, and the
 *  assembler that reads a parsed config back into one encoded input value. */
export interface InputProjection {
  /** Flags and positionals, keyed as `Command.make`'s config wants them. */
  readonly config: Record<string, Param>;
  /** Read the parsed config back into the verb's ENCODED input.
   *
   *  `stdin` is DESCRIBED, not read: it is an Effect, and it is yielded only on
   *  the `--json -` path — so a verb that did not ask never touches the
   *  descriptor and nothing hangs waiting on a terminal nobody typed into. An
   *  Effect is not a thunk; it is a description, so `assemble` stays a pure
   *  function from values to a value while "read it only if it was asked for"
   *  becomes structural rather than an ordering rule the caller has to remember.
   *
   *  That rule used to be a two-step protocol — ask `wantsStdin`, then hand over
   *  the text — with a whole failure arm reading "the host did not ask this
   *  projection whether it wanted it" to reconcile a caller that forgot. The
   *  reconciliation machinery was the bug, not the fix. */
  readonly assemble: <E, R>(
    values: Record<string, unknown>,
    stdin: Effect.Effect<string, E, R>,
  ) => Effect.Effect<Assembled, E, R>;
}

/** A flag name a shell and Effect CLI can both carry. Deliberately strict: a
 *  field named with a space, a leading dash, or an `=` produces a flag nobody
 *  can type, and finding that out at parse time (or never) is worse than a loud
 *  refusal when the command tree is built. */
const NAMEABLE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The build-time refusal — a plain `Error`, because a malformed command tree
 *  is the AUTHOR's mistake and there is no CLI to exit from yet. */
export class SurfaceCliBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurfaceCliBuildError";
  }
}

/** Does this node describe one scalar? The predicate the flag/positional rules
 *  and the array rule both branch on, so "scalar" means one thing here. */
function scalarKind(
  node: JsonSchema,
): "string" | "integer" | "number" | "boolean" | undefined {
  const type = node.type;
  if (type === "string") return "string";
  if (type === "integer") return "integer";
  if (type === "number") return "number";
  if (type === "boolean") return "boolean";
  return undefined;
}

/** The declared `enum` of a string node, when it has one — `Schema.Literals`
 *  arrives this way, and a choice flag lists the values in `--help` instead of
 *  letting a typo through to the server. */
function stringChoices(node: JsonSchema): readonly string[] | undefined {
  const values = node.enum;
  if (!Array.isArray(values) || values.length === 0) return undefined;
  return values.every((v) => typeof v === "string")
    ? (values as string[])
    : undefined;
}

/** An open object with no declared properties — `Record<string, string>`, the
 *  shape a repeatable `--name k=v` is for. Narrow on purpose: a record of
 *  anything else cannot be spelled as `k=v`, so it takes the JSON route. */
function isStringRecord(node: JsonSchema): boolean {
  if (node.type !== "object") return false;
  const props = node.properties;
  if (props !== undefined && Object.keys(props as JsonSchema).length > 0)
    return false;
  const additional = node.additionalProperties;
  return (
    additional !== undefined &&
    typeof additional === "object" &&
    additional !== null &&
    (additional as JsonSchema).type === "string"
  );
}

/** A JSON-valued flag: the field's own JSON, handed on encoded. The verb's
 *  schema is what validates it — this only insists it IS JSON, so a shell
 *  quoting slip is named as one rather than reaching the server as a string. */
// biome-ignore lint/suspicious/noExplicitAny: the parsed value's type is the field's, unknown here.
function jsonFlag(name: string): Flag.Flag<any> {
  return Flag.string(name).pipe(
    Flag.mapTryCatch(
      (text: string) => JSON.parse(text) as unknown,
      () =>
        `--${name} takes this field's own JSON, and that value is not JSON.`,
    ),
  );
}

/** One property → one flag, by the table in the header. */
// biome-ignore lint/suspicious/noExplicitAny: each branch's value type is the field's.
function flagFor(name: string, node: JsonSchema): Flag.Flag<any> {
  const choices = node.type === "string" ? stringChoices(node) : undefined;
  if (choices !== undefined) return Flag.choice(name, choices);
  switch (scalarKind(node)) {
    case "string":
      return Flag.string(name);
    case "integer":
      return Flag.integer(name);
    case "number":
      return Flag.float(name);
    case "boolean":
      return Flag.boolean(name);
    default:
      break;
  }
  if (node.type === "array") {
    const items = node.items;
    const itemNode =
      items !== null && typeof items === "object" ? (items as JsonSchema) : {};
    if (scalarKind(itemNode) !== undefined) {
      // `atLeast(1)`, never `atLeast(0)`: a variadic with `min: 0` SUCCEEDS with
      // `[]` when the flag never appears, so the enclosing `Flag.optional` sees
      // `Some([])` and the field reaches the server as an explicit empty array —
      // where `Schema.optionalKey` means absent — while `assemble` counts it as
      // supplied and refuses a `--json` beside a flag nobody typed. With
      // `atLeast(1)` an absent flag is genuinely absent, and one occurrence is
      // still enough.
      return flagFor(name, itemNode).pipe(Flag.atLeast(1));
    }
    return jsonFlag(name);
  }
  if (isStringRecord(node)) return Flag.keyValuePair(name);
  return jsonFlag(name);
}

/** One property → one positional. No array and no `k=v` arm: a repeatable
 *  argv POSITION is not a thing a reader can count, so a field that wants
 *  repetition stays a flag and `annotate.positional` naming one is refused. */
// biome-ignore lint/suspicious/noExplicitAny: each branch's value type is the field's.
function argumentFor(name: string, node: JsonSchema): Argument.Argument<any> {
  const choices = node.type === "string" ? stringChoices(node) : undefined;
  if (choices !== undefined) return Argument.choice(name, choices);
  switch (scalarKind(node)) {
    case "string":
      return Argument.string(name);
    case "integer":
      return Argument.integer(name);
    case "number":
      return Argument.float(name);
    case "boolean":
      // A boolean positional would be `verb true`, which reads as nothing.
      throw new SurfaceCliBuildError(
        `"${name}" is a boolean and cannot be a positional argument — a bare "true" on the command line names nothing. Leave it a flag.`,
      );
    default:
      throw new SurfaceCliBuildError(
        `"${name}" is not a scalar, so it cannot be a positional argument. Leave it a flag, or pass the whole input with --${JSON_FLAG}.`,
      );
  }
}

/** Project one verb's declared input onto argv.
 *
 *  `positional` names input FIELDS to bind to argv positions, in the order
 *  given — `capture "look into the cabinets"` rather than `capture --title …`.
 *  A name that is not a field of this input is refused at build: silently
 *  ignoring it would leave the ergonomics its author asked for quietly absent.
 *
 *  A `wrapped` input (a scalar, an array, a union — anything the wire carries
 *  under one property) has no fields to name, so it becomes the bare `<value>`
 *  positional and `positional` is refused as meaningless for it. */
export function flagsOf(
  schema: WireSchemaAny | undefined,
  opts?: { readonly positional?: readonly string[] },
): InputProjection {
  return projectInput(schema, opts?.positional ?? []);
}

function projectInput(
  schema: WireSchemaAny | undefined,
  positional: readonly string[],
): InputProjection {
  const built = inputSchema(schema);
  const doc = built.schema as JsonSchema;
  const config: Record<string, Param> = {};

  // The escape hatch is on EVERY verb, including one with no input at all: a
  // caller scripting against the surface should never have to know whether this
  // particular verb happens to take fields.
  config[JSON_FLAG] = optionalFlag(
    Flag.string(JSON_FLAG).pipe(
      Flag.withDescription(
        "the whole input as JSON (`-` reads it from stdin) — the alternative to the field flags, never a supplement to them",
      ),
    ),
  );

  if (built.wrapped) {
    if (positional.length > 0) {
      throw new SurfaceCliBuildError(
        `this verb's input is a single value, so it has no fields to bind to positions; drop the "positional" annotation (it named ${positional.map((p) => `"${p}"`).join(", ")}).`,
      );
    }
    // The wrapped value's OWN node, from the bridge — this face never names the
    // property the wire carries it under, which is why that key is private.
    const inner = built.inner ?? {};
    config.value = optionalArgument(
      argumentFor("value", inner).pipe(
        Argument.withDescription("the verb's input"),
      ),
    );
    return {
      config,
      assemble: (values, stdin) =>
        Effect.map(readJsonFlag(values, stdin), (fromJson): Assembled => {
          if (fromJson.kind === "bad")
            return { ok: false, because: fromJson.why };
          const bare = values.value;
          if (fromJson.kind === "given") {
            return bare === undefined
              ? { ok: true, input: fromJson.value }
              : {
                  ok: false,
                  because: `--${JSON_FLAG} carries the whole input, so it cannot be combined with the <value> argument — pass one or the other.`,
                };
          }
          return bare === undefined
            ? {
                ok: false,
                because: `this verb takes one value — pass it as the argument, or the whole input with --${JSON_FLAG}.`,
              }
            : { ok: true, input: bare };
        }),
    };
  }

  const properties = (doc.properties ?? {}) as JsonSchema;
  const required = new Set(
    Array.isArray(doc.required) ? (doc.required as string[]) : [],
  );
  const asPositional = new Set(positional);
  for (const name of positional) {
    if (!Object.hasOwn(properties, name)) {
      throw new SurfaceCliBuildError(
        `"positional" names "${name}", which this verb's input does not declare (it declares ${
          Object.keys(properties)
            .map((k) => `"${k}"`)
            .join(", ") || "no fields"
        }).`,
      );
    }
  }

  const fields = Object.keys(properties);
  for (const name of fields) {
    if (name === JSON_FLAG) {
      throw new SurfaceCliBuildError(
        `this verb's input declares a field named "${JSON_FLAG}", which collides with the whole-input escape hatch --${JSON_FLAG}. Rename the field.`,
      );
    }
    if (!NAMEABLE.test(name)) {
      throw new SurfaceCliBuildError(
        `this verb's input declares a field named "${name}", which cannot be spelled as a command-line name.`,
      );
    }
  }

  // A field's DEFAULT, captured rather than handed to the parser — see the
  // header. Applied in the non-`--json` branch of `assemble`, so "the caller did
  // not say" survives as a state the assembler can still see.
  const defaults = new Map<string, unknown>();
  for (const name of fields) {
    const fallback = (properties[name] as JsonSchema | undefined)?.default;
    if (fallback !== undefined) defaults.set(name, fallback);
  }

  // Positionals in the order the annotation gave them, then the flags. Effect
  // CLI reads positions in config order, so this order IS the argv order. Both
  // arms are OPTIONAL to the parser; requiredness is `assemble`'s (see header).
  for (const name of positional) {
    const node = (properties[name] ?? {}) as JsonSchema;
    config[name] = optionalArgument(
      describe(argumentFor(name, node), node, required.has(name), defaults),
    );
  }
  for (const name of fields) {
    if (asPositional.has(name)) continue;
    const node = (properties[name] ?? {}) as JsonSchema;
    config[name] = optionalFlag(
      describe(
        flagFor(name, node),
        node,
        required.has(name),
        defaults.get(name),
      ),
    );
  }

  /** Which fields did the CALLER actually name? Read off `undefined`, which is
   *  honest here precisely because nothing in this projection can produce one:
   *  no parser default, and an absent repeated flag is `None` rather than `[]`. */
  const suppliedIn = (values: Record<string, unknown>): string[] =>
    [...positional, ...fields.filter((name) => !asPositional.has(name))].filter(
      (name) => values[name] !== undefined,
    );

  return {
    config,
    assemble: (values, stdin) =>
      Effect.map(readJsonFlag(values, stdin), (fromJson): Assembled => {
        if (fromJson.kind === "bad")
          return { ok: false, because: fromJson.why };
        const supplied = suppliedIn(values);
        if (fromJson.kind === "given") {
          return supplied.length === 0
            ? { ok: true, input: fromJson.value }
            : {
                ok: false,
                because: `--${JSON_FLAG} carries the whole input, so it cannot be combined with ${supplied.map((n) => `"${n}"`).join(", ")} — pass one or the other.`,
              };
        }
        const input: Record<string, unknown> = {};
        for (const name of supplied) input[name] = values[name];
        for (const [name, fallback] of defaults) {
          if (input[name] === undefined) input[name] = fallback;
        }
        // Requiredness, enforced HERE because this is the only layer that can
        // see that `--json` was not the answer. The parser cannot: it would have
        // to refuse before knowing.
        const missing = [...required].filter(
          (name) =>
            input[name] === undefined && Object.hasOwn(properties, name),
        );
        if (missing.length > 0) {
          return {
            ok: false,
            because: `this verb needs ${missing.map((n) => `"${n}"`).join(", ")} — pass ${missing.length === 1 ? "it" : "them"}, or the whole input with --${JSON_FLAG}.`,
          };
        }
        return { ok: true, input };
      }),
  };
}

/** One reading of `--json`. Three answers, because "absent" and "present but
 *  unreadable" must not collapse into one. */
type JsonFlag =
  | { kind: "absent" }
  | { kind: "given"; value: unknown }
  | { kind: "bad"; why: string };

/** Read `--json`, resolving `-` by RUNNING the stdin description — and only
 *  then. The descriptor is touched on this one path and no other, which is what
 *  makes "a verb that did not ask never waits on a terminal" a property of the
 *  code rather than of a caller remembering to ask first. */
function readJsonFlag<E, R>(
  values: Record<string, unknown>,
  stdin: Effect.Effect<string, E, R>,
): Effect.Effect<JsonFlag, E, R> {
  const raw = values[JSON_FLAG];
  if (raw === undefined) return Effect.succeed({ kind: "absent" });
  const fromStdin = raw === "-";
  return Effect.map(
    fromStdin ? stdin : Effect.succeed(String(raw)),
    (text): JsonFlag => {
      try {
        return { kind: "given", value: JSON.parse(text) as unknown };
      } catch (err) {
        return {
          kind: "bad",
          why: `--${JSON_FLAG} takes the whole input as JSON${fromStdin ? " on stdin" : ""}, and that is not JSON: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  );
}

/** The help line for one field: the schema author's own `description`, plus the
 *  two facts the PARSER no longer carries.
 *
 *  Both matter because every param here is parser-optional (see the header): the
 *  library can no longer mark a required field, and it never sees the default at
 *  all — so a reader would learn neither from `--help` unless the line says so. */
function describe<P extends Param>(
  param: P,
  node: JsonSchema,
  isRequired: boolean,
  fallback: unknown,
): P {
  const written = node.description;
  const parts = [
    ...(typeof written === "string" && written !== "" ? [written] : []),
    ...(isRequired ? ["(required)"] : []),
    ...(fallback === undefined
      ? []
      : [`(default: ${JSON.stringify(fallback)})`]),
  ];
  if (parts.length === 0) return param;
  const text = parts.join(" ");
  return (
    param.kind === "flag"
      ? // biome-ignore lint/suspicious/noExplicitAny: the param's value type is the field's.
        Flag.withDescription(param as Flag.Flag<any>, text)
      : // biome-ignore lint/suspicious/noExplicitAny: the param's value type is the field's.
        Argument.withDescription(param as Argument.Argument<any>, text)
  ) as P;
}

/** An omittable flag, projected to `undefined` rather than `Option`.
 *
 *  `Option` is the PARSER's vocabulary; the assembler's is "the caller did not
 *  say", and an assembled input must OMIT such a field rather than carry an
 *  explicit `undefined` (which a `Schema.optionalKey` field encodes
 *  differently). Spelled once here so no branch above can forget the narrowing. */
// biome-ignore lint/suspicious/noExplicitAny: the flag's value type is the field's.
const optionalFlag = (flag: Flag.Flag<any>): Flag.Flag<any> =>
  flag.pipe(Flag.optional, Flag.map(Option.getOrUndefined));

/** The same projection for an omittable POSITIONAL. */
const optionalArgument = (
  // biome-ignore lint/suspicious/noExplicitAny: the argument's value type is the field's.
  arg: Argument.Argument<any>,
  // biome-ignore lint/suspicious/noExplicitAny: the argument's value type is the field's.
): Argument.Argument<any> =>
  arg.pipe(Argument.optional, Argument.map(Option.getOrUndefined));
