# @kolu/surface-daemon

The **durable-daemon spine** — the daemon *binary* half every long-lived process
that owns a unix socket and serves a typed [`@kolu/surface`](../surface) repeats.
**Serve it**: a pid-gated single-instance entry with a `gate → serve → teardown`
skeleton (`daemonMain`), a lifetime policy, and a bin half (`daemonProcessMain`)
that owns the process exit. **Front it** over ssh-stdio so a
remote session outlives the link (`frontDaemonOverStdio`). Plus the shared
daemon-identity recipe (`readBakedIdentity`), the frozen identity/drain fragment
(`controlCoreFragment`), and an app-independent mixed-version test kit at
`./upgrade-window.testlib`. It depends on the shared `@kolu/surface` framework
and `ts-pattern` for exhaustive fixture dispatch, but on no app package;
the client half lives in [`@kolu/surface-daemon-supervisor`](../surface-daemon-supervisor).

`controlCoreSurface` is the standalone frozen contract;
`controlCoreProcedureSpec` is the composition seam for a daemon retaining
legacy siblings; the schema/type exports describe that wire. The frozen
fragment never versions *within a protocol epoch* — the Effect-4 framing change
was a declared flag day, not a negotiation (see `controlCore.ts`'s header). The testlib groups
the injected yesterday-daemon fixture, registry/watchdog helpers, bidirectional
previous-release harness, process reaper, shape-recovery pin, and CI recipe pin;
the [reference](https://kolu.dev/surface/ref-surface-daemon) maps every export.

```ts
import {
  controlCoreFragment, controlCoreSurface, daemonHome, daemonMain,
  daemonProcessMain, stderrLogger,
} from "@kolu/surface-daemon";

const home = daemonHome({ app: "my-daemon", placement: "state" });
const control = controlCoreFragment({
  stateRoot, surfaceVersion: CONTRACT_VERSION, startedAt, commit, buildId, onDrain,
});
const runtime = implementSurfaces(
  { app: surface, control: controlCoreSurface },
  {},
  { app: appDeps, control },
);
daemonProcessMain({
  name: "my-daemon",
  run: () => daemonMain({
    home,
    group: runtime.group,
    handlers: runtime.handlers,
    lifetime: { kind: "forever" },
    log: stderrLogger(),
  }),
});
```

Part of the kolu monorepo — `"@kolu/surface-daemon": "workspace:*"`.

## Docs

- Tutorial — [Make it a daemon](https://kolu.dev/surface/make-it-a-daemon)
- How-to — [Bake an identity](https://kolu.dev/surface/bake-an-identity)
- Nix — the `nix/` recipes (`mkDaemonIdentity`, `mkWorkspaceClosure`, `mkProvenAgentSource`): [Bake an identity](https://kolu.dev/surface/bake-an-identity#2-derive-the-fileset--dont-list-it)
- Reference — [@kolu/surface-daemon](https://kolu.dev/surface/ref-surface-daemon) · [Daemon invariants](https://kolu.dev/surface/surface-daemon-invariants)
- Explanation — [The daemon spine](https://kolu.dev/surface/the-daemon-spine)
