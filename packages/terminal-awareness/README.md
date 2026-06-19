# @kolu/terminal-awareness

**The per-terminal awareness provider set** — the code that watches one terminal
and derives _what it is in_: its git branch + dirtiness, the open PR and its
checks, which AI coding agent is running and whether it's _working_ or _waiting
on you_, and the foreground process. Plus the generic `AwarenessValue` schema
those providers produce.

It is the awareness layer lifted out of `kolu-server` (P1a of the
[`arivu`](../../docs/atlas/src/content/atlas/arivu.mdx) plan), so the exact
provider code kolu runs in-process today can be reused **unchanged** by a
standalone daemon (`arivu`) that dials a remote host's
[`kaval`](../kaval/) over ssh.

## What it owns

- **The provider set** (`providers.ts`) — a per-terminal DAG of observers (git ·
  PR · agent ×3 · foreground · agent-command tracker), parameterized over
  `ProviderChannels` (the host's raw VT taps) + `ProviderHooks` (how the host
  persists/publishes the result), so the **host is the only thing that varies**.
  `startProviders(record, id, channels, hooks, log)` wires them all up for one
  terminal and returns a teardown.
- **The awareness schema** (`schema.ts`, exported as
  `@kolu/terminal-awareness/schema`) — `AwarenessValue` and its persisted/live
  halves, composed from the vendor-neutral leaf schemas (`anyforge` · `kolu-git`
  · `kolu-github` · the per-agent packages). The split half-types
  (`AwarenessPersistedFields` / `AwarenessLiveFields`) are the write fence:
  persisted fields arm autosave, live fields don't.

## What it knows nothing about

It names **no kolu-app package**. Its lone host coupling — a logger — is
_injected_ as a `startProviders` parameter, never imported. It doesn't know how
a host persists metadata (that's `ProviderHooks`), where the terminal lives
(kolu's `location` is _not_ in `AwarenessValue` — `kolu-common` adds it on top),
or any wire protocol. Two homes consume it:

- **`kolu-server`** imports the providers (`.`) and runs them in-process,
  writing its `terminalMetadata` directly.
- **`arivu`** (P1b) imports the same providers, dials `kaval` as a client, and
  serves the `AwarenessValue` slice over a surface.

Two entry points keep the boundary honest: `.` pulls the providers (node ·
`kaval` runtime); `./schema` is pure `zod`, safe for the client bundle.
