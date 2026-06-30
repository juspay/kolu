/**
 * Live inventory reconciliation (B3.5) — how a PTY created OUT-OF-BAND becomes a
 * tile in kolu while the server is already running.
 *
 * Boot adoption (`adoptSurvivingSession`) reconciles the daemon's live PTYs
 * against the saved session ONCE, at startup. It cannot see a PTY that appears
 * AFTER boot — a `kaval-tui create` against the very daemon kolu is a client of.
 * The daemon owns ONE inventory shared by every client; this subscribes to its
 * membership feed (`ptyHostSurface`'s `inventory` stream, contract 3.1) and
 * adopts anything kolu does not already track. So the daemon's `entries` map
 * stays the single source of truth for the live set, and kolu's terminal
 * registry is a continuous projection of it rather than a second, boot-synced
 * authority that drifts.
 *
 *   - **snapshot / created** — a PTY kolu does not track is adopted as an orphan
 *     (the host endpoint's `adoptInventoryOrphan`: metadata seeded from the live
 *     daemon snapshot, the provider DAG re-run against the surviving taps). A
 *     `created` for an id kolu
 *     ALREADY has is its own spawn echoing back — `spawnPty` registers
 *     synchronously before the daemon's `created` arrives — so the registry
 *     guard makes it a no-op: no double-register, no double-wire.
 *   - **exited** — a no-op. Every terminal kolu tracks has a per-id `exit` tap
 *     (`startSnapshotSensors`) that is the SINGLE authority for its teardown;
 *     acting here would be a second exit path. The delta exists for clients that
 *     do NOT wire per-id taps (kaval-tui, a future MCP face).
 *
 * The subscription re-subscribes across daemon recycles (a B3.2 restart, a
 * supervisor reconnect): the fresh subscription's snapshot re-converges
 * idempotently through the same registry guard, so live discovery survives a
 * recycle rather than silently stopping. It ends only when its signal aborts.
 */

import type { PtyHostInventoryEvent, PtyHostListEntry } from "kaval";
import { type TerminalId, TerminalIdSchema } from "kolu-common/surface";
import { log } from "../log.ts";
import { getTerminal } from "../terminal-registry.ts";
import { bridgeStream, type ServerTerminalEndpoint } from "./local.ts";
import { type HostScope, hostScopes, serverEndpointFor } from "./resolve.ts";

/** Delay before re-subscribing after the inventory stream ends (daemon recycle
 *  / reconnect). Long enough not to hot-loop while the daemon is down — its
 *  `dead` state is already surfaced via endpoint status — short enough that
 *  discovery resumes promptly once it returns. */
const RESUBSCRIBE_DELAY_MS = 2_000;

/** Start the live inventory reconciler for the process lifetime — one per registered
 *  host (one local today). Each re-subscribes across daemon recycles until `signal`
 *  aborts. Fire-and-forget — the loop owns its own failures (a dropped stream
 *  re-subscribes; a per-event failure is fenced), so nothing here rejects to the
 *  caller. */
export function startInventoryReconciler(signal: AbortSignal): void {
  for (const scope of hostScopes()) void runReconciler(scope, signal);
}

async function runReconciler(
  scope: HostScope,
  signal: AbortSignal,
): Promise<void> {
  // The host this reconciler follows — its inventory feed and its adopt ops both
  // route through its own endpoint, so an out-of-band PTY is adopted ON the host
  // whose daemon surfaced it, never the local one by default.
  const endpoint = serverEndpointFor(scope);
  // The ONLY new mechanism here is the re-subscribe loop across daemon recycles
  // (a B3.2 restart, a supervisor reconnect): per-PTY taps die with their PTY
  // and never re-subscribe, so this loop is genuinely new. The inner consume —
  // await the stream, fence each event, treat an abort as expected teardown —
  // is the SAME contract the per-terminal taps carry, so it plugs into
  // `bridgeStream` (the one receptacle for that volatility) rather than being
  // re-derived here. `bridgeStream` resolves (never rejects) when the stream
  // ends or aborts; a non-abort end is a daemon drop, so we delay and re-subscribe.
  while (!signal.aborted) {
    try {
      // The forwarding facade resolves the live client EAGERLY, so
      // `subscribeInventory` THROWS synchronously when the daemon isn't connected (a
      // dead-on-boot or mid-recycle endpoint) — before `bridgeStream` ever runs, so
      // its internal fence can't catch it. This try owns exactly that pre-subscribe
      // throw (a distinct failure from the stream draining, which `bridgeStream`
      // resolves and never rejects); without it the throw escapes to
      // `unhandledRejection` and exits the server on the honest dead-daemon path.
      await bridgeStream(endpoint.subscribeInventory(signal), signal, (ev) =>
        applyEvent(scope, endpoint, ev),
      );
    } catch (err) {
      if (signal.aborted) return;
      log.debug({ err }, "kaval inventory subscribe failed; will re-subscribe");
    }
    if (signal.aborted) return;
    await delay(RESUBSCRIBE_DELAY_MS, signal);
  }
}

/** One PTY to adopt: its already-VALIDATED `TerminalId` (the inventory boundary
 *  is where the opaque wire string is checked against `TerminalIdSchema`, per
 *  the contract doc — ptyHostSurface.ts:36) paired with the live daemon entry. */
export interface InventoryAdoption {
  id: TerminalId;
  entry: PtyHostListEntry;
}

/** Decide which PTYs in an inventory frame kolu must adopt: the entries it does
 *  not already track, whose id PARSES as a `TerminalId`. Pure — the caller
 *  supplies `isTracked` (the registry lookup), `onInvalid` (drop-logging), and
 *  does the adopting — so the routing is unit-testable without the registry or
 *  the daemon. This is the boundary the contract doc names: a raw inventory id is
 *  validated against `TerminalIdSchema` here, so `isTracked` / `adoptInventoryOrphan`
 *  downstream receive an already-branded `TerminalId` rather than re-casting a
 *  raw string. A malformed (non-UUID) out-of-band id is routed to `onInvalid`
 *  (which fails closed — kills the unrepresentable PTY — F1), never adopted.
 *  `snapshot`/`created` adopt the UNKNOWN entries; a tracked id is kolu's own
 *  spawn echoing back (or one already adopted), so it is skipped — no
 *  double-register, no double-wire. `exited` is never an adoption (empty): every
 *  terminal kolu tracks has a per-id `exit` tap that is the single authority for
 *  its teardown (module doc). */
export function inventoryAdoptions(
  ev: PtyHostInventoryEvent,
  isTracked: (id: TerminalId) => boolean,
  onInvalid: (rawId: string) => void,
): InventoryAdoption[] {
  switch (ev.kind) {
    case "snapshot":
      return adoptableEntries(ev.entries, isTracked, onInvalid);
    case "created":
      return adoptableEntries([ev.entry], isTracked, onInvalid);
    case "exited":
      // `exited`'s payload is an id, not an entry — there is nothing to adopt.
      // A stated case, not a fall-through: the per-id `exit` tap is the single
      // authority for a tracked PTY's teardown (module doc).
      return [];
    default:
      // Exhaustiveness: a fourth `PtyHostInventoryEvent` variant becomes a
      // COMPILE error here rather than silently routing to an empty default.
      return assertNever(ev);
  }
}

/** Validate each entry's wire id against `TerminalIdSchema` (the inventory
 *  boundary the contract doc assigns to kolu-server), route the unparseable ones
 *  to `onInvalid` (which fails closed — F1), and keep the untracked rest paired
 *  with their branded id. */
function adoptableEntries(
  entries: PtyHostListEntry[],
  isTracked: (id: TerminalId) => boolean,
  onInvalid: (rawId: string) => void,
): InventoryAdoption[] {
  const adoptions: InventoryAdoption[] = [];
  for (const entry of entries) {
    const parsed = TerminalIdSchema.safeParse(entry.id);
    if (!parsed.success) {
      onInvalid(entry.id);
      continue;
    }
    if (!isTracked(parsed.data)) {
      adoptions.push({ id: parsed.data, entry });
    }
  }
  return adoptions;
}

/** Compile-time exhaustiveness guard: reachable only if a discriminated-union
 *  case was missed, which TypeScript catches by failing to narrow `x` to
 *  `never`. Throws if ever reached at runtime (a malformed wire frame). */
function assertNever(x: never): never {
  throw new Error(`unexpected inventory event: ${JSON.stringify(x)}`);
}

/** Apply one inventory frame against the LIVE wiring: adopt every untracked PTY it
 *  contributes through the host endpoint's persisting `adoptInventoryOrphan` (stamped
 *  with the host's location). The actual routing is `dispatchInventoryFrame` (pure in
 *  its dependencies, so the "every adoption persists" guarantee is unit-testable with
 *  a spy and no daemon); this binds it to the registry lookup + the host endpoint's
 *  adopt/drop ops. The per-event fence (a single failed adoption must not end the
 *  subscription and silence discovery for every later PTY) lives in `bridgeStream`,
 *  the same receptacle the per-terminal taps plug into — not re-derived here. */
function applyEvent(
  scope: HostScope,
  endpoint: ServerTerminalEndpoint,
  ev: PtyHostInventoryEvent,
): void {
  dispatchInventoryFrame(
    ev,
    isTrackedById,
    // A malformed (non-UUID) out-of-band id FAILS CLOSED — the host endpoint kills
    // the unrepresentable PTY rather than leaving a live process kolu can't show.
    (rawId) => endpoint.reapUnrepresentablePty(rawId),
    (id, entry) => endpoint.adoptInventoryOrphan(id, entry, scope.location),
  );
}

/** Route one inventory frame to its adoptions — pure in its dependencies (the
 *  registry lookup, the drop policy, and the adoption fn are all injected), so a
 *  test can assert the routing deterministically: every `created`/`snapshot`
 *  untracked entry reaches `adopt` exactly once, malformed ids reach `onInvalid`,
 *  and `exited` adopts nothing. The production `adopt` is the host endpoint's
 *  `adoptInventoryOrphan` — which adopts AND arms the session autosave (F2): unlike
 *  the boot path (which converges + `saveSession`s explicitly after adopting every
 *  survivor), a single tile appearing mid-session has no explicit save, so the adopt
 *  fn must schedule the debounced snapshot itself. This is the seam that pins it: a
 *  regression that swapped back to the non-persisting `adoptOrphan` would still call
 *  `adopt`, so the autosave-arming is asserted on `adoptInventoryOrphan` directly in
 *  `local.ts`'s tests; here we pin that exactly the untracked entries are dispatched.
 *
 *  A live out-of-band adoption deliberately does NOT call `setAdoptedCount` (the
 *  boot path does — reattach.ts): the "N reattached" toast is a one-shot RESTART
 *  summary keyed on the once-per-process `adoptedAt` stamp (daemonStatus.ts:78-82,
 *  deduped client-side at useDaemonStatus.ts:222-256). A single PTY found live
 *  mid-session is an ordinary tile appearing, not a restart event — firing the
 *  count per live adoption would break that identity. It is the rule, not an
 *  unstated convention. */
export function dispatchInventoryFrame(
  ev: PtyHostInventoryEvent,
  isTracked: (id: TerminalId) => boolean,
  onInvalid: (rawId: string) => void,
  adopt: (id: TerminalId, entry: PtyHostListEntry) => void,
): void {
  for (const { id, entry } of inventoryAdoptions(ev, isTracked, onInvalid)) {
    log.info(
      { terminal: id, pid: entry.pid },
      "adopting out-of-band PTY from kaval inventory",
    );
    adopt(id, entry);
  }
}

const isTrackedById = (id: TerminalId): boolean =>
  getTerminal(id) !== undefined;

/** Resolve after `ms`, or early if `signal` aborts — so a shutdown during the
 *  re-subscribe gap ends the loop promptly instead of after the full delay. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
