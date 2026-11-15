# @kolu/surface-example-snippets

Every code block the Surface docs show, as real code the workspace typechecks. The site's `<Snippet>` component reads these files by repo-root-relative path, so a call that no longer compiles fails CI instead of surviving review.

Private to the workspace, so it exports nothing. The files are typechecked, never executed: anything that would dial, spawn or need a reactive owner sits inside a function.

## What is here

`surface.ts` declares the small process-monitor surface (a cell, a collection, a stream, an event and a procedure), and every other file builds on it. One file per topic: `serve.ts` and `consume-solid.ts` for `@kolu/surface`, `consume-cli.ts` outside Solid, `links.ts` for swapping a link, `daemon.ts` and `identity.ts` for `@kolu/surface-daemon`, `supervisor.ts`, `map.ts`, `remote.ts`, `cli.ts`, `mcp.ts`, and `test-a-surface.ts`.

## What not to break

- 19 pages under `website/src/content/surface/` embed these paths, several by `// #region <name>` marker. Renaming a file, moving one or dropping a marker breaks the page that shows it, so grep that directory first.
- Two schema spellings are laws for any wire field here, as in the framework: `Schema.optionalKey` for an optional key, and `Schema.withDecodingDefaultKey` for a defaulted one.
- `pnpm typecheck` is this package's whole job. Keep it green, and keep the dependencies to the `@kolu/surface*` packages the docs describe.
