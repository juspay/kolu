/**
 * `@kolu/acp` — an ACP agent in a tile.
 *
 * The package's product is two bins (`acp-proxy`, `acp-chat`). This module is
 * the small library face a *client* needs, and deliberately nothing more: a
 * consumer talks to a proxy over standard ACP with the official library, so the
 * only thing it cannot derive for itself is where the socket lives.
 *
 * The proxy's internals — the adapter supervisor, the transcript renderer — are
 * not exported. They are one program's implementation, and publishing them
 * would invite a second consumer to depend on a shape that exists only to serve
 * the first.
 */

export { socketPathFor } from "./socketPath.ts";
