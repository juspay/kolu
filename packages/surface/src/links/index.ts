/**
 * Transport adapters for `@kolu/surface`.
 *
 *   - `./stdio` — base64+newline-framed stdio link for inter-process and
 *     remote (SSH-tunneled) surfaces.
 *   - `./loopback` — in-process pair, useful for testing and for
 *     symmetric "local backend wrapped in the same client shape as a
 *     remote backend" patterns.
 *
 * Browser-only WebSocket transport remains in `../client.ts`
 * (`createCellsClient` — for use with `RPCLink` from
 * `@orpc/client/websocket`).
 */

export * from "./loopback";
export * from "./stdio";
