/**
 * Consuming the example surface in SolidJS — the bound-hook block the
 * `@kolu/surface` reference embeds, plus the single-surface `connectSurface`
 * block the `@kolu/surface-app` reference embeds.
 *
 * These files are typechecked, never executed — the `.use()` hooks would throw
 * outside a reactive owner at runtime, but their call shapes are what the docs
 * need to pin.
 */

import { directLink } from "@kolu/surface/links/direct";
import { surfaceClient } from "@kolu/surface/solid";
import { connectSurface } from "@kolu/surface-app/solid";
import { router } from "./serve";
import { surface } from "./surface";

const link = directLink<typeof surface.contract>(router as never);

const nodeId = "node-1";
const docId = "doc-1";
const pid = 4321;
const onError = (err: Error): void => console.error(err);
const handler = (saved: { at: number }): void => console.log(saved.at);

// #region solid
const app = surfaceClient(surface, link);

const load = app.cells.load.use({ authority: "server" }); // Accessor<Load>
const procs = app.collections.processes.use(); // .byKey(id) / .keys()
const log = app.streams.nodeLog.use(() => nodeId, { onError }); // .pending() / .error()
app.events.autosave.use(() => docId, handler, { onError }); // returns nothing
await app.procedures.proc.kill({ pid }); // bound + typed from the declaration
// #endregion solid

const url = "wss://example.test/rpc/ws";

// #region connect
const { ws, client, status, dispose } = connectSurface({ surface, url });
// #endregion connect

export { app, client, dispose, load, log, procs, status, ws };
