/** ONE HOST'S PADI ENTRY AS PRODUCTION BUILDS IT — the real
 *  `createReactiveSubscription` keys stream, the real per-key `useCollection`
 *  view and real `createSubscription` cells, for the suites that judge how
 *  WIDE this host's readings are.
 *
 *  Why not a hand-written `{ keys, byKey, value }`: what is judged is the
 *  number of tracked sources one scope holds, and the production seam's cost
 *  is the seam's own. A collection served per key opens a subscription for
 *  the KEY LIST and one per key, each holding its frame in a
 *  `createStore<{ v }>` (`surface/src/solid/createSubscription.ts:686,713`),
 *  and `useCollection` hands out a memo per key over an index of them
 *  (`useCollection.ts:131-183`). So `terminalKeys()` is a STORE-PROXY array —
 *  walking it in user code costs its `length` leaf and one index leaf per key
 *  — and reading one record costs the per-key memo plus `store.v` before any
 *  field. A mock handing back a plain array and a plain record under-measures
 *  that graph about threefold.
 *
 *  The suite that uses this must mock `@kolu/surface/client`'s
 *  `unenrolledStreamCall` to call the procedure it is handed
 *  (`(source, input) => source(input)`), and `../wire`'s `padiMap.entry` to
 *  answer {@link HostWireMirror.entry}. Every frame crosses a stream fiber,
 *  so a suite awaits `settle` after seeding or changing the mirror. */

import {
  type ControllableStream,
  controllableStream,
} from "@kolu/surface/solid/testlib";
import { createSubscription, useCollection } from "@kolu/surface/solid";
import type {
  PadiRoster,
  PadiTerminal,
  PadiUrgency,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";

/** The saved-session blob, as far as any reading under test looks into it. */
export interface SavedSessionBlob {
  activeTerminalId?: string;
}

export interface HostWireMirror {
  /** What `padiMap.entry(host)` must answer. */
  readonly entry: unknown;
  /** Say which terminals this host holds, in this order. */
  pushKeys(keys: ReadonlyArray<TerminalId>): void;
  /** Serve one terminal's composed record — a later push for the same key is
   *  a FRAME, merged leaf by leaf exactly as the wire's would be. */
  pushRecord(id: TerminalId, record: PadiTerminal): void;
  pushRoster(roster: PadiRoster): void;
  pushSession(blob: SavedSessionBlob | undefined): void;
  /** Serve this host's attention partition — padi's `urgency` cell. */
  pushUrgency(urgency: PadiUrgency): void;
  /** Serve this host's live set — kaval's byte-motion edge, as the
   *  `activity` stream carries it. */
  pushActivity(ids: ReadonlyArray<TerminalId>): void;
}

export function hostWireMirror(): HostWireMirror {
  const keysStream = controllableStream<TerminalId[]>();
  const rosterStream = controllableStream<PadiRoster>();
  const sessionStream = controllableStream<SavedSessionBlob | undefined>();
  const feedStream = controllableStream<unknown>();
  const urgencyStream = controllableStream<PadiUrgency>();
  const activityStream = controllableStream<readonly TerminalId[]>();
  const records = new Map<TerminalId, ControllableStream<PadiTerminal>>();
  const streamOf = (id: TerminalId): ControllableStream<PadiTerminal> => {
    const held = records.get(id);
    if (held !== undefined) return held;
    const made = controllableStream<PadiTerminal>();
    records.set(id, made);
    return made;
  };
  // A cell, as `entry.cells.X.use()` hands one out: the subscription itself is
  // both the value accessor and the `pending` face the readers ask.
  const cell = (stream: ControllableStream<unknown>) => ({
    use: () => {
      const sub = createSubscription(stream.source);
      return { value: sub, sub };
    },
  });
  return {
    entry: {
      collections: {
        terminals: {
          // Reached through the suite's `unenrolledStreamCall` mock, which
          // calls this with the stream's input (none, for the key list).
          unenrolledKeys: () => keysStream.source,
          use: (options: { keys: () => TerminalId[] }) =>
            useCollection(
              { name: "terminals" } as never,
              {
                keys: options.keys,
                keyToInput: (key: TerminalId) => ({ key }),
                valueSource: ((input: { key: TerminalId }) =>
                  streamOf(input.key).source) as never,
              } as never,
            ),
        },
        // Not a reading under test: the host's kaval status is one key.
        daemonStatus: {
          use: () => ({ keys: () => [], byKey: () => undefined }),
        },
      },
      cells: {
        session: cell(sessionStream),
        roster: cell(rosterStream),
        activityFeed: cell(feedStream),
        urgency: cell(urgencyStream),
      },
      // The live set rides a STREAM, so its use-site hands in an input thunk
      // and its own `onError` — neither of which changes the subscription the
      // reader gets back.
      streams: {
        activity: { use: () => createSubscription(activityStream.source) },
      },
      // The link is up: a mirror that reported anything else would make every
      // reading STALE, which is a different test.
      state: () => ({ kind: "connected" as const }),
    },
    pushKeys: (keys) => keysStream.push([...keys]),
    pushRecord: (id, record) => streamOf(id).push(record),
    pushRoster: (roster) => rosterStream.push(roster),
    pushSession: (blob) => sessionStream.push(blob),
    pushUrgency: (urgency) => urgencyStream.push(urgency),
    pushActivity: (ids) => activityStream.push([...ids]),
  };
}
