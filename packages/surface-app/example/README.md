# @kolu/surface-app-example

A hello world for [`@kolu/surface-app`](../README.md): the library's build-identity surface served beside an app's own live surface, over one transport. Run it to see the freshness contract, the skew rail, and a second surface that is not merged into the first.

Private to the workspace, so it exports nothing.

## What it shows

- **Sibling surfaces, not one merged surface.** `src/common/surface.ts` keys the library's surface as `surfaceApp` and the app's own as `demo`, whose `serverStats` cell is live. Each keeps its own namespace on the one connection.
- **An extended build identity.** `defineBuildInfo` adds a `bootId` axis the server only learns at boot, the same shape kolu uses. Staleness stays the default clean-ref commit comparison.
- **One call for the listener.** `serveSurfaceApp` owns the origin gate, the upgrade path, the stale-tab check, heartbeat enrolment, the shell layers and the teardown. The app file keeps only which surfaces it serves, where its dist is, and the live connection count.

## Run it

From this directory, `just dev`: the server listens on 7710 and Vite on 5175. Open <http://localhost:5175>. `just start` builds the client and serves it from the server for a production-like run on 7710. Boot with `SURFACE_APP_COMMIT=<other>` to see the skew rail. `just typecheck` checks this example alone; CI runs it with the workspace.

## What not to break

The example is the reference copy of this wiring, so downstream apps are read from it. Keep the listener a single `serveSurfaceApp` call: spelling its steps out by hand is how a copy loses one. Depends on `@kolu/surface`, `@kolu/surface-app`, `effect`, `solid-js` and `ws`, and on no kolu-internal package.
