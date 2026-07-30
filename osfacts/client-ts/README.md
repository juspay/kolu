<!--
  Maintainers (human or agent): this README is written per the /pg skill,
  house style "code spans + structure only" — no bold, no italics; headers
  and `code spans` do the scanning. Edit it through that voice.
-->

# osfacts-client

The TypeScript face of the [osfacts](../) binary. Spawn it at a path you
supply, refuse a schema version you do not speak, and hand back typed
process, listener, socket-holder, unreadable, source-error, and host rows.
Nothing more.

```ts
import { snapshotHost } from "osfacts-client";

const reading = await snapshotHost(process.env.OSFACTS_BIN!, {
  procs: true,
  uid: true,
  cwd: true,
  status: true,
  argv: true,
  cpuTime: true,
});
if (reading.errors.length > 0) {
  // This consumer rejects partial source failures; another may render them.
  throw new Error(JSON.stringify(reading.errors));
}
// reading.procs · reading.uids · reading.cwds · reading.statuses · reading.argv
```

No `@kolu` imports. No npm runtime dependencies — only `node:child_process`
and friends — so a second consumer can pin this package without dragging
kolu's monorepo graph. kolu (via padi and its daemon supervisor) and drishti
both ship it.

Policy about what a fact *means* — which blindness matters, whether to reject
or render a partial reading, what to do about a holder — is the consumer's,
not this package's. The one deliberate exception: where a verb's reading has a
single honest domain answer every consumer would otherwise hand-write the same
way, the FOLD ships here beside the parser (`processIdentity*` over the
start-time reading, `socketHolders`/`foldSocketOccupancy` over the holder
reading). Both keep an "absent" arm that must never collapse into the others,
which is exactly the mistake a per-consumer copy makes.

## What it does

- Spawn an exact-pid, subtree, or true host-wide process snapshot at a supplied
  absolute binary path.
- Gate on `V 2` — a mismatched format fails loudly.
- Parse every row; a line it cannot read is an error, never a skip.
- Return partial facts when one requested source is blind. The process exits
  successfully when other facts survived, keeps the source failure in
  `reading.errors`, and leaves reject-versus-render policy to the caller.
- Return the raw tables: process identity, uid, cwd, state/nice/thread count,
  full argv, RSS, start time, and cumulative user-plus-system CPU microseconds;
  listener rows with explicit
  claimed/unclaimed status and network-order hex addresses; host gauges and
  cumulative counters; unreadable facets; and source errors.
- Ask which processes hold a unix socket path. `socketHolders(bin, path, {
  procs: true })` returns a `SocketHoldersReading` whose `holders` are
  discriminated rows — `{ status: "claimed", pid }` or `{ status: "unclaimed"
  }` — so a bound socket nobody readable claims stays distinct from an empty
  answer, and a blind search stays distinct from both.
- Keep the three verbs apart. `snapshot*` returns a `SnapshotReading`,
  `socketHolders` a `SocketHoldersReading`, and `host` a `HostReading` —
  separate types, separate parsers, separate facet vocabularies. Feeding one
  verb's output to another's parser is a loud error, not a silently empty
  field, and `mem` can mean process RSS in one and host RAM in the other
  without a consumer matching across them by accident.
- Refuse a document the binary wrote while REFUSING the ask. The version line
  is written on the usage path too, so only exit 1 — the documented
  "V line, then E rows" total failure — is parsed. An older binary that lacks
  the verb you asked for exits 2, and reading that as "nothing found" is how a
  caller concludes a live socket is free.
- Name the facets an ask can be answered with. `snapshotFacetNames({ procs:
  true, ports: true })` returns
  `{ unreadable: ["proc", "ports"], source: ["proc", "ports",
  "ports_unclaimed", "ports_uid"] }` — the flag-to-wire-name map is not
  mechanical, so it lives here instead of being re-derived by every consumer.
  Which of those named facets counts as blindness is still the consumer's
  call.

## What it does not

- Read `KOLU_OSFACTS_BIN` (or any env) — the caller owns the path.
- Classify addresses into any / loopback / interface.
- Fold ports, rank scopes, or decide that a U row blinds a terminal.
- Spawn synchronously, or answer identity questions ("is this still the same
  process?"). That is a supervisor's gate policy, and it belongs beside the
  supervisor that owns it.
- Depend on zod, pino, or anything that is not a Node built-in.

## The facet vocabulary

`UNREADABLE_FACETS`, `SNAPSHOT_SOURCE_FACETS`, `SOCKET_HOLDERS_SOURCE_FACETS`,
and `HOST_SOURCE_FACETS` are not maintained by hand against the binary. `osfacts/facets.json` is checked in
beside the Rust crate, a Rust test pins it to the `Facet` enum that produces
every wire name, and `src/facets.test.ts` pins these three lists to the same
file. Adding a facet on one side without the other fails the unit lane on both
— it used to surface as `unknown unreadable facet` in a consumer's parse, at
runtime, on whichever platform emitted it.
