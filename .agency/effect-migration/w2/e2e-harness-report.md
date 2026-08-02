# W6 — the e2e harness on the real Effect RPC wire

The harness was the last oRPC remnant. It drove kolu-server through the DELETED HTTP
arm (`POST /rpc/surface/<sibling>/<member>/<verb>` with a `{ json: … }` body), so every
worker's `BeforeAll` died on an HTTP 404 at `waitForPadiLive`. This is the record of
what replaced it — and of the three PRODUCT defects a working e2e immediately exposed,
none of which any unit or typecheck lane could see.

---

## 1. `packages/tests/support/rpcWire.ts` — one Node-side caller

A single module that dials the server over the REAL websocket path and issues calls by
wire tag. It is built on the product's own stack, not on a parallel test transport:

| piece | source |
| --- | --- |
| the dial | `websocketLink` (`@kolu/surface/links/websocket`) — the same link `packages/client/src/wire.ts` dials |
| the URL | `/rpc/ws`, derived from the worker's http base (the browser's path, spelled once) |
| terminal-close vocabulary | `isStaleProcessClose` (`@kolu/surface-app/connect`) — the classifier the browser's link gets |
| the group | `koluSurfaceGroup.merge(padiHostMap.group)` — the same two sources `server/src/surface.ts` merges into `servedGroup` |
| the padi fold | `fold()` (`@kolu/surface-map`) — the ONE envelope encoder, spelled here once (`support/padiEnvelope.ts` is deleted; its `PADI_HOST_KEY` derivation moved in verbatim) |

Public face:

```ts
setRpcBaseUrl(url)      // point the shared wire at a server (disposes a wire on another URL)
disposeRpcWire()        // AfterAll
surfaceCall(tag, payload?, { timeoutMs })       // any sibling member by wire tag
padiCall(memberVerb, input?, { timeoutMs })     // surface/padi/<memberVerb>, {mapKey,input}-folded
padiFirstFrame(memberVerb, input?, …)           // one snapshot off a padi cell `get`, then unsubscribe
RpcCallFailed / isPadiWarmingUp                 // the classification callers retry on
```

**Lifetime.** ONE wire per cucumber worker, re-dialled whenever `baseUrl` moves (a
worker reboots its server on a fresh random port after `@kaval-restart`). `AfterAll`
disposes it, so no socket outlives the run — the link owns fibers that only `dispose`
releases.

**Payloads are the ENCODED side.** `SurfaceDispatch` takes the DECODED (`Type`) side, so
`decodePayload` decodes each call through `group.requests.get(tag).payloadSchema` first
— the exact edge the typed client face owns. Two consequences: every ported call site's
body stays byte-identical to the JSON it used to POST, and a member's DECODING DEFAULTS
still apply (padi's `lastActivityAt` backfills to `null`), so a saved-session fixture may
omit an optional field exactly as it always could. A mistyped tag also fails there,
naming the tag, instead of dying as an opaque defect inside Effect RPC's flat client.

**Bounded calls.** The link retries a dial forever in its own fiber, so a call against a
dead server would park. Every call carries a timeout (an `AbortSignal` the runtime turns
into fiber interruption, which tears the in-flight request down).

**The retry/permanent split**, ported faithfully from `waitForPadiLive`'s HTTP form. The
old rule was "poll on 503, fail on anything else". `isPadiWarmingUp` restates it on the
wire's vocabulary — retry on:

- a TRANSPORT failure (`RpcClientError`, via `@kolu/surface/client`'s `isTransportError`)
  or a per-call timeout;
- `MapKeyUnknown` — the host pool has not seeded the key yet;
- a defect named `UpstreamUnavailableError` — `reServeSurface`'s "no live upstream link",
  which IS what used to be answered as 503. It crosses as a defect, and Effect's defect
  codec preserves an `Error`'s `name`, so the class's identity is what is matched, never
  its prose.

Everything else — a declared procedure error, a schema rejection, a `MapEntryFailed`
terminal fault — is permanent and surfaces immediately, as a non-503 status did.

### Sites ported

`support/hooks.ts` (the `killAll` liveness probe, the activityFeed/session resets, the
`newTerminalPolicy/get` cell read, the `kolu/preferences/test__set` reset),
`step_definitions/{inherit_size,sleeping_terminals,sub_terminal,session_restore,canvas}_steps.ts`,
and `screencast/recordings/helpers.ts` (which had been reaching the RPC through
`page.evaluate(fetch)` with a hand-computed envelope — now a plain Node-side `padiCall`).

`postJSON` / `postJSONOnce` are DELETED: every caller was an RPC. So are the SSE
readers `readCellFrame` / `decodeEventFrame` (a cell `get` is a `Stream` now), and
`HttpStatusError` / `BoundedErrorBody` in `scenarioSetupRetry.ts`, whose only reason to
exist was the HTTP arm. `retryTransient`'s guard is now "an `RpcCallFailed` is an
ANSWERED call, so it never retries" — the same shape the completed-HTTP-response guard
had. `httpGet` stays (the non-RPC `/health` ownership probe).

Two zod-era calls that would have thrown `TypeError` the moment they ran are gone:
`NewTerminalPolicySchema.parse` (the wire already decodes that frame against the cell's
own schema — re-parsing would be a second, drifting copy of the authority) and
`SavedSessionSchema.nullable().parse` in `session_restore_steps.ts` (now
`Schema.decodeUnknownSync`).

---

## 2. The three product defects a working e2e exposed

### D1 — the browser could not dial padi OR the root procedures at all

`connectSurfaces` derived the wire's `RpcGroup` from `surfaces` ALONE. kolu multiplexes
two further tag namespaces on that same wire and reaches neither through
`clients.<key>`: the padi HOST MAP (`connectSurfaceMap(padiHostMap, conn.transport)` —
the composition `connectSurfaces`' own doc-comment recommends) and the hand-written root
procedures (`rootProcedures(conn.transport.dispatch)` → `server/*`, `daemon/*`,
`hosts/*`). Effect RPC's flat client resolves a call's payload/success SCHEMAS by looking
its tag up in the group the wire was built over, so a tag absent from that group cannot
be dispatched at all. The wire connected, and every `surface/padi/*` and `hosts/*` call
died. The app painted "kolu can't see this host yet".

Fix: `connectSurfaces` gains `extraGroups?: ReadonlyArray<RpcGroup<Rpc.Any>>`, merged
into the dialled group. `RpcGroup.merge` is a last-writer-wins `Map.set` with no
collision detection, so the merge COUNTS the result and throws when a collision swallowed
a tag — the client twin of `servedGroup`'s assertion. kolu passes
`[koluRootGroup, padiHostMap.group]`.

### D2 — after any reconnect the app stayed "disconnected" forever

`websocketLink` published `WireStatus` from the RAW socket's `open`/`close` events.
Effect's socket protocol latches a `currentError` when a run ends and clears it in its
own connect hook; until that clear, every `send` fails IMMEDIATELY with the previous
close. The raw `open` listener (registered inside `acquire`, ahead of the protocol's)
fired BEFORE that clear — so `createServerLifecycle`, which probes the server's identity
on the `open` EDGE, issued its probe into a still-poisoned protocol, got the stale
`SocketCloseError: 1000`, and correctly declined to transition. Nothing fires `open`
again, so the header dot sat red and `data-ws-status` read `closed` after every
successful reconnect.

Fix: publish the status from the protocol's `RpcClient.ConnectionHooks`
(`onConnect`/`onDisconnect`) instead. `open` now MEANS "the protocol can send", which is
what every edge consumer already assumed. The socket's own `close` listener stays — it is
where the terminal-close CLASSIFIER reads the close code — but no longer publishes. A
clean 1000 close still reaches `onDisconnect` (the protocol turns a clean end into a
failure), so the closed/retired edge is as observable as before.

### D3 — NOT FIXED: the degraded-kaval canvas never appears (out of scope)

Killing the kaval daemon mid-session no longer paints `DegradedCanvas`. Reproduces
independently of the harness work in `features/kaval-daemon.feature`
(**2 of 4 scenarios fail**: "killing kaval mid-session shows the honest degraded canvas"
and "restarting a degraded kaval spawns a fresh daemon, keeps padi up, and preserves the
session"), and it is the ONE remaining failure in `features/session-restore.feature`
("A split terminal's agent resumes on session restore", which is `@kaval-restart`-tagged
and waits on the same surface). The page's only signal is
`Exit stream error: @kolu/surface/SurfaceStdioTransportClosed … the peer process exited`
— padi's stdio leg to kaval dying, as expected — with no daemon-status transition behind
it. `downState()` is floored on `daemonChannelLive()`, so the suspect is that leg, not
`DegradedCanvas` itself. Left for a W-item that owns the daemon-status surface.

---

## 3. `canvas_steps.ts` — the `/rpc/ws` mock filter

**Verdict: the URL is CORRECT, the frame reader was stale.** `/rpc/ws` is still exactly
what `packages/server/src/index.ts` upgrades and what the browser dials, so the
`String(url).includes("/rpc/ws")` filter needed no change.

What WAS dead is everything after it. The `session.get`-delay interceptor read the oRPC
websocket envelope — a length-delimited JSON header with `msg.p.u` (a URL) and `msg.t ===
3` (EVENT_ITERATOR). Under Effect RPC the frames are `RpcSerialization.layerNdjson`:
newline-delimited JSON, a request being `{_tag:"Request", id, tag, payload}` and a stream
frame `{_tag:"Chunk", requestId, values}`. The old reader matched NOTHING, so the delay
never applied and the scenario passed without ever forcing its race — a vacuous
assertion. Rewritten against the ndjson shapes, matching on `tag ===
"surface/padi/session/get"`.

---

## 4. `reconnect_steps.ts`

Two real defects in the steps themselves, both of the "unconditional pass or mystery
timeout" kind:

- **the drop step read `status()` synchronously after `forceReconnect()`.** That call
  does `ws.close(1000)`, and the browser delivers the `close` on a LATER task, so the
  read always saw the stale `"open"` and the step always failed. Polling for the non-open
  window from Node would race straight through it (the link re-dials ~500 ms later), so
  the step now ARMS an `onStatus` recorder before severing — which cannot miss the
  transition — and waits on the recorded flag. It also waits for a provably `open` wire
  first, because `forceReconnect()` is a no-op while a re-dial is in flight (otherwise
  the step could "pass" by severing nothing).
- **`waitForWsStatus` reported only "timed out".** It now quotes what the header read AND
  what the transport under it read. That is the diagnostic that located D2 in one run
  (`the header read "closed" while the wire read "open"` — the two halves disagreeing is
  the whole bug).

---

## 5. Gates

| gate | result |
| --- | --- |
| `packages/tests` typecheck | **N/A** — kolu-tests has no `tsconfig.json` and no `typecheck` script (it is transpiled by `tsx`, never compiled). Nothing to run. |
| `pnpm typecheck` (workspace) | exit 0 |
| `pnpm test:unit` (workspace) | exit 0 |
| `pnpm test:unit` (kolu-tests) | 30 pass, 0 fail |
| `just test-quick features/reconnect.feature` | **1 scenario passed, 8 steps passed** |
| `just test-quick features/kill.feature` | **6 scenarios passed, 49 steps passed** |
| `just test-quick features/session-restore.feature` | **8 of 9 scenarios passed, 73 of 83 steps** — the 1 failure is D3 above |
| `pnpm install --frozen-lockfile` | exit 0 |
| `nix build .#pnpmDeps --no-link` + `--rebuild` | both pass; the hash is UNCHANGED (the added deps are workspace links plus `effect`, already in the fetched closure) |
| `biome lint --error-on-warnings` (tests, client, surface, surface-app) | clean |
| `grep "/rpc/surface"` across the repo | zero fetch sites (one mention, in this module's own header, explaining what was deleted) |

## 6. Follow-ups this leaves open

- **The drishti pair-PR gate applies.** D1 and D2 are API-facing changes to
  `@kolu/surface-app` (`connectSurfaces`' `extraGroups`) and `@kolu/surface`
  (`websocketLink`'s status source). Both Reference pages are updated in this change
  (`ref-surface-app.mdx`, `ref-surface.mdx`), but a paired drishti PR pinned to final
  kolu HEAD is still required per `.claude/rules/surface.md`. Drishti dials
  `connectSurfaces` for its admin wire and a per-host map — if it multiplexes them on one
  wire, **it has D1 too**.
- **The odu-impact verdict** for `connectSurfaces` / `websocketLink` still needs its grep
  at odu's pinned kolu SHA.
- **D3** — the degraded-kaval surface.
