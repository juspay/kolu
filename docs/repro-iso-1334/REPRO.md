# Reproduction — #1334 + #1375 host isolation

Two safe, isolated reproductions of the "kolu dev/test kills production kolu"
class. Both ran with **production kolu `inactive`** on the box (`systemctl --user
is-active kolu` → `inactive`); the #1334 repro additionally uses a fake
`$HOME`/`$XDG_RUNTIME_DIR` so nothing real is ever touched.

---

## #1334 — a dev/test process with no isolation env reaches PRODUCTION daemon state

**Mechanism.** A daemon's identity is *only* its state-root path digest
(`padiDigest = sha256(resolve(stateRoot)).slice(0,16)` →
`$XDG_RUNTIME_DIR/padi-<digest>/`, `kaval-<digest>/`). The server's `KOLU_STATE_DIR`
already fail-fasts when unset, but `resolvePadiStateRoot()` **silently defaults**
to `$HOME/.local/state/padi`. So a bare `pnpm dev` / `vitest` / `padi` with no
`KOLU_PADI_STATE_DIR` resolves **production's exact digest** — and the adopt/kill
machinery (`surface-daemon-supervisor/src/endpoint.ts`) then **adopts** that live
daemon (`adoptOrEnsure`, stealing its PTYs) or **SIGTERMs** it (any `restart` /
reconcile-failure `ensure()` always-recycle path). Nothing refuses the crossing —
there is no production marker anywhere in the adopt/kill paths.

**Repro (run from `packages/server`, which legitimately imports `@kolu/padi/assembly`):**

```ts
// isoRepro.repro.test.ts — throwaway; stands up a DISPOSABLE "production" padi
// under a fake $HOME + $XDG_RUNTIME_DIR (a real listening socket + a live gate
// pid = the test process + a state-root manifest), then puts on the dev/test hat.
process.env.HOME = fakeHome;               // temp dir
process.env.XDG_RUNTIME_DIR = fakeXdg;     // temp dir
delete process.env.KOLU_PADI_STATE_DIR;    // ← the whole point: no isolation

const prodRoot = resolvePadiStateRoot();               // = $HOME/.local/state/padi
await listen(padiSocketPath(prodRoot));                // disposable prod padi socket
writeFileSync(padiGatePath(prodSocket), `${process.pid}\n`);      // LIVE gate holder
writeFileSync(join(dirname(prodSocket), "state-root"), `${prodRoot}\n`);

// dev/test hat — a fresh resolution with no isolation:
const devRoot  = resolvePadiStateRoot();
const adopted  = residentPadiSocket(devRoot);          // what a dev binder would adopt

expect(devRoot).toBe(prodRoot);                        // ✅ dev computes prod's identity
expect(padiKavalSocketPath(devRoot)).toBe(padiKavalSocketPath(prodRoot));
expect(adopted).toBe(prodSocket);                      // ✅ dev is HANDED the prod padi
```

**Captured output (all assertions of the buggy invariant hold):**

```
[repro] prodRoot=…/iso-1334-repro-Q1h3JG/home/.local/state/padi
        devRoot =…/iso-1334-repro-Q1h3JG/home/.local/state/padi
        adopted =…/iso-1334-repro-Q1h3JG/xdg/padi-166c4a17b66a292f/padi.sock
 ✓ #1334: dev/test with no isolation env adopts the production padi
```

`devRoot === prodRoot`, `devKaval === prodKaval`, and `residentPadiSocket()` hands
the dev/test process **the production padi socket** as an adopt candidate. Combined
with the adopt/kill map, that is the kill-prod mechanism.
