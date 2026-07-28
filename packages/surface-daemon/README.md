# @kolu/surface-daemon

The **durable-daemon spine** — the daemon *binary* half every long-lived process
that owns a unix socket and serves a typed [`@kolu/surface`](../surface) repeats.
**Serve it**: a pid-gated single-instance entry with a `gate → serve → teardown`
skeleton (`daemonMain`), a lifetime policy, and a bin half (`daemonProcessMain`)
that owns the process exit. **Front it** over ssh-stdio so a
remote session outlives the link (`frontDaemonOverStdio`). Plus the shared
daemon-identity recipe (`readBakedIdentity`). A zero-`kolu-*`-dependency package;
the client half lives in [`@kolu/surface-daemon-supervisor`](../surface-daemon-supervisor).

```ts
import {
  daemonHome, daemonMain, daemonProcessMain, stderrLogger,
} from "@kolu/surface-daemon";

const home = daemonHome({ app: "my-daemon", placement: "state" });
daemonProcessMain({
  name: "my-daemon",
  run: () => daemonMain({
    gatePath: home.gatePath,
    socketPath: home.socketPath,
    router,
    lifetime: { kind: "forever" },
    anchor: () => home.dir,
    log: stderrLogger(),
  }),
});
```

Part of the kolu monorepo — `"@kolu/surface-daemon": "workspace:*"`.

## Docs

- Tutorial — [Make it a daemon](https://kolu.dev/surface/make-it-a-daemon)
- How-to — [Bake an identity](https://kolu.dev/surface/bake-an-identity)
- Reference — [@kolu/surface-daemon](https://kolu.dev/surface/ref-surface-daemon) · [Daemon invariants](https://kolu.dev/surface/surface-daemon-invariants)
- Explanation — [The daemon spine](https://kolu.dev/surface/the-daemon-spine)
