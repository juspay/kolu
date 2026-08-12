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
import { surfaceClient, type SurfaceReadoutStatus } from "@kolu/surface/solid";
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
const { link, client, readout, dispose } = await connectSurface({
  surface,
  url,
  // REQUIRED: what happens when the server retires this wire (a tab bound to a
  // process that is gone — the link will never dial again). No default, so a
  // connection that compiles has an answer. `reloadForUpdate` is the one-liner;
  // pass your own handler to take the screen instead.
  retired: reloadForUpdate,
});
// #endregion connect

// #region readout
// The five states an indicator may report. `Record`, not a function: a state with
// no wording of its own is a type error HERE, in the app's own table, which is
// where the words belong. The framework decides which state is TRUE — including
// `degraded`, the one the transport cannot see (a live socket over a subscription
// that has stopped) — and this app decides what each is called.
const LABEL: Record<SurfaceReadoutStatus, string> = {
  connecting: "connecting",
  live: "live — everything this page reads is arriving",
  degraded: "partly live",
  reconnecting: "reconnecting — showing the last thing the server said",
  retired: "the server was replaced — reload this page",
};

// `degraded` NAMES what stopped, and its list is non-empty by type, so this
// sentence can never come out with a hole in it.
const label = (): string => {
  const now = readout();
  return now.status === "degraded"
    ? `${LABEL.degraded} — nothing is arriving on ${now.stopped.join(", ")}`
    : LABEL[now.status];
};

// The one bit that says a reload is the ONLY recovery (`retired`), read rather
// than re-derived — a page never has to keep its own list of terminal states.
const offerReload = (): boolean => readout().needsReload;
// #endregion readout

export {
  app,
  client,
  dispose,
  label,
  link,
  load,
  log,
  offerReload,
  procs,
  readout,
};
