import type {
  CreateElicitationRequest,
  ElicitationPropertySchema,
  ElicitationSchema,
  EnumOption,
  PermissionOption,
  RequestPermissionRequest,
} from "@agentclientprotocol/sdk";

import {
  type AskAnswer,
  type AskChoice,
  type AskField,
  type AskLink,
  YES_NO,
} from "./wire.ts";

/**
 * A payload this vocabulary cannot say — the one word this package refuses in.
 *
 * A plain class rather than a schema, because it never travels a wire and
 * never rides an Effect channel: it is returned as a value, told apart with
 * `instanceof`, and carries the sentence a person reads. The DOMAIN'S refusal
 * word (`UsageFailure`) is minted from it at the boundary, by the caller —
 * never here, which is the whole seam.
 */
export class Refused {
  // A plain field and an explicit assignment, NOT a `readonly` constructor
  // parameter property: a parameter property is the one TypeScript form that
  // ERASING type-strippers refuse outright — node's own
  // `--experimental-strip-types`, which is how this tree spawns a bare `.ts`
  // file, emits an error rather than code. This package is vendored into other
  // repos as raw TypeScript, so "which runtimes can load it" is part of its
  // contract and not a style question.
  readonly reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
}

/** A form to put in front of a person: what the agent said it needs, the
 *  fields to fill in, and which tool call it is about. */
export interface Form {
  readonly message: string;
  readonly fields: ReadonlyArray<AskField>;
  /**
   * The tool call this question was asked FROM, or `null` for one that names
   * none.
   *
   * The protocol carries it on both ways in ({@link formOf}'s `toolCallId`,
   * {@link permissionFormOf}'s `toolCall.toolCallId`), and it is the one thing
   * a form says about its own provenance — which is what a client needs to say
   * WHO is asking. That answer is not here and cannot be: which agent a call
   * belongs to is an agent-specific `_meta` reading, and this package speaks
   * ACP and nothing else. What it can honestly answer is the call, so it does,
   * and the caller joins that to whatever it knows about calls.
   *
   * `null` rather than absent because a form always has the question — an
   * elicitation scoped to a request rather than a session names no call, and
   * that is a fact about the form rather than a field somebody forgot.
   */
  readonly toolCall: string | null;
  /**
   * WHERE THE AGENT SENT THE PERSON, for the one elicitation that asks for no
   * fields at all — ACP's `mode: "url"` ({@link urlOf}), or `null` for every
   * question that is a thing to fill in.
   *
   * A field rather than a third arm of some union, because the two are not two
   * kinds of question: a URL elicitation has an EMPTY form and one fact beside
   * it, and what draws it is the same row the form draws with the fields left
   * out. A union would make every reader of this answer a `switch` about
   * something that only changes which part of the row is worth reading.
   */
  readonly link: AskLink | null;
}

const CUSTOM_ANSWER = "_askUserQuestionCustomAnswer";

/** A form elicitation, as a form. */
export const formOf = (request: CreateElicitationRequest): Form | Refused => {
  if (request.mode !== "form") {
    return new Refused(
      `the agent asked for a \`${request.mode}\` elicitation, which this panel does not draw`,
    );
  }
  const fields = fieldsOf(
    (request as { requestedSchema?: ElicitationSchema }).requestedSchema,
  );
  return fields instanceof Refused
    ? fields
    : {
        message: request.message,
        fields,
        toolCall: toolCallOf(request),
        link: null,
      };
};

/**
 * A URL elicitation, as the same row a form is — with no fields and a place to
 * go instead.
 *
 * THE OTHER MODE, and the reason it is a reader beside {@link formOf} rather
 * than an arm inside it: what this returns is not an undrawable form. The
 * reader above refuses a mode it does not know, and that refusal was the whole
 * of how a URL elicitation was handled until this existed — a person was never
 * shown the page the agent had sent them to, and the login that needed it
 * could not be finished from inside kolu at all. So the two modes get one
 * answer each and the caller asks which by `mode`, which is the protocol's own
 * discriminator and the only thing that tells them apart.
 *
 * A URL THIS END CANNOT PARSE is carried through whole rather than refused, and
 * that is a decision rather than leniency: the panel's job here is to hand a
 * person a link and to NAME the machine it goes to ({@link hostOf}), and
 * refusing would leave the one case where somebody most needs to look at the
 * string they were given with nothing on screen at all. The agent put it there;
 * the row shows it.
 */
export const urlOf = (request: CreateElicitationRequest): Form | Refused => {
  if (request.mode !== "url") {
    return new Refused(
      `the agent sent a \`${request.mode}\` elicitation, which names no place to go`,
    );
  }
  const url = urlIn(request);
  if (url === null) {
    return new Refused("the agent sent a URL elicitation with nothing to open");
  }
  return {
    message: request.message,
    fields: [],
    toolCall: toolCallOf(request),
    link: { url, host: hostOf(url) },
  };
};

const urlIn = (request: CreateElicitationRequest): string | null => {
  if (!("url" in request)) return null;
  const url = request.url;
  return typeof url === "string" && url !== "" ? url : null;
};

/**
 * Which machine a link goes to, for the line beside it.
 *
 * The HOST rather than the whole URL, because that is the fact the card exists
 * to put in front of a person: what a link asks of them is that they hand
 * something to whoever is on the other end, and `github.com` is that answer
 * while a two-hundred-character callback URL is not. The port rides along where
 * there is one (`localhost:1455`), since a sign-in to a loopback page is a
 * different sentence from one to a vendor.
 *
 * An UNPARSEABLE URL comes back whole, which is the honest failure: the string
 * the agent sent is what a person can act on, and inventing a host out of it
 * would be this end guessing where they are about to be sent.
 */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const toolCallOf = (request: CreateElicitationRequest): string | null =>
  textOr((request as { readonly toolCallId?: unknown }).toolCallId, null);

const fieldsOf = (
  schema: ElicitationSchema | undefined,
): ReadonlyArray<AskField> | Refused => {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const fields: Array<AskField> = [];
  // Insertion order, which is the order the agent wrote the properties in and
  // therefore the order it means them to be read: an "Other" box is emitted
  // straight after the question it belongs to.
  for (const [key, property] of Object.entries(properties)) {
    const field = fieldOf(key, property, required.has(key));
    if (field === null) {
      return new Refused(
        `the agent asked for \`${key}\`, a \`${String(
          (property as { type?: unknown }).type,
        )}\` field this panel does not draw`,
      );
    }
    fields.push(field);
  }
  return fields;
};

const fieldOf = (
  key: string,
  property: ElicitationPropertySchema,
  required: boolean,
): AskField | null => {
  const shape = property as {
    readonly type?: unknown;
    readonly title?: unknown;
    readonly description?: unknown;
    readonly enum?: unknown;
    readonly oneOf?: unknown;
    readonly items?: unknown;
    readonly _meta?: Record<string, unknown> | null;
  };
  const common = {
    key,
    label: textOr(shape.title, null),
    hint: textOr(shape.description, null),
    required,
    attachedTo: attachedTo(shape._meta),
  };

  switch (shape.type) {
    case "string": {
      const choices = choicesOf(shape.oneOf, shape.enum);
      return choices === null
        ? { ...common, kind: "text", choices: [] }
        : { ...common, kind: "choice", choices };
    }
    case "array": {
      const items = shape.items as
        | { readonly anyOf?: unknown; readonly enum?: unknown }
        | undefined;
      const choices = choicesOf(items?.anyOf, items?.enum);
      return choices === null ? null : { ...common, kind: "choices", choices };
    }
    case "boolean":
      return { ...common, kind: "boolean", choices: [] };
    case "number":
      return { ...common, kind: "number", choices: [] };
    case "integer":
      return { ...common, kind: "integer", choices: [] };
    default:
      return null;
  }
};

const choicesOf = (
  titled: unknown,
  bare: unknown,
): ReadonlyArray<AskChoice> | null => {
  if (Array.isArray(titled) && titled.length > 0) {
    return (titled as ReadonlyArray<EnumOption>).map((option) => ({
      value: option.const,
      label: textOr(option.title, option.const),
      hint: textOr(option.description, null),
    }));
  }
  if (Array.isArray(bare) && bare.length > 0) {
    return (bare as ReadonlyArray<unknown>).map((value) => ({
      value: String(value),
      label: String(value),
      hint: null,
    }));
  }
  return null;
};

const attachedTo = (
  meta: Record<string, unknown> | null | undefined,
): string | null => {
  const marker = meta?.[CUSTOM_ANSWER] as
    | { readonly questionId?: unknown }
    | undefined;
  return typeof marker?.questionId === "string" ? marker.questionId : null;
};

/** The one field a permission request is: pick an option. */
export const PERMISSION_FIELD = "permission";

/**
 * A permission request, as the same form everything else is drawn as.
 *
 * The tool call's own title is the message — for a plan-mode exit the adapter
 * makes that "Ready to code?", which is exactly the question — and each option
 * becomes a choice whose VALUE is the option id the protocol wants back.
 *
 * Nothing here reads the option KINDS. Sorting `allow`-flavoured options to the
 * front, or marking one as the safe default, would be this layer having an
 * opinion about which answer a person meant; the agent already sent them in the
 * order it wants them read.
 */
export const permissionFormOf = (request: RequestPermissionRequest): Form => ({
  message: textOr(request.toolCall.title, "The agent is asking for permission"),
  toolCall: request.toolCall.toolCallId,
  link: null,
  fields: [
    {
      key: PERMISSION_FIELD,
      label: null,
      hint: null,
      kind: "choice",
      choices: request.options.map(
        (option: PermissionOption): AskChoice => ({
          value: option.optionId,
          label: option.name,
          hint: null,
        }),
      ),
      required: true,
      attachedTo: null,
    },
  ],
});

/**
 * The answers as the content an elicitation response carries: one entry per
 * field somebody actually filled in, typed the way its schema asked for.
 *
 * Three things are REFUSED rather than smoothed over, because each of them is a
 * question whose answer would otherwise be invented:
 *
 *   - an answer for a field that was never asked for — the form on screen is
 *     not the form that was sent, so nothing about the rest of it can be
 *     trusted either;
 *   - `not a number` in a number field, which coerced would be a `0` nobody
 *     typed;
 *   - a required field left empty.
 *
 * A field left blank is simply ABSENT from the content, which is the schema's
 * own way of saying nothing was chosen — the adapter reads a missing key as
 * "skipped", and writes nothing into the tool's answers for it.
 */
export const contentOf = (
  fields: ReadonlyArray<AskField>,
  answers: ReadonlyArray<AskAnswer>,
): Record<string, string | number | boolean | Array<string>> | Refused => {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const content: Record<string, string | number | boolean | Array<string>> = {};

  for (const answer of answers) {
    const field = byKey.get(answer.key);
    if (field === undefined) {
      return new Refused(
        `\`${answer.key}\` is not one of the fields this question asked for`,
      );
    }
    const value = answerValueOf(field, answer.values);
    if (value instanceof Refused) return value;
    if (value !== undefined) content[field.key] = value;
  }

  for (const field of fields) {
    if (field.required && content[field.key] === undefined) {
      return new Refused(`${field.label ?? field.key} needs an answer`);
    }
  }
  return content;
};

const answerValueOf = (
  field: AskField,
  values: ReadonlyArray<string>,
): string | number | boolean | Array<string> | undefined | Refused => {
  if (field.kind === "choices") {
    const picked = values.filter((value) => value !== "");
    const stranger = picked.find((value) => !offers(field, value));
    if (stranger !== undefined) return notAnOption(field, stranger);
    return picked.length === 0 ? undefined : [...picked];
  }
  const only = (values[0] ?? "").trim();
  if (only === "") return undefined;
  switch (field.kind) {
    case "choice":
      return offers(field, only) ? only : notAnOption(field, only);
    case "boolean":
      return only === YES_NO.yes;
    case "number":
    case "integer": {
      const number = Number(only);
      if (
        !Number.isFinite(number) ||
        (field.kind === "integer" && !Number.isInteger(number))
      ) {
        return new Refused(
          `${field.label ?? field.key} wants ${
            field.kind === "integer" ? "a whole number" : "a number"
          }, and \`${only}\` is not one`,
        );
      }
      return number;
    }
    default:
      return only;
  }
};

const offers = (field: AskField, value: string): boolean =>
  field.choices.some((choice) => choice.value === value);

const notAnOption = (field: AskField, value: string): Refused =>
  new Refused(
    `\`${value}\` is not one of the options ${field.label ?? field.key} offered`,
  );

const textOr = <T>(value: unknown, fallback: T): string | T =>
  typeof value === "string" && value !== "" ? value : fallback;
