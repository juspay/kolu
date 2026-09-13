/**
 * Reading a host's listening ports — the evidence the forward reaper acts on,
 * and the family a door about to be opened must dial.
 *
 * It lives beside the rest of the forward subsystem rather than inline in the
 * web shell's boot, which is why this directory exists at all: the feature has a
 * POLICY (`forwards.ts`), a viewer-identity question (`resolveViewerHost.ts`) and this
 * READING, and with the three scattered across `index.ts` and `src/` the boot
 * file carried domain logic that had nothing to do with booting.
 *
 * The padi seam is INJECTED, so this module needs no pool, no re-serve and no
 * mirror to be read or tested — the same discipline `forwards.ts` follows.
 */

import type { Logger } from "@kolu/log";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { Effect, Option, type Stream } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  foldUnclaimedPorts,
  type HostListeners,
  type PortFamily,
} from "kolu-common/surface";

/** What a host's listening ports look like to the forward subsystem — each port
 *  mapped to the IP family it is bound on, or the honest "we could not look".
 *
 *  A DISCRIMINATED UNION rather than a sentinel beside a map, matching the shape
 *  `HostListeners` sets one package over for this very two-way: it is derived
 *  from that fact, under the reaper's own rule (see {@link hostPortsOf}). The tag
 *  is what makes
 *  `for (const [p, f] of hostPorts)` a compile error instead of a runtime one.
 *
 *  `unknown` is not "none", and that distinction is the whole of the auto-cancel
 *  rule. A map — even an empty one — is an OBSERVATION, and only an observation
 *  may close a door.
 *
 *  It carries the FAMILY and not just the port numbers because the same reading
 *  answers both questions the policy has: which doors to close, and — for a door
 *  about to be opened — which loopback to dial. Deriving the family here rather
 *  than accepting it from the client is deliberate: the client's copy can be a
 *  scan or two stale, and a stale family opens a door onto an address with
 *  nothing behind it. */
export type HostPorts =
  | {
      readonly status: "known";
      readonly ports: ReadonlyMap<number, PortFamily>;
    }
  | { readonly status: "unknown" };

/** A host's reading, as the forward subsystem needs it.
 *
 *  Every listener counts — a door onto a DETACHED server (one no terminal's
 *  subtree holds) is exactly as alive as one onto a terminal's dev server, and
 *  reading only the terminals' own ports reaped it within one interval of being
 *  opened. That is the defect this reading replaced: the union of every
 *  terminal's `ports` is a question about terminals, and "is this port still
 *  listening on this machine?" is not one.
 *
 *  Unclaimed sockets count too, when that half was read. When it was NOT (macOS
 *  27 hides it), the claimed half alone is still an observation for the reaper,
 *  and the reason is where auto doors come from: an `auto` door is only ever
 *  opened onto a listener kolu SAW, on a host whose unclaimed half is either
 *  always readable or never is. On a host that cannot see unclaimed sockets,
 *  every auto door was born onto a claimed listener — so that listener leaving
 *  the claimed set is its death, not a change of owner kolu missed. */
export function hostPortsOf(reading: HostListeners): HostPorts {
  if (reading.status !== "known") return { status: "unknown" };
  // A port can be claimed by us AND bound by another user (rare, legitimate), so
  // the two halves fold through the vocabulary's own bind rule: the most useful
  // SCOPE wins and the family is read off the binds holding it. A family-only
  // merge would pick v4 from another user's interface bind over our `[::1]`
  // loopback one, and the door would dial 127.0.0.1 where nothing listens.
  const binds = foldUnclaimedPorts([
    ...reading.claimed,
    ...(reading.unclaimed.status === "known" ? reading.unclaimed.list : []),
  ]);
  return {
    status: "known",
    ports: new Map(binds.map((b) => [b.port, b.family])),
  };
}

/** The ports currently listening on `host`, as its port scanner sees them — the
 *  evidence the auto-cancel rule needs, and the ONLY thing that may close an
 *  `auto` door.
 *
 *  Read off the host's re-serve MIRROR (the same store the browser reads), so a
 *  remote host costs no ssh round trip: the mirror already holds the host's
 *  `hostListeners` cell. One cell, one frame — where the old reader walked every
 *  terminal of the host, raced each read against collection membership, and had
 *  to decide what a partial answer meant. `"unknown"` whenever nothing can be
 *  positively observed: no session, no frame in time, or a host the sampler is
 *  not scanning. */
export function makeHostPortsReader(deps: {
  /** The host's `hostListeners` cell stream, or `null` when kolu has no session. */
  listenersOf: (host: HostKey) => Stream.Stream<HostListeners, unknown> | null;
  log: Logger;
}): (host: HostKey, deadlineMs: number) => Promise<HostPorts> {
  return async function readHostPorts(
    host: HostKey,
    /** The backstop bound on the read, stated by the CALLER because the two
     *  callers have irreconcilable budgets (a background reap tolerates seconds;
     *  a user watching an "opening…" button does not). A cell answers its
     *  current value on subscribe, so this only trips on a mirror that has gone
     *  quiet — and tripping it costs one sample rather than a wrong answer. */
    deadlineMs: number,
  ): Promise<HostPorts> {
    const stream = deps.listenersOf(host);
    if (stream === null) return { status: "unknown" };
    try {
      // ONE `Effect.run*` edge for the whole reading (PLAN D10/#25): the reactor's
      // poll dep is `() => Promise<T>` and the reactor is deliberately non-Effect.
      // The timeout interrupts the read, and interruption IS the unsubscribe.
      const frame = await Effect.runPromise(
        firstFrameOrThrow(
          stream,
          `host ${encodeHostKey(host)}: hostListeners yielded no frame`,
        ).pipe(Effect.timeoutOption(deadlineMs)),
      );
      if (Option.isNone(frame)) {
        deps.log.warn(
          { host: encodeHostKey(host), deadlineMs },
          "a host's listeners did not answer within the budget — reporting its ports as unknown rather than reaping on no reading",
        );
        return { status: "unknown" };
      }
      return hostPortsOf(frame.value);
    } catch (err) {
      // A read that FAILED is not evidence a port died. Report the honest
      // `unknown` — never an empty map, which would reap every auto forward on
      // the host.
      deps.log.error(
        { err, host: encodeHostKey(host) },
        "host port read failed",
      );
      return { status: "unknown" };
    }
  };
}
