# @kolu/log

The one structured-logging contract for the workspace: a `Logger` type and
nothing else at runtime. Zero dependencies.

| Entry | What it holds |
| --- | --- |
| `.` | `Logger` — `debug`, `info`, `warn` and `error`, each `(obj, msg) => void`. |
| `./loggerStubs.testutil` | `silentLogger`, which drops every line, and `collectLogger(onLine)`, which funnels each level's `line` field to one sink. |

The shape is structurally compatible with [pino](https://getpino.io) child
loggers, so `pinoLogger.child({…})` passes anywhere a `Logger` is wanted, with
no adapter. Where a logger may be absent, accept `Logger | undefined` and call
`log?.info(…)`.

Levels: `debug` for expected-absent conditions, `info` for lifecycle events an
operator cares about, `warn` for degraded but recoverable states, `error` for
real failures.

Depended on by most server-side packages, among them `kolu-server`,
`kolu-shared`, `@kolu/surface`, `@kolu/surface-daemon`, `@kolu/surface-remote`,
`@kolu/padi`, `kaval`, `kolu-transcript-core` and several integrations.

## What not to break

- No runtime dependency and no `kolu-*` dependency. Leaf packages that refuse to
  depend on `kolu-shared` import the `Logger` from here instead of redeclaring
  it, and that only works while this package stays weightless.
- The stubs stay on the `./loggerStubs.testutil` entry, so no production build
  pulls test fixtures in.
- The four methods keep the `(obj, msg)` argument order. Reversing it breaks
  pino compatibility silently.
