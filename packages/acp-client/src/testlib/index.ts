/**
 * WHAT A TEST OF SOMETHING BUILT ON THE CLIENT NEEDS: the fixture legs, and
 * the path of a fixture agent to spawn.
 *
 * Every fixture agent lives in `../fixtures/`, beside the client whose
 * protocol they speak. A consumer's suite starts one as
 * `process.execPath <fixtureAgent(name)>` — Node strips the types itself.
 */

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
