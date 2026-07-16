# kolu-cli

The `kolu` binary — the product's entry point and its **composition root**
(the one package allowed to import everything). It owns the cleye subcommand
dispatch and boots whichever face the user asked for; the faces themselves
live elsewhere.

It owns dispatch and **nothing else**: no server, web, or terminal state lives
here, and no domain logic — a face's actual behavior is entirely its own
package's to own (`kolu-server` for the web face today; the future `mcp`/`tui`
packages for theirs). Precisely because a composition root *may* import
everything, this boundary is what keeps it from re-accreting scope.

```
kolu [flags]         the web server (bare kolu = alias of `kolu web`)
kolu web [flags]     the same web server, by name
kolu tui             reserved — the terminal canvas (a later PR)
kolu mcp             reserved — the MCP agent face (a later PR)
```

- **`kolu web` and bare `kolu` are byte-for-byte aliases**: one flag schema is
  bound to both spellings, and `cli.test.ts`'s flag matrix pins the parse
  equality. The web arm dynamically imports `kolu-server`'s `bootKoluWeb`, so
  nothing of the server's module graph loads until the dispatch has chosen it.
- **Reserved subcommands fail fast** with a named not-shipped-yet message
  (exit 1) — as does a typo'd subcommand (`kolu tuii`), which would otherwise
  silently boot a server.
- **`--version`** reads the server's one `serverVersion` accessor (whose
  source of truth is `packages/server/package.json` — `/release` bumps it; nix
  reads the same file), so the binary and the running server can never report
  different versions.

The plan of record is the kolu-cli Atlas note
([kolu.dev/atlas/kolu-cli.html](https://kolu.dev/atlas/kolu-cli.html)): this
package is PR1 (dispatch only); the `mcp` and `tui` faces arrive as separate
packages in later PRs.
