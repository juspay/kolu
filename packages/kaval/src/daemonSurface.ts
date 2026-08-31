/**
 * Kaval's complete daemon wire: the versioned pty-host surface at its historic
 * flat paths, plus the frozen control core under the sibling `control` key.
 *
 * The pty-host half MUST stay flat (`surface/system/version`,
 * `surface/terminal/*`, ...): existing padi and kaval-tui clients address those
 * tags. The additive control sibling lands at `surface/control/core/*`, which is
 * the stable path `probeDaemonIdentity` dials at any pty-host version skew.
 *
 * ## Why this is a GROUP COMPOSITION, not a contract splice
 *
 * The oRPC version hand-spliced two already-finalized contracts
 * (`{...ptyHostSurface.contract, surface: {...pty.surface, control: ...}}`) and
 * then re-adapted both finalized ROUTERS against the widened contract's matcher,
 * behind two `as any` casts — because a router carried no route of its own and
 * had to be re-taught one by the matcher tree it was mounted in.
 *
 * On the Effect wire a TAG CARRIES ITS OWN ROUTE, so there is nothing to
 * re-adapt: composition is a disjoint union of two flat `Map<tag, …>`s. The two
 * halves are minted by the SAME rule they would be minted by standing alone —
 * the pty surface through `defineSurface` (prefix `surface/`), the control
 * fragment through `composeSurfaceContracts({ control })` (prefix
 * `surface/control/`), which is the very expression `probeDaemonIdentity` builds
 * its dialing group from. Neither half learns it was composed.
 *
 * The composition is CHECKED, not assumed (PLAN D1, review #16): `RpcGroup.merge`
 * is a last-writer-wins `Map.set` with zero collision detection, so a colliding
 * tag would silently leave one half's member answering for the other's. The proof
 * is `mergeDisjointGroups` (`@kolu/surface/define`), the framework's one spelling
 * of it — there is no local size check left here — and `daemonSurface.test.ts` pins
 * the combined request key set literally.
 *
 * The three framework-reserved `system/*` tags — the one overlap a naive merge
 * WOULD hit — are disjoint here by construction: the pty half claims
 * `surface/system/{live,identity,clockNow}` and the control sibling claims
 * `surface/control/system/{…}`. That is a property of the sibling prefix, so the
 * assertion below is what proves it rather than this comment.
 */

import { controlCoreFragment, controlCoreSurface } from "@kolu/surface-daemon";
import {
  composeSurfaceContracts,
  mergeDisjointGroups,
  type Surface,
} from "@kolu/surface/define";
import {
  implementSurface,
  superviseTerminalSource,
  type SurfaceHandlers,
} from "@kolu/surface/server";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import type { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";

/** The frozen control fragment as kaval serves it: a SIBLING under the `control`
 *  key, so its members are tagged `surface/control/core/{hello,drain}`. Exported
 *  because a client of the daemon builds its control face from this exact
 *  surface value — the same one the handlers were bound against — rather than
 *  re-deriving the prefix from a string. */
export const kavalControlSurface: Surface<typeof controlCoreSurface.spec> =
  composeSurfaceContracts({ control: controlCoreSurface }).siblings.control;

/** Kaval's complete daemon wire, as ONE flat group. Byte-for-byte the pty-host
 *  tags plus the control sibling's — nothing renamed, nothing re-prefixed.
 *
 *  `mergeDisjointGroups` (`@kolu/surface/define`) is the proof, not a local size
 *  check: `RpcGroup.merge` is a plain `Map.set` per tag, so a collision is
 *  silently overwritten and two members would answer at one wire tag. */
export const kavalDaemonGroup: RpcGroup.RpcGroup<Rpc.Any> = mergeDisjointGroups(
  { ptyHost: ptyHostSurface.group, control: kavalControlSurface.group },
);

type PtyHostRuntime = ReturnType<typeof createInProcessPtyHost>;

/** The assembled daemon: one group, one handler record, one supervision pair. */
export interface KavalDaemonSurface {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly handlers: SurfaceHandlers;
  readonly done: Promise<void>;
  close(): Promise<void>;
}

/** Merge two handler records, failing loud on a tag either side already bound.
 *  Null-prototype for the same reason the framework's record has one: member
 *  names are arbitrary strings, so a member named `toString` must not collide
 *  with an inherited property. */
function mergeHandlersDisjoint(
  ...records: readonly SurfaceHandlers[]
): SurfaceHandlers {
  const merged: SurfaceHandlers = Object.create(null);
  for (const record of records) {
    for (const [tag, handler] of Object.entries(record)) {
      if (tag in merged) {
        throw new Error(
          `serveKavalDaemonSurface: two handlers bound at wire tag "${tag}" — ` +
            "the pty-host surface and the control sibling must stay disjoint.",
        );
      }
      merged[tag] = handler;
    }
  }
  return merged;
}

/** Assemble the final kaval daemon wire without re-implementing either half. */
export function serveKavalDaemonSurface(opts: {
  ptyHost: PtyHostRuntime;
  stateRoot: string;
}): KavalDaemonSurface {
  const control = implementSurface(
    kavalControlSurface,
    controlCoreFragment({
      stateRoot: opts.stateRoot,
      surfaceVersion: PTY_HOST_CONTRACT_VERSION,
      startedAt: opts.ptyHost.boot.startedAt,
      commit: opts.ptyHost.boot.identity.navigableCommit,
      buildId: opts.ptyHost.boot.identity.staleKey,
      // The frozen schema requires a drain verb, but kaval CANNOT drain: ending
      // the process destroys its live PTYs. So it refuses, by throwing.
      //
      // That refusal is a DEFECT, not a member error, and deliberately so.
      // `controlCoreFragment` runs this hook under `Effect.promise` precisely
      // because `core.drain` declares NO error schema (the frozen fragment's
      // shape is not kaval's to widen) — so an undeclared throw stays a defect
      // (PLAN D4) rather than masquerading as something a supervisor could
      // narrow on and "handle". The not-drainable convergence policy makes this
      // unreachable in normal supervision; a direct caller gets a loud,
      // message-bearing rejection and a daemon that is demonstrably still alive
      // (pinned in `daemonSurface.test.ts`). The oRPC-era
      // `ORPCError("PRECONDITION_FAILED")` said the same thing with a code the
      // caller had to string-compare; the defect says it without pretending the
      // frozen wire declared it.
      onDrain: () => {
        throw new Error("kaval is not drainable; restart it explicitly");
      },
    }),
  );

  // The pty-host runtime owns the terminal resources and is therefore the
  // terminal source: close it first, then release the passive control runtime.
  const supervised = superviseTerminalSource(control, opts.ptyHost);
  return {
    group: kavalDaemonGroup,
    handlers: mergeHandlersDisjoint(
      opts.ptyHost.served.handlers,
      control.handlers,
    ),
    ...supervised,
  };
}
