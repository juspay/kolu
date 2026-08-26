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
import { activePadiTerminal } from "@kolu/padi-client/surface";
import { firstFrameOfCollectionItem } from "@kolu/surface/first-frame";
import { Effect, Option, Stream } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { type PortFamily, preferredFamily } from "kolu-common/surface";

/** What a host's listening ports look like to the forward subsystem — each port
 *  mapped to the IP family it is bound on, or the honest "we could not look".
 *
 *  A DISCRIMINATED UNION rather than a sentinel beside a map, matching the shape
 *  `TerminalPorts` sets one package over for this very two-way: it is the same
 *  fact, derived from that one, for the same rule. The tag is what makes
 *  `for (const [p, f] of hostPorts)` a compile error instead of a runtime one,
 *  and what removes the second spelling of "we could not look" that had already
 *  appeared beside it (`seen === undefined || seen === "unknown"`).
 *
 *  `unknown` is not "none", and that distinction is the whole of the auto-cancel
 *  rule: it means no terminal on that host has ever been scanned successfully,
 *  or every scan we have is blind. A map — even an empty one — is an
 *  OBSERVATION, and only an observation may close a door.
 *
 *  It carries the FAMILY and not just the port numbers because the same reading
 *  answers both questions the policy has: which doors to close, and — for a door
 *  about to be opened — which loopback to dial. Deriving the family here rather
 *  than accepting it from the client is deliberate: the client's copy can be a
 *  scan or two stale, and a stale family opens a door onto an address with
 *  nothing behind it.
 *
 *  Declared HERE, in the module that produces every value of it and is named
 *  after it, rather than in the policy module that only ever takes it as a
 *  parameter. */
export type HostPorts =
  | {
      readonly status: "known";
      readonly ports: ReadonlyMap<number, PortFamily>;
    }
  | { readonly status: "unknown" };

/** A host's `terminals` collection, as this reader uses it — its two READ verbs in
 *  the shape the spec-derived client face mints them: a LAZY `Stream`, returned
 *  synchronously, with no options bag and no `AbortSignal` (D10/#18 — cancellation
 *  is fiber interruption). `@kolu/surface`'s `CollectionFace` (the pre-Effect loose
 *  face) no longer describes any client, so this reader states the two verbs it
 *  actually calls.
 *
 *  METHODS, not function-typed properties, and deliberately: method parameters are
 *  bivariant, so a precisely-typed collection (`padiSurface`'s `terminals`, keyed
 *  by terminal id) narrows to this face by ordinary assignment. Written as
 *  properties they would be contravariant and the boot site would be back to a
 *  cast — the same reasoning the retired `CollectionFace` carried. */
export interface TerminalsFace {
  keys(input: undefined): Stream.Stream<readonly unknown[]>;
  get(input: { key: unknown }): Stream.Stream<unknown>;
}

/** The ports currently listening on `host`, as its port scanner sees them — the
 *  evidence the auto-cancel rule needs, and the ONLY thing that may close an
 *  `auto` door.
 *
 *  Read off the host's re-serve MIRROR (the same store the browser reads), so a
 *  remote host costs no ssh round trip: the mirror already holds its terminals.
 *  `"unknown"` whenever nothing can be positively observed — the host has no
 *  session, the mirror yields no frame, or every terminal's own `ports` is
 *  `unknown` — because "we could not look" must never read as "nothing is
 *  listening". A terminal that HAS been scanned and serves nothing contributes an
 *  honest empty map, which is what lets a dead port actually be reaped.
 *
 *  The union across a host's terminals, not per-terminal, and deliberately: a
 *  forward outlives the tile that opened it (a pane can be closed while the
 *  server keeps running), so the question is "is this port still listening on
 *  this machine?", not "is it still in that terminal's subtree?". */
export function makeHostPortsReader(deps: {
  /** The host's terminals collection, or `null` when kolu has no session. */
  terminalsOf: (host: HostKey) => TerminalsFace | null;
  log: Logger;
}): (host: HostKey, deadlineMs: number) => Promise<HostPorts> {
  return async function readHostPorts(
    host: HostKey,
    /** The backstop bound on ONE terminal's read, stated by the CALLER because
     *  the two callers have irreconcilable budgets (a background reap tolerates
     *  seconds; a user watching an "opening…" button does not) and one number
     *  here would make the interactive caller inherit the background one.
     *  Membership is the real bound — a key that leaves the collection resolves
     *  the read immediately — so this only catches a host whose mirror has gone
     *  quiet without dropping the key. Tripping it costs one sample rather than
     *  a wrong answer: an unread terminal contributes nothing and does not count
     *  as an observation. */
    deadlineMs: number,
  ): Promise<HostPorts> {
    const terminals = deps.terminalsOf(host);
    if (terminals === null) return { status: "unknown" };
    try {
      // ONE `Effect.run*` edge for the whole reading (PLAN D10/#25): the reactor's
      // poll dep is `() => Promise<T>` and the reactor is deliberately non-Effect,
      // so the boundary is crossed once, here, with every subscription this read
      // opens inside the same fiber tree — a failure or an early return interrupts
      // them all through their own finalizers, which is what the chained
      // `AbortController` that used to wrap each stream did by hand.
      const reading = await Effect.runPromise(
        Effect.gen(function* () {
          const keys = yield* Stream.runHead(terminals.keys(undefined));
          if (Option.isNone(keys)) return null;
          // All at once, because the reads are independent and each is already
          // bounded on its own. In sequence, a host with N terminals whose mirror
          // has gone quiet costs N × the deadline — and the whole point of the
          // deadline is the case where it is actually reached.
          //
          // BOUNDED, and it has to be. A collection `get` for a key that is not a
          // member is a HELD-OPEN subscription that yields nothing and never ends
          // (#1681) — and the key list above is a snapshot, so a pane closed or a
          // PTY exited in the gap leaves us asking for a key that is already gone.
          // A bare first-frame read there never resolves, which does not merely
          // lose a sample: this runs inside a reactor poll cell, so the in-flight
          // latch stays held and the `forwards` cell stops recomputing for the
          // life of the process — every door frozen, none reaped, nothing logged.
          // `firstFrameOfCollectionItem` is the framework's reader for exactly
          // this, racing the item's first frame against MEMBERSHIP.
          const frames = yield* Effect.all(
            keys.value.map((id) =>
              firstFrameOfCollectionItem(
                terminals.get({ key: id }),
                terminals.keys(undefined),
                id,
                `terminal ${String(id)} yielded no frame`,
                deadlineMs,
              ),
            ),
            { concurrency: "unbounded" },
          );
          return frames;
        }),
      );
      if (reading === null) return { status: "unknown" };
      const ports = new Map<number, PortFamily>();
      let sawAnything = false;
      const frames = reading;
      // The fold stays SERIAL over the frames, in the key order above, because
      // `preferredFamily` is order-independent but the union must be a function
      // of the set rather than of which read happened to land first.
      for (const frame of frames) {
        // The two ways a read comes back empty are NOT the same fact, and the
        // reaper's whole rule turns on the difference.
        //
        //  - `absent` — the terminal left the collection between the keys frame
        //    and this read. It is gone, so it cannot be serving anything: it
        //    contributes nothing and the reading stays honest without it.
        //  - `deadline` — the terminal is STILL a member and did not answer in
        //    time. We could not look. Folding that into a `known` map would
        //    publish "this host serves nothing" on the strength of whichever
        //    pane happened to answer — and if the missing pane is the one
        //    holding the dev server, reconcile then cancels a live door.
        //
        // So a deadline fails the whole sample closed. Positive evidence is the
        // only thing allowed to close a door, and a partial read is not it.
        if (!frame.present) {
          if (frame.reason === "deadline") {
            deps.log.warn(
              { host: encodeHostKey(host) },
              "a terminal did not answer within the budget — reporting this host's ports as unknown rather than reaping on a partial reading",
            );
            return { status: "unknown" };
          }
          continue;
        }
        const arm = activePadiTerminal(
          frame.value as Parameters<typeof activePadiTerminal>[0],
        );
        if (arm === undefined || arm.ports.status !== "known") continue;
        // One KNOWN sample is enough to make this whole reading an observation:
        // the remaining terminals being unscanned cannot resurrect a port, and
        // requiring every terminal to be known would mean a single wedged pane
        // kept every dead forward alive forever.
        sawAnything = true;
        for (const p of arm.ports.list) {
          // Two terminals can hold the same port across the union (a fork, a
          // shared socket), so the families are folded by the SAME rule the
          // per-terminal fold uses — v4 wins — rather than last-write.
          const prior = ports.get(p.port);
          ports.set(
            p.port,
            prior === undefined ? p.family : preferredFamily(prior, p.family),
          );
        }
      }
      return sawAnything ? { status: "known", ports } : { status: "unknown" };
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
