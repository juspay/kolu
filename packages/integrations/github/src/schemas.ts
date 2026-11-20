import { Schema } from "effect";

export const GhUnavailableCodeSchema = Schema.Literals([
  "not-installed",
  "not-authenticated",
  "timed-out",
  "unknown",
]);
export type GhUnavailableCode = typeof GhUnavailableCodeSchema.Type;

const GH_REASONS: Record<GhUnavailableCode, string> = {
  "not-installed": "gh: not installed",
  "not-authenticated": "gh: not authenticated",
  "timed-out": "gh: timed out",
  unknown: "gh: unknown error",
};

export function reasonForGhCode(code: GhUnavailableCode): string {
  return GH_REASONS[code];
}

export const GH_PROVIDER = "gh";

export const GhUnavailableSchema = Schema.Struct({
  provider: Schema.Literal(GH_PROVIDER),
  code: GhUnavailableCodeSchema,
});
export type GhUnavailableSource = typeof GhUnavailableSchema.Type;
