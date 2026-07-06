/**
 * Server lifecycle facets for the ACTIVE host — connecting / connected /
 * disconnected / reconnected / restarted, plus the transport status the header
 * dot reads.
 *
 * Before W4 this module OWNED the one module-level `createServerLifecycle` over
 * the single page socket. W4 moved the lifecycle INTO each binding (one socket
 * per host, so one lifecycle per host — see `binding/bindings.ts`), because a
 * host switch swaps the socket and every reader must follow. This module now just
 * projects the ACTIVE binding's lifecycle under the names kolu's call sites use,
 * so `status()`/`wsStatus()`/`lifecycle()` re-point the instant the tab switches.
 */

import type { ServerLifecycleEvent } from "@kolu/surface-app/solid";
import { createMemo } from "solid-js";
import { match } from "ts-pattern";
import { activeBinding } from "../binding/bindings";

export type WsStatus = "connecting" | "open" | "closed";
export type { ServerLifecycleEvent };

/** The surface-app `ConnectionStatus` for the active host — handed to
 *  `<SurfaceAppProvider status=...>`. Reactive on the active binding AND its
 *  lifecycle, so a switch re-points it. */
export const status = () => activeBinding().status();

/** The raw lifecycle event for the active host. */
export const lifecycle = () => activeBinding().lifecycle();

/** The active host's server process id (`undefined` on a stale-close). */
export const serverProcessId = () => activeBinding().serverProcessId();

/** Transport status for the header dot — projected from the active binding's
 *  lifecycle ALONE. A `restarted` event carries its own transport: a reconnect-
 *  restart reads green (`"open"`), a stale-restart reads red (`"closed"`). */
export const wsStatus = createMemo<WsStatus>(() =>
  match(lifecycle())
    .with({ kind: "connecting" }, () => "connecting" as const)
    .with({ kind: "disconnected" }, () => "closed" as const)
    .with({ kind: "restarted", transport: "closed" }, () => "closed" as const)
    .with({ kind: "restarted" }, () => "open" as const)
    .with({ kind: "connected" }, { kind: "reconnected" }, () => "open" as const)
    .exhaustive(),
);
