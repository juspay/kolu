/**
 * `@kolu/acp` — an ACP agent in a tile.
 *
 * The package ships two bins (`acp-proxy`, `acp-chat`); this module is the
 * library face consumers need in order to *find* and *drive* a proxy without
 * re-deriving its conventions.
 */

export {
  AdapterSession,
  CANCEL_GRACE_MS,
  type AdapterSpec,
} from "./adapter.ts";
export {
  formatEvent,
  formatUpdate,
  type ProxyEvent,
  TranscriptRenderer,
} from "./render.ts";
export { socketPathFor } from "./socketPath.ts";
