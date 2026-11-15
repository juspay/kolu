# @kolu/surface-example-fleet-top-part-3

The finished code of two Surface tutorials, [A fleet of surfaces](https://kolu.dev/surface/a-fleet-of-surfaces) and [Across the hosts](https://kolu.dev/surface/across-the-hosts). Part 1's `top` is reached on several boxes over ssh and served to one browser as a single surface map, keyed by hostname.

Private to the workspace, so it exports nothing.

## What is here

| path | what |
| --- | --- |
| `src/common/surface.ts`, `map.ts` | the `top` surface, and the map declared over it |
| `src/agent/` | the agent half: the same surface spoken over stdio, run on each box |
| `src/server/hosts.ts` | per host: dial over ssh, pump the agent's frames into a local implementation, re-serve it as a dispatch |
| `src/server/main.ts` | the registry of hosts, and `serveSurfaceMap` over it |
| `src/client/` | the chips, and the canvas that re-keys when you pick a host |

## Run it

Set `FLEET_TOP_AGENT_DRV` to the agent derivation, then `HOST=boxA,boxB,boxC pnpm run dev`. The server listens on 7740 and Vite on 5176. Targets must be distinct names, because the map is keyed by hostname and repeats collapse into one entry. Each target must be able to realise the agent derivation. `pnpm run typecheck` is what CI runs.

## What not to break

The pages embed `src/common/map.ts` and `src/agent/main.ts` whole, plus the `mapped` region of `src/client/App.tsx` and the `dial` and `pump` regions of `src/server/hosts.ts`. Keep those paths and markers, or the page shows the wrong code. The registry is the one writer of membership, which is what keeps an unreachable box a `warming` chip that retries rather than a crash.

Depends on `@kolu/surface`, `@kolu/surface-app`, `@kolu/surface-map` and `@kolu/surface-remote`.
