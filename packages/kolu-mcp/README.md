# kolu-mcp

`kolu mcp` — the kolu binary's **agent face**: this host's terminals served to
a coding agent over [MCP](https://modelcontextprotocol.io) (stdio), as a pure
`padiSurface` client re-exposed through
[`@kolu/surface-mcp`](../surface-mcp/README.md). No kolu-server anywhere — the
package manifest is the graduation fence (padi/surface deps only), so the face
provably serves agents with padi alone.

What an agent gets is the **ratified v1 expose map** (`src/expose.ts`),
default-deny with named, tested denials:

- **resources** (subscribable): `terminals` (the roster), `urgency` (who needs
  a human now), and the status story (`status` · `daemonStatus` · `identity` —
  kaval health + padi's own generation, so a daemon restart is *data*, not an
  anomaly);
- **read-only tools**: `screen_text` (tail-mode snapshot) · `screen_history` ·
  `git_getStatus`/`git_getDiff` · `fs_listAll`/`fs_readFile`, and the two
  composite done-signals `wait_outputSettled` / `wait_agentState` (the
  /orchestrator·/kolu dispatch loop's load-bearing verbs);
- **mutating tools**: `lifecycle_create` · `lifecycle_kill` ·
  `lifecycle_sendInput` (text XOR one named key — `Enter`, `Escape`, `C-c`
  chords — because submit is its OWN Enter after an observed settle, never
  text+newline fused).

kolu-cli (the composition root) owns the connect layer and injects the
connected client; `serveKoluMcp` here owns zero transport code. The e2e pin
(`kolu-cli/src/mcp.e2e.test.ts`) drives a real padi over both transports —
the unix socket and the ssh-shaped stdio pipe — plus the restart legs.

**A padi restart costs the agent nothing.** The injected connection carries
padi's close announcement, so the adapter discards a dead connection the moment
padi says the socket closed rather than by spending a request on it
([#2082](https://github.com/juspay/kolu/issues/2082) — the full story lives on
`OwnedSurfaceConnection.onClose`). Local socket arm only: `kolu mcp --host`
(ssh) does not carry the announcement yet, so a remote restart keeps the older
behaviour.

Plan of record: the kolu-cli Atlas note
([kolu.dev/atlas/kolu-cli.html](https://kolu.dev/atlas/kolu-cli.html)).
