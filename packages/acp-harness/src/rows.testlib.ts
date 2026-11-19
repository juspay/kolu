/**
 * THE PRODUCT THIS PACKAGE'S OWN SUITES RUN AS — a made-up one, and every row
 * it publishes decoded strictly before a test reads it.
 *
 * TWO THINGS AT ONCE, and they are the same thing. The harness is generic over
 * a product's row union and knows no product, so its tests need A product:
 * these are the rows of one that exists nowhere else, with its own words for
 * what a tool call was about and for a turn the host started. Nothing here is
 * kolu's, which is the point — a suite written against kolu's rows would be
 * the one place a kolu name could creep back into this package.
 *
 * And the DECODE is the other half. A generic method that writes a field into
 * `Row` can write one the product's SCHEMA does not declare: the compiler
 * cannot see it, the encoder drops it without a word, and the failure surfaces
 * far away — in a browser that never drew the card, as fourteen e2e scenarios
 * did once. So the suites that read published rows decode them the way a
 * server would, with `onExcessProperty: "error"`, which is the half that
 * catches a field nobody declared. It is one helper rather than a call per
 * test for `says`' reason: the day a suite reads rows another way is the day
 * it stops checking.
 */

import {
  agentRowFields,
  askRowFields,
  noticeRowFields,
  PlanStep,
  rowHead,
  toolRowFields,
  userRowFields,
} from "@kolu/acp/wire";
import { Schema } from "effect";

/** WHAT THIS FIXTURE PRODUCT READS A TOOL CALL AS — the shape its own cards
 *  would draw. Two fields and no more: the fixture's point is that SOMETHING
 *  of the product's rides the row and comes back unchanged. */
export const FixtureCallSchema = Schema.Struct({
  /** Which of the fixture's own things the call was about, where its reader
   *  could name one off the call's input or its answer. */
  about: Schema.NullOr(Schema.String),
  /** ... and what the call did to it. */
  did: Schema.NullOr(Schema.String),
});
export type FixtureCall = typeof FixtureCallSchema.Type;

/** One file riding a message, as this product records it on the row: the
 *  values the harness reads off a file, plus the id its own store wrote it
 *  under. */
export const FixtureFileSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  bytes: Schema.Int,
  path: Schema.String,
});
export type FixtureFile = typeof FixtureFileSchema.Type;

const FixtureUserRowSchema = Schema.Struct({
  ...userRowFields,
  /** What a refusal a signature would fix is marked with — the one product
   *  field the harness writes itself, and only onto a person's own words. */
  signIn: Schema.optionalKey(Schema.Literals(["signed-out", "account"])),
  /** The files that rode with the words. Optional because a message that
   *  carried none says nothing rather than saying `[]`. */
  attachments: Schema.optionalKey(Schema.Array(FixtureFileSchema)),
});
const FixtureToolRowSchema = Schema.Struct({
  ...toolRowFields,
  server: Schema.optionalKey(Schema.String),
  tool: Schema.optionalKey(Schema.String),
  asksThroughForm: Schema.optionalKey(Schema.Boolean),
  call: Schema.optionalKey(FixtureCallSchema),
});

/** The fixture's own word for a turn the HOST started: who rang, and what
 *  they said. */
const FixtureRungRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("rung"),
  text: Schema.String,
  rang: Schema.Array(Schema.String),
  queued: Schema.optionalKey(Schema.Literal(true)),
  delivery: Schema.optionalKey(Schema.Literals(["refused", "unanswered"])),
});

/** ... and its break between two conversations, which is the row kind a
 *  product whose new session DIVIDES has to declare. */
const FixtureDividerRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("divider"),
  text: Schema.String,
});

const FixturePlanRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("plan"),
  steps: Schema.Array(PlanStep),
});

export const FixtureRowSchema = Schema.Union([
  FixtureUserRowSchema,
  Schema.Struct({ ...agentRowFields }),
  FixtureToolRowSchema,
  Schema.Struct({ ...askRowFields }),
  Schema.Struct({ ...noticeRowFields }),
  FixturePlanRowSchema,
  FixtureDividerRowSchema,
  FixtureRungRowSchema,
]);
export type FixtureRow = typeof FixtureRowSchema.Type;

/** Decode one published row the way a server would, refusing a field this
 *  product's contract does not declare. */
export const published = (row: unknown): FixtureRow =>
  Schema.decodeUnknownSync(FixtureRowSchema, {
    onExcessProperty: "error",
  })(row);
