# @kolu/surface-example

A minimal in-memory notes app demonstrating all four `@kolu/surface` primitives end-to-end. Read it as the runnable companion to [`../README.md`](../README.md) — every primitive declaration, server handler, and client hook has one obvious place.

## What's where

| Primitive | Descriptor | Server handler | Client hook | What it backs |
|---|---|---|---|---|
| **Cell** | `prefsCell` (`src/common/surface.ts`) | `cellHandlers` (`src/server/router.ts`) | `useCell(prefsCell, …)` (`src/client/App.tsx`) | Editor preferences (font size, theme, autosave toggle). Demonstrates `authority: "local"` instant-UI mutation + `applyPatch` partial updates. |
| **Collection** | `notesCollection` | `collectionHandlers` | `useCollection(notesCollection, …)` | Notes keyed by id. Per-key `mapArray`-driven reactive lifecycle — adding / removing notes only re-renders affected sidebar entries. |
| **Stream** | `searchStream` | `streamHandlers` (poll-on-event source) | `useStream(searchStream, () => input(), client.search.get)` | Full-text search results, parameterized by query. Re-runs on every notes-set change so results stay live as you type and as notes change. |
| **Event** | `autosaveEvent` | `eventHandlers` | `useEvent(autosaveEvent, () => selectedId(), …, handler)` | "Saved" flash on the active note. Handler-based — no current value, no snapshot on (re-)subscribe. |

## Run

From this directory:

```sh
just dev
```

The recipe enters the Nix devshell (skipping re-entry if you're already inside one), installs deps if needed, and starts the server (port 7700) plus the Vite dev server (port 5174) in parallel. Open <http://localhost:5174> — Vite proxies `/rpc/*` (HTTP + WebSocket) to the Hono server.

The example is self-contained: in-memory note store, no persistence between restarts. Stop and restart to reset the dataset.

## Swapping `inMemoryStore` for `confStore`

The example uses ad-hoc closures for state (in `src/server/store.ts`) — the cleanest "this fits in one file" shape. To demonstrate disk persistence the framework supports out of the box, replace `getPrefs` / `setPrefs` with a `confStore<EditorPrefs>` adapter:

```ts
// src/server/store.ts (after swap)
import Conf from "conf";
import { confStore } from "@kolu/surface/server";

const conf = new Conf<{ prefs: EditorPrefs }>({ projectName: "cells-example" });

// Use this in place of the inline { get: getPrefs, set: setPrefs } in router.ts:
export const prefsStore = confStore<EditorPrefs>(conf, "prefs");
```

```ts
// src/server/router.ts (after swap)
const prefsHandlers = cellHandlers(prefsCell, {
  store: prefsStore,         // ← was { get: getPrefs, set: setPrefs }
  bus: prefsChannel,
  patch: applyPrefsPatch,
});
```

Wire format is identical; only the storage adapter changes. Same swap works for any Cell — `inMemoryStore(default)` for ephemeral, `confStore` for disk-backed, custom adapters for sqlite / redis / anything implementing `CellStore<T>`.

## Layout

```
packages/surface/example/
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── common/
    │   └── surface.ts       # schemas + defineSurface + SurfaceTypes-derived domain types
    ├── server/
    │   ├── store.ts         # in-memory state + typed channels
    │   ├── router.ts        # implementSurface(surface, deps) — one declarative call
    │   └── main.ts          # Hono + WebSocket bind on port 7700
    └── client/
        ├── index.html
        ├── main.tsx         # Solid render
        ├── App.tsx          # the four bound .use() hooks + sidebar/editor UI
        ├── wire.ts          # surfaceClient(surface, { websocket }) bundle
        └── styles.css       # Tailwind import + dark variant
```

The example deliberately doesn't use Conf, doesn't ship a Nix flake of its own, and doesn't import any kolu-internal package. Everything it needs is in `@kolu/surface/{*}` plus the standard oRPC + Hono + Vite stack.
