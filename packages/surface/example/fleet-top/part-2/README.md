# @kolu/surface-example-fleet-top-part-2

The finished code of the Surface tutorial [Make it a daemon](https://kolu.dev/surface/make-it-a-daemon). Part 1's `top` surface is served again without change, reached over a unix socket by a long-lived single-instance daemon, and spawned, watched and live-recycled by a supervisor.

Private to the workspace, so it exports nothing.

## What is here

| path | what |
| --- | --- |
| `src/common/surface.ts` | the same four-member surface part 1 declares |
| `src/common/paths.ts` | the gate and socket paths, which must share one directory |
| `src/common/processIdentity.ts` | the build identity the supervisor compares across a recycle |
| `src/daemon/main.ts` | `daemonMain`: claim the gate, serve, wait, close the socket, release the gate |
| `src/supervisor/main.ts` | spawn, connect, and recycle the daemon while a client stays connected |

## Run it

`pnpm run daemon` in one terminal, then `pnpm run supervisor` in another. A second daemon exits 0, because the first holds the gate. `FLEET_TOP_GATE` and `FLEET_TOP_SOCKET` move both paths; set both or neither. `pnpm run typecheck` is what CI runs.

## What not to break

The tutorial embeds `src/daemon/main.ts` and `src/supervisor/main.ts` by path, so moving either breaks the page. `daemonMain` returns a `DaemonExit` and never calls `process.exit`: that is what lets a test drive the whole lifecycle in process, and the bin half that maps the value to an exit code is `daemonProcessMain`. Its lifetime is `forever` on purpose, since an idle `top` is still watching your machine.

Depends on `@kolu/surface`, `@kolu/surface-daemon`, `@kolu/surface-daemon-supervisor` and `osfacts-client`.
