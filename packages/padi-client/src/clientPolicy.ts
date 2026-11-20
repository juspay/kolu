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
