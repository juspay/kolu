/**
 * `ClientErrorPolicy` — kolu's app-owned client-error-policy union (SR11, fork-A).
 *
 * The framework (`@kolu/surface`) deliberately does NOT own the arm vocabulary — a
 * policy is an OPAQUE, app-typed value the framework threads to the app's registered
 * interpreter (`onClientError`) but never reads (the same member interpreted OPPOSITELY
 * by two apps: kolu toasts, drishti logs). So kolu declares its OWN closed union HERE.
 *
 * ── Why this DATA-only vocabulary lives in `@kolu/padi`, not `kolu-common` ────
 * The FULL union (the origin-bearing `hostToast`/`scopedSub` arms) is declared on
 * `padiSurface`'s per-host entry members, IN `packages/padi/src/surface.ts`. That file
 * is `@kolu/padi`-internal and the package seal forbids it importing `kolu-common` (the
 * arrow points `kolu-common → @kolu/padi`, never back). So the union it references must
 * live in a module `@kolu/padi` can import — here, its own browser-safe surface vocab.
 * `kolu-common/surface` RE-EXPORTS it (the established `kolu-common → @kolu/padi` edge)
 * so `koluSurface` and the kolu client reach it through their usual door. Pure types —
 * no runtime — so this stays browser-safe like the rest of `@kolu/padi-client/surface`.
 *
 * The ONE interpreter (`interpretClientError`, kolu client `wire.ts`) is `satisfies
 * never`-fenced over these arms; the per-scope subsets below make an origin-requiring
 * arm UNSPELLABLE on a root surface (F8).
 */

/** kolu's client-error-policy arms. The interpreter renders:
 *   - `toast`     → `toast.error(`${label} error: ${msg}`)` (origin-free);
 *   - `hostToast` → `toast.error(`Host ${hostLabel(origin.key)} ${label} error: ${msg}`)`;
 *   - `scopedSub` → active host: `toast.error(`${label}: ${msg}`)`,
 *                   background: `console.error(`createHostWire: background ${label} …`)`. */
export type ClientErrorPolicy =
  | { kind: "toast"; label: string }
  | { kind: "hostToast"; label: string }
  | { kind: "scopedSub"; label: string };

/** The `toast`-only subset (F8) — the policy a ROOT surface (`koluSurface`,
 *  `surfaceApp` buildInfo) instantiates, so `hostToast`/`scopedSub` (which need a
 *  per-host `origin`) are UNSPELLABLE on a root member that has no host. */
export type ToastOnlyPolicy = Extract<ClientErrorPolicy, { kind: "toast" }>;
