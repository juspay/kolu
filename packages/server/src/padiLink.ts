/**
 * The pure `SessionState.phase` → `padiLink` cell mapping.
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

import type { ConnectionInfo } from "@kolu/surface-remote/connection";
import type { PadiLink } from "kolu-common/surface";
import { match } from "ts-pattern";

/** Every realised session `phase` — DERIVED from the one connection-state family
 *  (`ConnectionInfo["phase"]`), not hand-listed, so a new session phase (e.g. a widened
 *  `SshProv`) makes the `.exhaustive()` match below fail to compile until handled, never a
 *  silent fall-through. The local padi arm only ever emits the non-provisioning subset, but
 *  accepting the ssh connector's provisioning phases too keeps this total for the widened
 *  pool slot. */
type SessionPhase = ConnectionInfo["phase"];

/** Collapse the bound padi session's `phase` onto the three-state `padiLink` the
 *  client folds:
 *    - `connected`                          → `connected`  (bound to a live padi);
 *    - `connecting` / `probing` / `copying` / `building` → `connecting` (the binding
 *                                              is (re)establishing / provisioning);
 *    - `disconnected` / `failed`            → `degraded`   (the binding dropped; the
 *                                              loop re-dials).
 *  Total + `.exhaustive()` so a new session `phase` is a compile error here, never a
 *  silent fall-through. */
export function mapConnectionToPadiLink(phase: SessionPhase): PadiLink {
  return match(phase)
    .with("connected", () => "connected" as const)
    .with(
      "connecting",
      "probing",
      "copying",
      "building",
      () => "connecting" as const,
    )
    .with("disconnected", "failed", () => "degraded" as const)
    .exhaustive();
}
