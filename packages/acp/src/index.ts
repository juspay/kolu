/**
 * `@kolu/acp` — an ACP agent in a tile.
 *
 * The package's product is two bins (`acp-proxy`, `acp-chat`). This module is
 * the **client** face they share and the next consumer needs: where a proxy
 * listens, and how to talk to one.
 *
 * The proxy's internals — the adapter supervisor, the transcript renderer —
 * are not exported. They are one program's implementation, and publishing them
 * would invite a consumer to depend on a shape that exists only to serve it.
 */

export {
  connectToProxy,
  type ProxyClient,
  SESSION_CWD_META,
} from "./connect.ts";
export { socketPathFor } from "./socketPath.ts";
