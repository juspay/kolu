import path from "node:path";

export {
  FORWARDS,
  NAMES_IN_ID,
  NAMES_IN_META,
  NAMES_ON_FRAME,
  OWN_SESSIONS,
  QUEUES,
  SAYS_NOTHING,
} from "./legs.ts";

/** The absolute path of one fixture agent, by its file name. */
export const fixtureAgent = (name: string): string =>
  path.join(import.meta.dirname, "..", "fixtures", name);
