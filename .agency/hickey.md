# Kolu hickey catalog

Project-specific complecting patterns extending the `hickey` skill's Layer 4 catalog — read by `hickey` from this file (`.agency/hickey.md`) when it runs.

## Additional Complecting Patterns

These extend the hickey skill's built-in complecting catalog with patterns specific to this project's SolidJS + oRPC architecture.

| Construct                                                                                                            | What it complects                                            | Simpler alternative                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Imperative collection lifecycle in reactive framework (`Map` + `AbortController` + `createEffect` that diffs a list) | What + when + cleanup + identity tracking                    | `mapArray` / `indexArray` — framework manages per-item reactive owners and disposal                              |
| Manual subscription teardown (`AbortController` tracking per entity)                                                 | Lifecycle + state + identity                                 | Reactive owner disposal via `onCleanup` inside `mapArray` or `createRoot`                                        |
| Version-counter signals to force reactivity (`[version, setVersion] = createSignal(0)`)                              | Reactivity tracking + state + workaround for broken tracking | Fix the tracking root cause — use reactive primitives (`mapArray`, `createMemo`) that SolidJS can track natively |
| Dual stores for one concern (local `createStore` + subscription/query for same data)                                 | Value + time + two sources of truth                          | Single reactive source; only justify dual stores when async round-trip latency is measurable (>16ms)             |
| `createEffect` that writes to signals/stores (effect-as-state-machine)                                               | When + what + control flow                                   | `createMemo` for derived values, `mapArray` for per-item derivations, `on()` for explicit dependency tracking    |
