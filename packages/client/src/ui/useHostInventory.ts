/**
 * The BOUND host's running kaval + padi daemons — the "Running daemons" list the
 * Kaval + Padi info dialogs show for the machine kolu-server is bound to — AND (W4
 * "the switch") the ACTIVE host's own padi identity (build commit / surfaceVersion /
 * boot time).
 *
 * `hostInventory` rides padiSurface's `hostInventory` cell (padi scans its OWN host
 * and serves the result), re-served straight to this client — so the list describes
 * the bound host identically whether kolu-server reaches padi locally or over ssh.
 * That is the whole point of the member: before it, the dialog could only show the
 * machine kolu-server runs on, never the machine you're actually using when bound
 * remotely.
 *
 * `identity` rides padiSurface's `identity` cell (padi is the SOLE authority on its
 * own build commit/surfaceVersion/boot time — the per-host twin of its control-core
 * `hello`). Before this cell existed, the dialog's commit/version/uptime rode the
 * single legacy bind (`daemonInventory.boundPadi` / koluSurface's `processStartedAt`),
 * which only ever described whichever ONE padi kolu-server happened to be bound to —
 * a wrong-host lie the instant a REMOTE host was active. Both readouts re-key when
 * the active host switches (`useEntry(activeHost)`).
 *
 * kolu-server's OWN machine (a leak diagnostic under a remote binding) is a SEPARATE
 * list — koluSurface's `daemonInventory.localScan`, in `./useDaemonInventory`.
 */

import type { RunningKaval, RunningPadi } from "kolu-common/surface";
import { type Accessor, createMemo, createRoot } from "solid-js";
import { sameItems } from "../conductor/sameItems";
import { type DaemonScan, daemonScanCause } from "../host/daemonScan";
import { daemonChannelLive } from "../kaval/useDaemonStatus";
import { foldEach } from "@kolu/surface/solid";
import { activeHost, padiMap } from "../wire";

/** The empty sources an unserved scan reads — one frozen array each, so a scan
 *  that has not landed hands `mapArray` the same reference and it has nothing
 *  to diff. */
const NO_KAVALS: readonly RunningKaval[] = Object.freeze([]);
const NO_PADIS: readonly RunningPadi[] = Object.freeze([]);

/** Whether two readings of one kaval row say the same thing. The row memos
 *  below mint a fresh record per run, so this is what keeps an unchanged row's
 *  IDENTITY — and therefore the dialog's `<For>` row — still. */
function sameKaval(a: RunningKaval, b: RunningKaval): boolean {
  return (
    a.socket === b.socket &&
    a.label === b.label &&
    a.kind === b.kind &&
    a.gatePid === b.gatePid &&
    a.terminalCount === b.terminalCount &&
    a.buildCommit === b.buildCommit &&
    a.contractVersion === b.contractVersion &&
    a.held.active === b.held.active &&
    (!a.held.active ||
      !b.held.active ||
      a.held.atLegacyAddress === b.held.atLegacyAddress)
  );
}

/** Whether two readings of one padi row say the same thing (see
 *  {@link sameKaval}). */
function samePadi(a: RunningPadi, b: RunningPadi): boolean {
  return (
    a.socket === b.socket &&
    a.stateRoot === b.stateRoot &&
    a.gatePid === b.gatePid &&
    a.active === b.active
  );
}

/** `0 … n-1` — the positions of a served list, as the key a per-row fold is
 *  keyed by. POSITION, because position is the only identity these rows have:
 *  the member declares no array key, and an undeclared member's array elements
 *  are REPLACED rather than recycled on every frame
 *  (`@kolu/surface/solid`'s `writeValue.ts`), so keying a fold on the row
 *  object would throw away and rebuild every row on every scan tick. */
function positionsOf(
  name: string,
  length: Accessor<number>,
): Accessor<number[]> {
  return createMemo(() => Array.from({ length: length() }, (_, at) => at), {
    name,
    equals: sameItems,
  });
}

// A host-scoped standing readout — rides `useEntry(activeHost)` under an app-scope
// `createRoot` (module-lifetime), so it re-keys when the active host switches.
//
// The two lists are published as PLAIN rows, folded a row at a time. The cell
// serves a `createStore` frame, so every field of every row is its own store
// leaf: a reader that walked the served array — `boundHostScan`'s "is any padi
// active?", the Kaval dialog's legacy-address check, the dialogs' own `<For>`s —
// took a source per daemon on ITS scope, and a machine running many daemons put
// that scope past Solid's 200-source `WIDE_SCOPE_DEPS` judge. One row memo per
// daemon, joined a chunk at a time ({@link foldEach}), so every reader below is
// one source for any number of daemons — and a row whose fields did not move
// keeps its identity, which the replaced-every-frame proxies never could.
const scan = createRoot(() => {
  const sub = padiMap.useEntry(activeHost).cells.hostInventory.use();
  const kavalsServed = (): readonly RunningKaval[] =>
    sub.value()?.kavals ?? NO_KAVALS;
  const padisServed = (): readonly RunningPadi[] =>
    sub.value()?.padis ?? NO_PADIS;
  return {
    kavals: foldEach(
      "hostInventory.kavals",
      positionsOf("hostInventory.kavals.at", () => kavalsServed().length),
      (at): RunningKaval | undefined => {
        const row = kavalsServed()[at];
        if (row === undefined) return undefined;
        return {
          socket: row.socket,
          label: row.label,
          kind: row.kind,
          gatePid: row.gatePid,
          terminalCount: row.terminalCount,
          buildCommit: row.buildCommit,
          contractVersion: row.contractVersion,
          held: row.held.active
            ? { active: true, atLegacyAddress: row.held.atLegacyAddress }
            : { active: false },
        };
      },
      sameKaval,
    ),
    padis: foldEach(
      "hostInventory.padis",
      positionsOf("hostInventory.padis.at", () => padisServed().length),
      (at): RunningPadi | undefined => {
        const row = padisServed()[at];
        if (row === undefined) return undefined;
        return {
          socket: row.socket,
          stateRoot: row.stateRoot,
          gatePid: row.gatePid,
          active: row.active,
        };
      },
      samePadi,
    ),
  };
});

/** Every running kaval daemon on the BOUND host, each marked `active` when that host's
 *  padi owns it (empty before the first scan). */
export function boundHostKavals(): readonly RunningKaval[] {
  return scan.kavals();
}

/** Every running padi daemon on the BOUND host, each marked `active` when it is the one
 *  kolu is bound to (empty before the first scan). */
export function boundHostPadis(): readonly RunningPadi[] {
  return scan.padis();
}

/** The bound host's daemon-scan liveness as a DISCRIMINATED CAUSE (#1793) — the ONE fold
 *  the "Running daemons" section reads, so a NOT-live scan names WHY (connecting vs a hard
 *  `failed(cause)` host vs a too-old padi) instead of guessing "connecting". A total fold
 *  over the active host's typed entry state ({@link daemonScanCause}) × whether a real
 *  frame has landed:
 *
 *   - `bindLive` is kolu's honest bind-liveness fact (browser transport ∧ the active
 *     entry's own connection, `daemonChannelLive`) — so a dead entry's frozen re-served
 *     inventory is never read as live, REMOTE ssh flap or LOCAL `daemon.restart` drain
 *     alike (#1568, W4 daemon-rail unification: one fact, every host). It gates only the
 *     `connected` arm's live-vs-too-old call.
 *   - `framePresent`: a live padi ALWAYS reports ITSELF (`withSelfPadi` seeds its own
 *     active row even at T+0), so "no active padi row" is the tell that no real frame has
 *     landed — distinct from a genuine zero (which can't happen). Without it a
 *     just-connected bind's seeded-empty `{ kavals: [], padis: [] }` would read as a
 *     definite "No running daemons" (#1034). */
export function boundHostScan(): DaemonScan {
  return daemonScanCause(padiMap.entry(activeHost()).state(), {
    bindLive: daemonChannelLive(),
    framePresent: boundHostPadis().some((p) => p.active),
  });
}

/** Whether the bound host's inventory is a TRUSTWORTHY live reading the dialog may render
 *  as a definite answer — derived from the single {@link boundHostScan} fold so the floor
 *  consumers (the Padi socket row, the kaval converge nudge) and the section's copy can't
 *  drift on what "live" means. */
export function boundHostInventoryLive(): boolean {
  return boundHostScan().kind === "live";
}

/** The BOUND padi kolu is using (`active`), or `undefined` before the first scan. The
 *  Padi dialog reads its `socket` for the socket detail row under a LOCAL binding (under
 *  a remote binding the socket is a path on the ssh host, so the dialog names the host
 *  instead). */
export function activePadi(): RunningPadi | undefined {
  return boundHostPadis().find((p) => p.active);
}
