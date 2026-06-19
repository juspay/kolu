# @kolu/arivu-contract

The one `@kolu/surface` the [`arivu`](../arivu) daemon serves,
[`arivu-tui`](../arivu-tui) reads, and (in the remote phase) a kolu-server
mirrors. It wraps the **generic** `AwarenessValue` — owned by
[`@kolu/terminal-awareness`](../terminal-awareness), where the sensors produce
it — in a keyed `Collection<TerminalId, AwarenessValue>`, plus a `version` cell
that is the seam for the remote contract-version handshake.

| Export                                     | Purpose                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `arivuSurface`                             | `defineSurface({ cells: { version }, collections: { awareness } })`      |
| `AwarenessValue`, `TerminalId`, `AwarenessKey` | the collection's value/key shapes (re-exported from terminal-awareness) |
| `ARIVU_CONTRACT_VERSION`, `DEFAULT_VERSION`, `VersionSchema` | the version-handshake payload                         |

The package **root** imports `@kolu/terminal-awareness/schema` (zod-only, no
`node:` / kaval runtime), so a browser / remote-kolu consumer of the surface
never drags in the sensor set. The default socket path both the daemon and the
viewer resolve — one home so it can't drift between them — is node-coupled, so
it lives behind a separate `@kolu/arivu-contract/socket` entry the root never
pulls in.

The value schema is **generic by construction**: it names nothing app-specific
(no `location`, no UI fields). kolu's own `TerminalServerMetadata` is built _on
top of_ this base, never the other way round — which is what lets `arivu` and
`arivu-tui` reuse the awareness contract with zero dependency on any kolu-app
package.
