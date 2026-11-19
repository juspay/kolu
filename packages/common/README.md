# kolu-common

The contract the kolu server and the browser share: the typed reactive surface,
the root RPC group, the Conductor's wire vocabulary, and the few constants and
codecs both sides must agree on. Browser-safe — no `node:` imports — so the
client and the server build from one source.

## Entries

| Entry | What it holds |
| --- | --- |
| `kolu-common/surface` | `koluSurface` and the `surfaces` map: every cell, collection, stream and event the app exposes, with the schemas they are built from and the types lifted out of them. |
| `kolu-common/contract` | The flat Effect `RpcGroup` of root procedures: `server/info`, `daemon/restart` and the `hosts/*` membership verbs, with their I/O schemas. |
| `kolu-common/conductor` | The shapes of the one Conductor conversation: phase, model, transcript rows. Protocol words come from `@kolu/acp/wire` rather than being redeclared. |
| `kolu-common/conductorErrors` | The tagged errors a Conductor caller can branch on. |
| `kolu-common/works` | The `works` and `memberReadings` collection schemas. The record itself is `kolu-work`'s. |
| `kolu-common/surfacesWithPadi` | `surfaces` composed with `@kolu/padi`'s surface: the one map the server serves and the client dials. |
| `kolu-common/hostKey` | `HostKey`, a discriminated sum over local and remote hosts, with `encodeHostKey` / `decodeHostKey` (the wire codec) and `parseHostInput` (the human codec). |
| `kolu-common/hostHue` | `HOST_HUE_PALETTE` and `hostHueFor`: a pure FNV-1a seed to one of twelve hues. |
| `kolu-common/config` | Cross-cutting defaults, and a re-export of `DEFAULT_PORT`. |
| `kolu-common/defaultPort` | `DEFAULT_PORT` alone, from a file with no imports. |
| `kolu-common/preview` | File-extension classification for the Code browser: sandbox, PDF, raster and the rest. |
| `kolu-common/workFiles` | `listWorkFiles`: the one walk of a worktree's `.waterfall/`, every file at any depth over a host's own `fs.listDirectory`, which the server and the browser both call. Its two limits (`WORK_FILES_LISTED`, `WORK_FILES_KEPT_BYTES`) and `notKeptWhy`, the sentence that cites them. |
| `kolu-common/test-hooks` | The `window` and `navigator` augmentations the client installs and the e2e steps read. Imported for its side effect. |

## Who uses it

`packages/client`, `packages/server`, `packages/conductor`,
`packages/kolu-cli` and `packages/tests`. It may depend
on the surface framework packages, `@kolu/acp`, `@kolu/padi-client`,
`@kolu/terminal-vocab`, `anyagent`, `anyforge`, `kolu-git`, `kolu-github` and
`kolu-work`.

## What a maintainer must not break

- **Keep it browser-safe.** A `node:` import here reaches the client bundle.
- **`surface.ts` imports no padi.** The padi-ful map lives in
  `surfacesWithPadi.ts`, and only the two files that dial or serve the combined
  map import it. `hostKey.ts` stays padi-less for the same reason, so
  `contract.ts` can type the `hosts/*` procedures.
- **`defaultPort.ts` keeps zero imports.** The command tree reads the port on
  every `kolu` invocation, and `config.ts` pulls the terminal vocabulary in.
- **Do not reorder `HOST_HUE_PALETTE`.** `hostHueFor` indexes it with
  `hash % length`, so any edit recolours existing hosts.
- **One tag, one procedure.** `RpcGroup.make` and `.merge` are last-writer-wins
  with no collision check, so the assembly in `contract.ts` proves disjointness
  itself. Surface members are namespaced under `surface/`.
- **`preview.ts`'s four binary sets stay disjoint**, and the sandbox set is a
  security boundary: `.html`, `.htm` and `.svg` can carry scripts.
- **A terminal on the Conductor wire is named `host/id`**, parsed at the last
  `/`, and the rows that name one carry the two halves separately.
- **One walk of `.waterfall/`.** The server's port and the browser's list both
  call `listWorkFiles`; a second filter or a second limit anywhere else would
  let the card, the timeline and the kept copy disagree. The limits are fixed
  constants, never settings.

Tests: `src/contract.test.ts`, `src/surface.test.ts`, `src/hostKey.test.ts`,
`src/hostHue.test.ts`, `src/preview.test.ts`, `src/nixFileset.test.ts`,
`src/workFiles.test.ts`.
