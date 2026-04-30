/**
 * Shared cell/collection/stream descriptors.
 *
 * Descriptors are pure data: name + Zod schemas + defaults. They live in
 * kolu-common so both server and client can import them — server wires
 * handlers and persistence; client wires Solid hooks. The descriptors
 * have no runtime behavior and add no bundle weight on the client.
 *
 * See `@kolu/cells` for the framework's primitive definitions.
 */

import { cell } from "@kolu/cells";
import {
  ActivityFeedSchema,
  type ActivityFeed,
  SavedSessionSchema,
  type SavedSession,
} from "./index";

/** Server-derived activity feed (recent repos + recent agents).
 *  Read-only on the client; the server is the sole writer. */
export const activityFeedCell = cell({
  name: "activityFeed",
  schema: ActivityFeedSchema,
  default: { recentRepos: [], recentAgents: [] } satisfies ActivityFeed,
});

/** Last persisted snapshot of terminals + active id, or null when no
 *  session is saved. Read-only on the client; the server's debounced
 *  autosave loop owns writes. */
export const savedSessionCell = cell({
  name: "savedSession",
  schema: SavedSessionSchema.nullable(),
  default: null as SavedSession | null,
});
