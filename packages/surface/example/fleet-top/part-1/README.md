# @kolu/surface-example-fleet-top-part-1

The finished code of the Surface tutorial [Your first surface](https://kolu.dev/surface/your-first-surface): a live `top` for one machine, declared once as a surface and read by a Solid client.

Private to the workspace, so it exports nothing. Four members carry the whole tool, declared in `src/common/surface.ts`: the `load` and `memory` cells, the `processes` collection keyed by pid, and the `process.kill` procedure.

## What is here

| path | what |
| --- | --- |
| `src/common/surface.ts` | `defineSurface` over the four members, and the domain types lifted from it with `SurfaceTypes` |
| `src/server/top.ts`, `proc.ts` | the sampler and the process table that feed them |
| `src/server/main.ts` | handlers bound on the group, served over HTTP and a WebSocket |
| `src/inproc.ts` | the same surface driven over a direct link, with no socket |
| `src/client/` | `wire.ts` (the link and the client), `App.tsx` (the bound hooks and the UI) |

## Run it

From this directory, `pnpm install`, then `pnpm run dev`. The server listens on 7730 and Vite on 5175, which proxies `/rpc` to it. `pnpm run inproc` runs the in-process variant and prints to the terminal. `pnpm run typecheck` is what CI runs.

## What not to break

The docs page embeds files from here by path, and `src/client/App.tsx` by its `hooks` region. Moving a file, renaming a region marker or dropping one breaks the page that shows it, so grep `website/src/content/surface/` for the path before you move anything. Depends on `@kolu/surface` and `@kolu/surface-app` only: no kolu-internal package belongs here, because a reader copies this directory out of the repo.
