import { Schema } from "effect";
import { ConductorReadingLevelSchema } from "./conductorSchema.ts";

/** HOW ONE MEMBER TERMINAL STANDS, and since when — the value of the
 *  `memberReadings` collection, keyed by the terminal's `<host>/<id>` ref.
 *  Runtime only: an absent key is "not read yet", never "0s". */
export const MemberReadingSchema = Schema.Struct({
  level: ConductorReadingLevelSchema,
  /** ISO time it entered that level, by the watcher's clock. */
  since: Schema.String,
});
export type MemberReading = typeof MemberReadingSchema.Type;
