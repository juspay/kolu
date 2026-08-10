/**
 * Consuming the example surface in SolidJS — the bound-hook block the
 * `@kolu/surface` reference embeds, plus the single-surface `connectSurface`
 * block the `@kolu/surface-app` reference embeds.
 *
 * These files are typechecked, never executed — the `.use()` hooks would throw
 * outside a reactive owner at runtime, but their call shapes are what the docs
 * need to pin.
 */

import { Effect } from "effect";
import { directDispatch } from "@kolu/surface/links/direct";
import { surfaceClient } from "@kolu/surface/solid";
import { connectSurface } from "@kolu/surface-app/solid";
import { reloadForUpdate } from "@kolu/surface-app/lifecycle";
import { runtime } from "./serve";
import { surface } from "./surface";

// `directDispatch` takes the SERVED surface (anything carrying `handlers`) and
// calls its handlers in-process. It is the one dispatch `surfaceClient` accepts
// bare: with no transport there is nothing that could half-open, so its
// constant-`true` liveness leg is honest by construction.
const dispatch = directDispatch(runtime);

const nodeId = "node-1";
const docId = "doc-1";
const pid = 4321;
const onError = (err: Error): void => console.error(err);
const handler = (saved: { at: number }): void => console.log(saved.at);

// #region solid
const app = surfaceClient(surface, dispatch);

const load = app.cells.load.use({ authority: "server" }); // Accessor<Load>
const procs = app.collections.processes.use(); // .byKey(id) / .keys()
const log = app.streams.nodeLog.use(() => nodeId, { onError }); // .pending() / .error()
app.events.autosave.use(() => docId, handler, { onError }); // returns nothing
Effect.runFork(app.procedures.proc.kill({ pid })); // an Effect, run at the UI edge
// #endregion solid

const url = "wss://example.test/rpc/ws";

// #region connect
// ASYNC: the dial is an effect. `link` is the `{ dispatch, wire, dispose }` the
// websocket link minted; `dispose()` releases its scope (dial/ping/response
// fibers) as well as stopping the watchdog.
const { link, client, status, dispose } = await connectSurface({
  surface,
  url,
  // REQUIRED: what happens when the server retires this wire (a tab bound to a
  // process that is gone — the link will never dial again). No default, so a
  // connection that compiles has an answer. `reloadForUpdate` is the one-liner;
  // pass your own handler to take the screen instead.
  retired: reloadForUpdate,
});
// #endregion connect

export { app, client, dispose, link, load, log, procs, status };
