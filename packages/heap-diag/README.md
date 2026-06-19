# @kolu/heap-diag

The **opt-in heap-instrumentation receptacle** for any kolu-family Node process — the interim instrument behind the kaval heap-OOM fix ([`kaval-heap-oom.mdx`](../../docs/atlas/src/content/atlas/kaval-heap-oom.mdx)).

One volatile capability lives here once: *given a process and a way to count its subsystem sizes, when `KOLU_DIAG_DIR` is set, emit a T+0 anchor sample, a periodic memory/counts curve, and one safe baseline heapsnapshot at T+5min — with `unref` hygiene, paired with the V8 near-limit snapshot armed by the Nix wrapper.* Unset = the module does nothing.

The three genuinely host-specific axes are parameters, not copies:

- `extraColumns: () => Record<string, number>` — the subsystem counters that climb with the leak (server: `terminals`/`publisherSize`/`claudeSessions`/`pendingSummaryFetches`; kaval: `terminals`).
- `snapshotPrefix` — the baseline-snapshot **file** basename (`"baseline"` → `baseline.heapsnapshot` for the server, `"kaval-baseline"` for kaval).
- `logPrefix` — the **log event-name** stem, deliberately separate from the file basename so each host owns its grep/alerting contract: the server passes `"diag"` to preserve its long-standing `diag_enabled` / `diag` / `diag_baseline_snapshot_*` events; kaval passes `"kaval_diag"`.

Everything else — the cadence, the baseline-snapshot safety reasoning, the env gate, the `unref` hygiene — is shared, so a change to any of it is a one-file edit for every consumer. A leaf with a single types-only workspace dep (`@kolu/log`, the canonical `Logger`), so kaval and kolu-server both rest on it without dragging app code daemon-side.

```ts
import { startHeapDiagnostics } from "@kolu/heap-diag";

startHeapDiagnostics({
  log,
  snapshotPrefix: "kaval-baseline",
  logPrefix: "kaval_diag",
  extraColumns: () => ({ terminals: terminalCount() }),
});
```
