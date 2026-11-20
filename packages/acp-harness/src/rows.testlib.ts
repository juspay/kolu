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

export const FixtureCallSchema = Schema.Struct({
  about: Schema.NullOr(Schema.String),
  did: Schema.NullOr(Schema.String),
});
export type FixtureCall = typeof FixtureCallSchema.Type;

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
  signIn: Schema.optionalKey(Schema.Literals(["signed-out", "account"])),
  attachments: Schema.optionalKey(Schema.Array(FixtureFileSchema)),
});
const FixtureToolRowSchema = Schema.Struct({
  ...toolRowFields,
  server: Schema.optionalKey(Schema.String),
  tool: Schema.optionalKey(Schema.String),
  asksThroughForm: Schema.optionalKey(Schema.Boolean),
  call: Schema.optionalKey(FixtureCallSchema),
});

const FixtureRungRowSchema = Schema.Struct({
  ...rowHead,
  kind: Schema.Literal("rung"),
  text: Schema.String,
  rang: Schema.Array(Schema.String),
  queued: Schema.optionalKey(Schema.Literal(true)),
  delivery: Schema.optionalKey(Schema.Literals(["refused", "unanswered"])),
});

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

export const decodedAsServer = (row: unknown): FixtureRow =>
  Schema.decodeUnknownSync(FixtureRowSchema, {
    onExcessProperty: "error",
  })(row);
