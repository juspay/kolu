import type { StreamingProcedure } from "@kolu/surface/client";
import type { Effect } from "effect";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { expectTypeOf } from "vitest";
import { activePadiRpc, activePadiStreams, padiMap } from "./wire";

type SuccessOf<T> =
  T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;

const _killAll: () => Effect.Effect<void, unknown> =
  activePadiRpc.lifecycle.killAll;
void _killAll;

expectTypeOf<
  SuccessOf<ReturnType<typeof activePadiRpc.screen.text>>
>().toEqualTypeOf<string>();

const _perHostKillAll: () => Effect.Effect<void, unknown> =
  padiMap.entry(LOCAL_HOST).procedures.lifecycle.killAll;
void _perHostKillAll;

// @ts-expect-error
const _notAPromise: () => Promise<void> = activePadiRpc.lifecycle.killAll;
void _notAPromise;

// @ts-expect-error
void activePadiRpc.surface;

const _attach: StreamingProcedure<{ id: string }, unknown> =
  activePadiStreams.terminalAttach.unenrolled;
void _attach;
