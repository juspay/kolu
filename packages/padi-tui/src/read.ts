/**
 * The data side of the CLI — reading padi's `terminals` collection from a
 * connected client, factored out of `main.ts` so it is testable against a real
 * padi over a real socket with no tty. Two one-shot reads live here: the key
 * set (`readTerminalKeys`, prefix resolution) and `settledSnapshot` (`status`).
 * The LIVE side — `watchTerminals` for `watch` and `awaitAgentState` for
 * `wait` — graduated into `@kolu/padi`'s dial kit (`watch.ts`) when the kolu
 * MCP face became its verbatim second consumer; this CLI imports it back.
 *
 * padi's compatibility is gated at DIAL (`connectPadi` refuses a contract skew
 * loudly), so — unlike the retired pulam-tui — there is no separate `assertCompatible` read.
 */

import { padiSurface, type PadiTerminal } from "@kolu/padi/surface";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiTuiClient } from "./connect.ts";

/** The current terminal key set — the FIRST frame of the `keys` snapshot-then-delta
 *  stream. The `keys` collection ALWAYS opens with a snapshot frame (zero terminals
 *  is a defined empty array, not an empty stream), so an empty stream means the
 *  link/protocol failed — this surfaces it loudly rather than collapsing to "no
 *  terminals" (which `resolveOne` would then misreport as `no terminal matching
 *  <id>`, and `status` would render as a blank table —
 *  caught-error-must-not-collapse-to-empty). The ONE home for the snapshot-frame
 *  contract and its failure string, shared by {@link settledSnapshot} and the
 *  CLI's id-prefix resolution (`wait` / `create --parent`, which need only the ids,
 *  never each terminal's value — so they read the key set, not the whole snapshot).
 *
 *  `keys` now hands back a LAZY `Stream` synchronously — nothing is subscribed
 *  until it is consumed, and there is no `signal` left to pass (D10/#18:
 *  cancellation is fiber interruption). `firstFrameOrThrow` takes that `Stream`
 *  directly and reads it with `Stream.runHead`, which interrupts the rest of the
 *  stream once the snapshot is in hand — so this one-shot read tears its own
 *  subscription down and needs no cancellation token. The `Stream` is built inside
 *  this async body, so a member ref that throws SYNCHRONOUSLY (a wrong-surface
 *  client) still arrives as a rejection, never as a throw past the caller's
 *  `await`. */
export async function readTerminalKeys(
  client: PadiTuiClient,
): Promise<readonly TerminalId[]> {
  return firstFrameOrThrow(
    client.surface.terminals.keys(undefined),
    "padi terminals keys yielded no snapshot frame — link or protocol failure.",
  );
}

/** A composed record is "resolved enough to show" once its live sensors have
 *  landed. A dormant record (`sleeping`/`parked`) is a persisted projection, not
 *  mid-sensing, so it is always resolved. An `active` one is resolved once ANY of
 *  git / agent / foreground has landed, or its PR has left `pending` — a
 *  just-spawned terminal seeds all-null and fills in a beat later. */
function isResolved(v: PadiTerminal): boolean {
  if (v.state !== "active") return true;
  return (
    v.git !== null ||
    v.agent !== null ||
    v.foreground !== null ||
    v.pr.kind !== "pending"
  );
}

/** A snapshot that WAITS for padi's sensors to resolve, for `status`. Against a
 *  warm local padi every value arrives resolved, so this settles at once
 *  (sub-`graceMs`); against a padi that just spawned a terminal it waits just long
 *  enough for the sensors, then lingers `graceMs` to catch siblings landing in the
 *  same burst — capping the whole wait at `maxMs`. A terminal the sensors
 *  legitimately resolve to "nothing" never flips `isResolved`, so it falls through
 *  at `maxMs` — bounded, never a hang. Mirrors the retired pulam-tui's `settledSnapshot`. */
export async function settledSnapshot(
  client: PadiTuiClient,
  opts: { maxMs?: number; graceMs?: number } = {},
): Promise<Array<[TerminalId, PadiTerminal]>> {
  const maxMs = opts.maxMs ?? 3000;
  const graceMs = opts.graceMs ?? 1500;
  // The key set padi first reports — the terminals we wait to resolve.
  const expected = await readTerminalKeys(client);

  const acc = new Map<TerminalId, PadiTerminal>();
  const abort = new AbortController();
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  // Did WE end the read (sensors settled / grace / hard cap / empty fleet)? The
  // mirror's `.done` settling while this is still false means the LINK dropped
  // mid-read — a failure to surface, not a partial snapshot to return silently
  // (caught-error-must-not-collapse-to-empty). Latched at the instant `.done`
  // fires, so a grace timer racing just behind it can't retroactively mask it.
  let stopped = false;
  let linkFailed = false;
  let upstreamError: string | undefined;
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const stop = (): void => {
    stopped = true;
    abort.abort();
    settle();
  };
  const hardCap = setTimeout(stop, maxMs);

  const considerSettling = (): void => {
    if (expected.length === 0) {
      stop();
      return;
    }
    const allResolved = expected.every((k) => {
      const v = acc.get(k);
      return v === undefined ? false : isResolved(v);
    });
    if (allResolved && graceTimer === undefined) {
      graceTimer = setTimeout(stop, graceMs);
    }
  };

  void mirrorRemoteSurface(
    padiSurface,
    client,
    {
      collections: {
        terminals: {
          upsert: (id, value) => {
            acc.set(id, value);
            considerSettling();
          },
          remove: (id) => {
            acc.delete(id);
            considerSettling();
          },
        },
      },
      // Subscribe to `activity` too — not for its data (ignored here) but because
      // a collection-only mirror has nothing holding it open: it would settle its
      // `.done` right after the initial snapshot and stop delivering the very
      // resolution deltas we're waiting for. The (snapshot-then-delta) activity
      // stream keeps the mirror live until we abort it, exactly as `watch` does.
      streams: { activity: { input: {}, onFrame: () => {} } },
    },
    // Capture non-abort upstream blips so a failure carries a diagnostic rather
    // than surfacing as a bare "link closed".
    {
      signal: abort.signal,
      log: (line) => {
        upstreamError ??= line;
      },
    },
  ).done.then(
    // The mirror ended. If WE didn't stop it, the link dropped mid-read — flag it
    // (latched now, before any trailing grace timer can flip `stopped`) so the
    // caller fails loud instead of returning a partial/empty snapshot.
    () => {
      if (!stopped) linkFailed = true;
      settle();
    },
    (err) => {
      if (!stopped) {
        linkFailed = true;
        upstreamError ??= (err as Error).message;
      }
      settle();
    },
  );

  try {
    await done;
  } finally {
    clearTimeout(hardCap);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    abort.abort();
  }
  if (linkFailed) {
    throw new Error(
      upstreamError ??
        "the padi link closed before the terminal snapshot settled — the daemon stopped or the connection dropped. Is `padi` still running?",
    );
  }
  return [...acc.entries()];
}
