/**
 * The pure `SessionState.connection` → `padiLink` cell mapping.
 *
 * kolu-server's OWN shell surface owns the client's honest view of its binding to the
 * local padi (#1034): padi cannot serve its OWN unreachability, so kolu-server maps the
 * bound padi session's connection phase onto koluSurface's `padiLink` cell and the
 * client folds THAT into the warming/degraded canvas — a padi drop then shows an honest
 * connecting/warming state instead of the frozen re-served kaval `daemonStatus` (whose
 * value-fold HOLDS STALE while padi is unbound).
 *
 * Extracted here as a pure, total function so the mapping is unit-tested without a real
 * bound padi; `index.ts` only wires the `padiSession.onState` subscription that drives
 * `koluSurfaceCtx.cells.padiLink.set` off it.
 */

import type { ConnectionState } from "@kolu/surface-remote";
import type { PadiLink } from "kolu-common/surface";
import { match } from "ts-pattern";

/** Collapse the bound padi session's five-phase `ConnectionState` onto the three-state
 *  `padiLink` the client folds:
 *    - `connected`               → `connected`  (bound to a live padi);
 *    - `connecting` / `copying`  → `connecting` (the binding is (re)establishing);
 *    - `disconnected` / `failed` → `degraded`   (the binding dropped; the loop re-dials).
 *  Total + `.exhaustive()` so a new `ConnectionState` is a compile error here, never a
 *  silent fall-through. */
export function mapConnectionToPadiLink(connection: ConnectionState): PadiLink {
  return match(connection)
    .with("connected", () => "connected" as const)
    .with("connecting", "copying", () => "connecting" as const)
    .with("disconnected", "failed", () => "degraded" as const)
    .exhaustive();
}
