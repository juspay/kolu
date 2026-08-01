<!--
  House style: 90s OSS README — short lines, lists, tables, code.
  No essay prose. Headers + `code spans` for scanning; sparingly bold.
-->

# osfacts — what stayed behind

The tool moved out: **https://github.com/juspay/osfacts** (OSF5).

kolu pins it with npins and bakes the binary. Nothing here builds it.

| you want | look |
| --- | --- |
| the binary, its tests, its README | the repo above |
| which revision kolu builds | `npins/sources.json` → `osfacts` |
| the bake | `nix/env.nix` → `KOLU_OSFACTS_BIN` |
| to bump it | `npins update osfacts` |

## Why two files are still here

| file | why |
| --- | --- |
| `client-ts/` | `osfacts-client` is a **pnpm workspace member** — `packages/padi`, `packages/kaval`, and the surface examples import it by name. A workspace member must be a path inside the repo, so it cannot come from the pin. |
| `facets.json` | `client-ts/src/facets.test.ts` pins the TS facet unions to it. |

Neither is a second source of truth: `osfactsFacetsInSync` (`default.nix`)
fails the build if `facets.json` differs from the pinned repo's copy, and
upstream pins that file to the Rust `Facet` enum. Drift is a red, not a
surprise.

**To finish the move**, `osfacts-client` needs to be consumable without being
in this tree — a published package, or a pnpm git-subdirectory dependency. Then
this directory goes away.
