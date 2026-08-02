# W5 — `packages/kolu-cli` on the Effect client tier

Scope: `src/connect.ts`, `src/hostConnect.ts`, `src/mcp.ts`, `src/mcp.e2e.test.ts`.
`src/cli.ts`, `src/main.ts`, `src/cli.test.ts`, `src/mcp.test.ts` are unchanged —
the argv parse and the face dispatch never touched the wire.

Starting position (recon/consumers.md): kolu-cli had **zero** `@orpc` imports and zero
`zod`. It still does, and no `package.json` edit was needed. The whole change is
adapting to three shape changes in what it consumes.

---

## 1. The retry mount is deleted, not ported

`mountStreamRetry` — the 40-line `Proxy` that attached the `STREAM_RETRY` plugin
context to every streaming `get`/`keys` on the padi client — is **gone**, along with
its `padiSurface`-spec-derived `STREAMING_KEYS` / `STREAMING_VERBS` sets. Nothing
replaced it. Three independent reasons, all from S3:

1. **There is no per-call context to attach.** `StreamingProcedure` is now
   `(input) => Stream<O, unknown>`; the second `{ signal, context }` argument does
   not exist. The proxy still *typechecked* on the migrated tree (its leaf was cast
   to `(i, o) => unknown`) while being semantically dead — a silent no-op, which is
   exactly the shape a migration must not leave behind.
2. **The fence moved to the stream's consumer.** `STREAM_RETRY` is a
   `Schedule`, applied by `fenceStream` / `unenrolledStreamCall`. padi's own watch
   kit (`@kolu/padi/dial`'s `watchTerminals` / `awaitAgentState` /
   `awaitOutputSettled`) already calls `unenrolledStreamCall`, so the two composite
   MCP wait tools get the fence from the kit that owns them — not from a wrapper the
   composition root re-derives from padi's spec.
3. **On these transports it would fence nothing.** `shouldRetryStreamError` is a
   positive match on `RpcClientError` (plus `SurfaceRelayTransportLost`). Both of
   kolu-cli's transports are reconnect-free by construction: `unixSocketLink` and
   `stdioLink` replace the transport failure with `SurfaceStdioTransportClosed`,
   which the fence deliberately refuses (re-dialling the same dead fds is
   meaningless). A dead transport therefore surfaces as the tool call's error and the
   MCP adapter re-invokes the connect factory — the redial IS the restart discipline.

The reasoning is recorded in `connect.ts`'s header so the next reader does not
"restore" the mount.

**Net behaviour delta:** under oRPC a *mid-stream blip on a surviving socket*
re-subscribed transparently. That class of event does not exist on a unix-socket /
stdio link (the link dies with its pipe or it does not), so the delta is empty in
practice. Leg 3 of the e2e — a real padi SIGTERM'd mid-subscribe — still passes:
the in-gap tool call fails typed, the redial heals, the subscribed resource re-seeds.

---

## 2. `hostConnect.ts` — the remote face is built from the dispatch

`dialPadiViaHost` returns an `AgentDial` whose `client` is the erased structural
`SurfaceFace` (D2/#16: `dialAgentOnce` is surface-generic, so per-member precision
cannot live in the connector). `scopePadiSurface(dial.client)` no longer typechecks.

Chosen fix: `scopePadiSurface(padiClientOver(dial.dispatch))` — re-derive padi's
sibling faces from **padi's own surface values** over the same wire, rather than
casting the connector's erased face. No `as unknown as`, and the tags can only agree
with what the daemon serves. This is the swap `padi/src/dial.ts:324` predicted
("If `AgentDial` ever carries the dispatch, swap this for `padiClientOver(...)`").

`AgentDial.dispatch` is optional (it is a property of the transport, not of the dial
role). kolu-cli treats `undefined` as the **loud error it is** — dispose and throw —
never a degraded mode. `packages/padi-tui/src/hostConnect.ts` has the identical
line and will want the identical fix.

---

## 3. `mcp.ts` — the supervisor import

`instanceof DaemonContractSkewError` → `isContractSkewError(err)`, the supervisor's
own brand check. Its doc states the reason: the predicate holds across
module-instance / realm boundaries, where `instanceof` against one realm's class
silently fails. Misrouting a real skew into the retryable arm would make an agent
retry forever against a daemon that can never become compatible — the exact failure
`guardedMcpConnect`'s two arms exist to prevent. `mcp.test.ts` (unchanged) still
pins both arms.

### `unspeakable-protocol` — reachability, and a flagged gap

D6/#3's third convergence observation is raised **only** on the supervisor's own
probe path (`readControlCoreHello`'s ndjson framing tap in
`probeDaemonIdentity.ts`), corroborated in `endpoint.ts`, folded in `converge.ts`.
It does **not** reach a CLI dial: `kolu mcp` goes through padi's
`connectPadi` → `dialPadiHello`, which catches any handshake failure and rethrows a
plain `Error("padi handshake failed — could not read control.core.hello (…)")`.

So a previous-epoch padi is reported by `kolu mcp` through the **retryable**
`padi transport down:` arm, when it is in fact permanent. No arm was added here for
it, because an arm that cannot fire is dead code. **Follow-up (padi, not kolu-cli):**
have `dialPadiHello` preserve a first-frame decode failure as
`UnspeakableProtocolError` instead of flattening it to a plain `Error`; kolu-cli then
grows a third arm (loud, non-zero, "upgrade" line) keyed on
`isUnspeakableProtocolError`, alongside the skew arm. Filed rather than guessed.

---

## 4. `mcp.e2e.test.ts` — link API port

Mechanical, no assertion weakened, no scenario renamed:

| was | now |
|---|---|
| `unixSocketLink<PadiDaemonContract>({ socketPath })` | `unixSocketLink({ group: padiDaemonGroup, socketPath })` |
| `stdioLink<C>({read, write})` (sync, returns client) | `await stdioLink({ group: padiDaemonGroup, read, write })` (returns `WireLink`) |
| `conn.client.surface.control.core.hello()` | `padiClientOver(link.dispatch).control.surface.core.hello()` |
| `conn.client.surface.padi.lifecycle.recycleKaval(…)` | `padiClientOver(link.dispatch).padi.surface.lifecycle.recycleKaval(…)` |
| `mountStreamRetry(scopePadiSurface(x))` | `scopePadiSurface(x)` |

The flat wire namespace is why the two faces are built over ONE dispatch rather than
nested under one client. `UnixSocketConnection` no longer exists; the local alias
`PadiLink = Awaited<ReturnType<typeof unixSocketLink>>` stands in, because
`@kolu/surface` exports no `./links/wire` subpath.

One substantive addition: leg 2's stdio link is now **disposed in a cleanup**. A
`WireLink` owns protocol fibers and `dispose()` is the only thing that frees them —
under oRPC the child's death covered it; it no longer does.

---

## 5. Gates

- `pnpm --filter kolu-cli typecheck` — green.
- `pnpm --filter kolu-cli test:unit` — green (12 passed, 3 skipped = the
  daemon-gated e2e).
- `biome lint --error-on-warnings packages/kolu-cli` — clean; `biome format --write`
  scoped to the package.
- **Beyond the required gates:** the daemon-gated e2e was run for real, inside the
  nix devshell, `KOLU_DAEMON_TESTS=1` — **3/3 passed in 17.5 s**. That is a real
  spawned padi (spawning its own kaval and PTYs), a real MCP client, both transports,
  plus the restart leg. It is the strongest available proof that the deleted retry
  mount was not load-bearing.

## 6. Public API / consumer notes

- `mountStreamRetry` is **deleted** from `kolu-cli`'s module surface. It was internal
  (the package is a binary, not a library) — no external consumer.
- `KoluCliConnection` is unchanged in shape; its `client` is the new
  `PadiSurfaceClient` (read face + collection reads + procedures, encoded-in /
  decoded-out), which `kolu-mcp`'s `KoluMcpConnection` already names.
- No `package.json` change. `effect` and `@effect/platform-node` were already
  declared (W1.5) and are still not imported directly by this package — every Effect
  value it touches arrives through `@kolu/padi/dial`. Left alone: removing them is
  W6's dependency sweep, and `nix/workspace.nix` / `default.nix` stableLeaves would
  have to move with it.
